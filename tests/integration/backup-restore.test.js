import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { unzipSync } from 'fflate';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { API_KEY, foundationEnv } from '../helpers/foundation.js';

const TOPIC_ID = `topic_${'8'.repeat(32)}`;

function modelMocks() {
  return {
    embeddingFetch: async (url, options) => {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({
        model: body.model,
        data: body.input.map((text, index) => ({ index, embedding: [1, 0] }))
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    chatFetch: async (url, options) => {
      const body = JSON.parse(options.body);
      const citationId = /"citationId":"([^"]+)"/.exec(body.messages[1].content)?.[1];
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ claims: [{ text: '恢复后的脱敏事实。', citationIds: [citationId] }] }) } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  };
}

function runtimeOptions(dataDir) {
  return {
    appRoot: APP_ROOT,
    env: foundationEnv({
      DATA_DIR: dataDir,
      FRONTEND_DEFAULT_TOPIC_ID: TOPIC_ID,
      MODEL_BASE_URL: 'https://models.example.test/v1',
      MODEL_API_KEY: 'backup-model-key',
      EMBEDDING_MODEL: 'backup-embedding-v1',
      CHAT_MODEL: 'backup-chat-v1'
    }),
    ...modelMocks()
  };
}

async function waitSucceeded(api, jobId) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const job = (await api.get(`/api/rag/v1/jobs/${jobId}`).set('X-API-Key', API_KEY).expect(200)).body;
    if (job.status === 'SUCCEEDED') return;
    if (job.status === 'FAILED') assert.fail(JSON.stringify(job));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`job timeout: ${jobId}`);
}

test('stopped backup restores into a new DATA_DIR with topic, search, chat citation and file intact', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rag-backup-acceptance-'));
  const sourceData = path.join(root, 'source-data');
  const restoredData = path.join(root, 'restored-data');
  const backupPath = path.join(root, 'portable-backup.zip');
  let sourceRuntime;
  let restoredRuntime;
  t.after(async () => {
    await sourceRuntime?.close();
    await restoredRuntime?.close();
    rmSync(root, { recursive: true, force: true });
  });

  sourceRuntime = await createRuntime(runtimeOptions(sourceData));
  await sourceRuntime.initialize();
  const now = new Date().toISOString();
  sourceRuntime.database.prepare(`INSERT INTO topic(id, name, normalized_name, description, status, created_at, updated_at)
    VALUES (?, 'Backup topic', 'backup topic', '', 'ACTIVE', ?, ?)`).run(TOPIC_ID, now, now);
  const sourceApi = request(sourceRuntime.app);
  const uploaded = await sourceApi.post('/api/rag/v1/documents')
    .set('X-API-Key', API_KEY).set('Idempotency-Key', 'backup-restore-upload')
    .field('topicId', TOPIC_ID)
    .attach('file', Buffer.from('portable backup grounded evidence'), { filename: 'backup.txt', contentType: 'text/plain' })
    .expect(202);
  await waitSucceeded(sourceApi, uploaded.body.jobId);
  await sourceApi.post(`/api/rag/v1/documents/${uploaded.body.documentId}/publish`).set('X-API-Key', API_KEY).expect(200);
  await sourceRuntime.close();
  sourceRuntime = null;

  const backupOutput = execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(APP_ROOT, 'scripts/backup-data.ps1'),
    '-DataDir', sourceData, '-OutputPath', backupPath
  ], { cwd: APP_ROOT, encoding: 'utf8' });
  assert.match(backupOutput, /BACKUP_CREATED/);
  const entries = unzipSync(new Uint8Array(readFileSync(backupPath)));
  const normalizedEntries = Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [name.replaceAll('\\', '/'), bytes]));
  assert.ok(normalizedEntries['backup-manifest.json']);
  assert.ok(normalizedEntries['data/knowledge.db']);
  assert.equal(Object.keys(entries).some((name) => name.includes('.env') || name.includes('runtime.lock')), false);
  const manifestText = Buffer.from(normalizedEntries['backup-manifest.json']).toString('utf8');
  assert.equal(manifestText.includes(sourceData), false);

  const restoreOutput = execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(APP_ROOT, 'scripts/restore-data.ps1'),
    '-BackupPath', backupPath, '-TargetDataDir', restoredData
  ], { cwd: APP_ROOT, encoding: 'utf8' });
  assert.match(restoreOutput, /RESTORED/);
  assert.notEqual(path.resolve(sourceData), path.resolve(restoredData));

  const restartStarted = performance.now();
  restoredRuntime = await createRuntime(runtimeOptions(restoredData));
  await restoredRuntime.initialize();
  assert.ok(performance.now() - restartStarted < 30000);
  const restoredApi = request(restoredRuntime.app);
  const topics = await restoredApi.get('/api/rag/v1/topics').set('X-API-Key', API_KEY).expect(200);
  assert.deepEqual(topics.body.map((topic) => topic.topicId), [TOPIC_ID]);
  const search = await restoredApi.post('/api/rag/v1/search').set('X-API-Key', API_KEY)
    .send({ topicId: TOPIC_ID, question: 'portable backup evidence' }).expect(200);
  assert.equal(search.body.results[0].documentId, uploaded.body.documentId);
  const chat = await restoredApi.post('/api/rag/v1/chat').set('X-API-Key', API_KEY)
    .send({ topicId: TOPIC_ID, question: 'portable backup evidence' }).expect(200);
  assert.equal(chat.body.status, 'ANSWERED');
  assert.equal(chat.body.citations[0].documentId, uploaded.body.documentId);
  await restoredApi.get(`/api/rag/v1/documents/${uploaded.body.documentId}/file`)
    .set('X-API-Key', API_KEY).expect(200).expect('portable backup grounded evidence');
});
