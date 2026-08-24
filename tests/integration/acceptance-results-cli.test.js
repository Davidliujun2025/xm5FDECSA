import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { loadConfirmedQuestionSet } from '../../backend/src/acceptance/acceptance-results.js';
import {
  buildAcceptanceEvidence,
  REAL_ACCEPTANCE_EVIDENCE_FILE,
  recordAcceptanceEvidence
} from '../../backend/src/acceptance/real-acceptance.js';
import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { API_KEY, foundationEnv } from '../helpers/foundation.js';

const CLI_PATH = path.resolve(APP_ROOT, 'scripts', 'record-real-acceptance-result.js');
const COMPLETE_MODEL_CONFIG = Object.freeze({
  MODEL_BASE_URL: 'https://models.example.test/v1',
  MODEL_API_KEY: 'synthetic-model-key',
  EMBEDDING_MODEL: 'synthetic-embedding-v1',
  CHAT_MODEL: 'synthetic-chat-v1'
});

function embeddingFetch(url, options) {
  const body = JSON.parse(options.body);
  return Promise.resolve(new Response(JSON.stringify({
    model: body.model,
    data: body.input.map((text, index) => ({
      index,
      embedding: Array.from({ length: 16 }, (_, offset) => ((text.length + index + offset + 1) % 7) / 7)
    }))
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function runCli(dataDir, resultsPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, '--data-dir', dataDir, '--results', resultsPath], {
      cwd: APP_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

async function createActiveTopic(api, suffix) {
  const created = await api.post('/api/rag/v1/topics')
    .set('X-API-Key', API_KEY)
    .set('Idempotency-Key', `cli-topic-${suffix}`)
    .send({ name: `CLI Acceptance ${suffix}` })
    .expect(201);
  await api.patch(`/api/rag/v1/topics/${created.body.topicId}`)
    .set('X-API-Key', API_KEY)
    .set('Idempotency-Key', `cli-active-${suffix}`)
    .send({ status: 'ACTIVE' })
    .expect(200);
  return created.body.topicId;
}

async function uploadAndPublish(api, topicId, suffix) {
  const uploaded = await api.post('/api/rag/v1/documents')
    .set('X-API-Key', API_KEY)
    .set('Idempotency-Key', `cli-upload-${suffix}`)
    .field('topicId', topicId)
    .attach('file', Buffer.from('已批准测试资料合成内容。', 'utf8'), { filename: `${suffix}.txt`, contentType: 'text/plain' })
    .expect(202);
  const deadline = Date.now() + 10_000;
  let job;
  while (Date.now() < deadline) {
    job = (await api.get(`/api/rag/v1/jobs/${uploaded.body.jobId}`).set('X-API-Key', API_KEY).expect(200)).body;
    if (job.status === 'SUCCEEDED') {
      break;
    }
    if (job.status === 'FAILED') {
      assert.fail(`job ${uploaded.body.jobId} failed: ${job.errorCode}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(job.status, 'SUCCEEDED');
  await api.post(`/api/rag/v1/documents/${uploaded.body.documentId}/publish`).set('X-API-Key', API_KEY).expect(200);
  return uploaded.body;
}

function resultsFor(documentId, overrides = {}) {
  const baseItems = [
    { id: 'MQ-01', status: 'ANSWERED', citations: [{ documentId, location: '第1页 第1段' }] },
    { id: 'MQ-02', status: 'ANSWERED', citations: [{ documentId, location: '第1页 第2段' }] },
    { id: 'MQ-03', status: 'ANSWERED', citations: [{ documentId, location: '第1页 第3段' }] },
    { id: 'MQ-04', status: 'ANSWERED', citations: [{ documentId, location: '第1页 第1段' }, { documentId, location: '第1页 第4段' }] },
    { id: 'MQ-05', status: 'ANSWERED', citations: [{ documentId, location: '第1页 第5段' }] },
    { id: 'MQ-06', status: 'ANSWERED', citations: [{ documentId, location: '第1页 第6段' }] },
    { id: 'MQ-07', status: 'NO_RELIABLE_EVIDENCE', citations: [] },
    { id: 'MQ-08', status: 'NO_RELIABLE_EVIDENCE', citations: [] },
    { id: 'MQ-09', status: 'BLOCKED', citations: [] },
    { id: 'MQ-10', status: 'BLOCKED', citations: [] }
  ];
  return {
    items: baseItems.map((item) => (overrides.items ?? []).find((override) => override.id === item.id) ?? item)
  };
}

async function prepareEnvironment() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-results-cli-'));
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: { ...foundationEnv({ DATA_DIR: dataDir, ...COMPLETE_MODEL_CONFIG }), NODE_ENV: 'test' },
    embeddingFetch
  });
  await runtime.initialize();
  const api = request(runtime.app);
  const topicId = await createActiveTopic(api, 'A');
  const published = await uploadAndPublish(api, topicId, 'alpha');
  await recordAcceptanceEvidence({
    filePath: path.join(dataDir, REAL_ACCEPTANCE_EVIDENCE_FILE),
    evidence: buildAcceptanceEvidence({ config: runtime.config, status: 'ENVIRONMENT_READY' })
  });
  return { dataDir, runtime, topicId, published };
}

test('record CLI exits 0 and archives ACCEPTANCE_PASSED for a fully grounded 10-question run', async (t) => {
  const { dataDir, runtime, topicId, published } = await prepareEnvironment();
  t.after(async () => {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const resultsPath = path.join(dataDir, 'manual-results.json');
  await writeFile(resultsPath, JSON.stringify({ topicId, conclusion: '合成执行：10/10', ...resultsFor(published.documentId) }), 'utf8');
  const run = await runCli(dataDir, resultsPath);

  assert.equal(run.code, 0, run.stderr);
  assert.ok(run.stdout.includes('ACCEPTANCE_PASSED'), run.stdout);
  assert.ok(run.stdout.includes('PASS MQ-01'), run.stdout);
  const evidence = JSON.parse(readFileSync(path.join(dataDir, REAL_ACCEPTANCE_EVIDENCE_FILE), 'utf8'));
  assert.equal(evidence.status, 'ACCEPTANCE_PASSED');
  assert.equal(evidence.questionResults.length, 10);
  assert.deepEqual(evidence.documents.map((document) => document.status), ['PUBLISHED']);
});

test('record CLI exits 1 on forged citations and leaves evidence untouched', async (t) => {
  const { dataDir, runtime, topicId } = await prepareEnvironment();
  t.after(async () => {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const evidencePath = path.join(dataDir, REAL_ACCEPTANCE_EVIDENCE_FILE);
  const before = readFileSync(evidencePath, 'utf8');
  const resultsPath = path.join(dataDir, 'manual-results.json');
  await writeFile(resultsPath, JSON.stringify({ topicId, ...resultsFor(`doc_${'f'.repeat(32)}`) }), 'utf8');
  const run = await runCli(dataDir, resultsPath);

  assert.equal(run.code, 1);
  assert.ok(run.stderr.includes('RAG_ACCEPTANCE_RESULT_INVALID'), run.stderr);
  assert.equal(readFileSync(evidencePath, 'utf8'), before);
  assert.ok(run.stdout === '');
});

test('record CLI exits 1 when the environment evidence file is missing', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-results-cli-empty-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const resultsPath = path.join(dataDir, 'manual-results.json');
  await writeFile(resultsPath, JSON.stringify({ items: [] }), 'utf8');
  const run = await runCli(dataDir, resultsPath);
  assert.equal(run.code, 1);
  assert.ok(run.stderr.includes('RAG_ACCEPTANCE_RESULT_INVALID'), run.stderr);
});

test('confirmed question set ids match the example results file', () => {
  const questionSet = loadConfirmedQuestionSet();
  const example = JSON.parse(readFileSync(
    new URL('../../examples/manual-results.example.json', import.meta.url),
    'utf8'
  ));
  assert.deepEqual(
    example.items.map((item) => item.id),
    questionSet.items.map((item) => item.id)
  );
});
