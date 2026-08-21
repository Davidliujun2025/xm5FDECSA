import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { API_KEY, foundationEnv } from '../helpers/foundation.js';
import { FORMAT_FIXTURES } from '../helpers/document-fixtures.js';

async function setup(t, envOverrides = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-documents-'));
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: foundationEnv({ DATA_DIR: dataDir, ...envOverrides })
  });
  t.after(() => {
    runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();
  return { runtime, dataDir, api: request(runtime.app) };
}

async function createTopic(api, name, { active = true, suffix = '01' } = {}) {
  const created = await api.post('/api/rag/v1/topics')
    .set('X-API-Key', API_KEY)
    .set('Idempotency-Key', `doc-topic-create-${suffix}`)
    .send({ name })
    .expect(201);
  if (!active) {
    return created.body;
  }
  const activated = await api.patch(`/api/rag/v1/topics/${created.body.topicId}`)
    .set('X-API-Key', API_KEY)
    .set('Idempotency-Key', `doc-topic-active-${suffix}`)
    .send({ status: 'ACTIVE' })
    .expect(200);
  return activated.body;
}

function upload(api, { topicId, fixture, key, fileName = `sample.${fixture.extension}` }) {
  return api.post('/api/rag/v1/documents')
    .set('X-API-Key', API_KEY)
    .set('Idempotency-Key', key)
    .field('topicId', topicId)
    .attach('file', fixture.bytes, { filename: fileName, contentType: fixture.mime });
}

test('all six formats upload through production routes and remain UPLOADED + QUEUED', async (t) => {
  const { runtime, dataDir, api } = await setup(t);
  const topic = await createTopic(api, '六格式资料');
  const empty = await api.get('/api/rag/v1/documents').query({ topicId: topic.topicId }).set('X-API-Key', API_KEY).expect(200);
  assert.deepEqual(empty.body, []);

  const uploads = [];
  for (const [index, fixture] of FORMAT_FIXTURES.entries()) {
    const started = performance.now();
    const response = await upload(api, { topicId: topic.topicId, fixture, key: `six-format-${String(index).padStart(3, '0')}` });
    assert.equal(response.status, 202);
    assert.equal(response.body.status, 'UPLOADED');
    assert.equal(response.body.jobStatus, 'QUEUED');
    assert.ok(performance.now() - started < 2000);
    uploads.push({ fixture, response: response.body });
  }

  const listed = await api.get('/api/rag/v1/documents').query({ topicId: topic.topicId }).set('X-API-Key', API_KEY).expect(200);
  assert.equal(listed.body.length, 6);
  assert.equal(listed.body.every((document) => document.status === 'UPLOADED'), true);

  for (const { fixture, response } of uploads) {
    const detail = await api.get(`/api/rag/v1/documents/${response.documentId}`).set('X-API-Key', API_KEY).expect(200);
    assert.equal(detail.body.jobId, response.jobId);
    const job = await api.get(`/api/rag/v1/jobs/${response.jobId}`).set('X-API-Key', API_KEY).expect(200);
    assert.equal(job.body.status, 'QUEUED');
    assert.equal(job.body.stage, 'QUEUED');
    const finalPath = path.join(dataDir, 'original', topic.topicId, response.documentId, `source.${fixture.extension}`);
    assert.equal(existsSync(finalPath), true);
    assert.equal(finalPath.includes('sample.'), false);
  }

  const txt = uploads.find(({ fixture }) => fixture.extension === 'txt');
  const file = await api.get(`/api/rag/v1/documents/${txt.response.documentId}/file`).set('X-API-Key', API_KEY).expect(200);
  assert.equal(file.text, txt.fixture.bytes.toString('utf8'));

  const browserSession = await api.post('/api/rag/v1/auth/browser-session').set('Origin', 'http://localhost:5173').expect(204);
  const cookie = browserSession.headers['set-cookie'][0].split(';')[0];
  await api.get(`/api/rag/v1/documents/${txt.response.documentId}`)
    .set('Origin', 'http://localhost:5173').set('Cookie', cookie).expect(404);
  await api.get(`/api/rag/v1/documents/${txt.response.documentId}/file`)
    .set('Origin', 'http://localhost:5173').set('Cookie', cookie).expect(404);

  assert.equal(runtime.database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'chunk'").get().count, 0);
});

test('upload enforces API Key, ACTIVE Topic, SHA-256 deduplication and idempotency', async (t) => {
  const { dataDir, api } = await setup(t);
  const draft = await createTopic(api, '草稿 Topic', { active: false, suffix: 'draft' });
  const txt = FORMAT_FIXTURES.find((fixture) => fixture.extension === 'txt');

  await api.post('/api/rag/v1/documents')
    .set('Idempotency-Key', 'upload-no-auth')
    .field('topicId', draft.topicId)
    .attach('file', txt.bytes, { filename: 'no-auth.txt', contentType: txt.mime })
    .expect(401);
  const draftRejected = await upload(api, { topicId: draft.topicId, fixture: txt, key: 'upload-draft-01' });
  assert.equal(draftRejected.status, 409);
  assert.equal(draftRejected.body.errorCode, 'RAG_TOPIC_NOT_ACTIVE');

  const active = await createTopic(api, '启用 Topic', { suffix: 'active' });
  const first = await upload(api, { topicId: active.topicId, fixture: txt, key: 'upload-idem-001', fileName: '原始资料.txt' });
  assert.equal(first.status, 202);
  const replay = await upload(api, { topicId: active.topicId, fixture: txt, key: 'upload-idem-001', fileName: '原始资料.txt' });
  assert.equal(replay.status, 202);
  assert.equal(replay.headers['idempotency-replayed'], 'true');
  assert.equal(replay.body.documentId, first.body.documentId);
  const idempotencyConflict = await upload(api, {
    topicId: active.topicId,
    fixture: { ...txt, bytes: Buffer.from('different idempotent body', 'utf8') },
    key: 'upload-idem-001',
    fileName: '原始资料.txt'
  });
  assert.equal(idempotencyConflict.status, 409);
  assert.equal(idempotencyConflict.body.errorCode, 'RAG_IDEMPOTENCY_CONFLICT');
  const duplicate = await upload(api, { topicId: active.topicId, fixture: txt, key: 'upload-duplicate' });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.errorCode, 'RAG_DUPLICATE_DOCUMENT');

  const anotherTopic = await createTopic(api, '另一个 Topic', { suffix: 'another' });
  const crossTopic = await upload(api, { topicId: anotherTopic.topicId, fixture: txt, key: 'upload-cross-topic' });
  assert.equal(crossTopic.status, 202);

  await api.patch(`/api/rag/v1/topics/${active.topicId}`)
    .set('X-API-Key', API_KEY).set('Idempotency-Key', 'disable-upload-topic')
    .send({ status: 'DISABLED' }).expect(200);
  const disabled = await upload(api, {
    topicId: active.topicId,
    fixture: { ...txt, bytes: Buffer.from('different content', 'utf8') },
    key: 'upload-disabled'
  });
  assert.equal(disabled.status, 409);
  assert.equal(disabled.body.errorCode, 'RAG_TOPIC_DISABLED');

  const uploadTemp = path.join(dataDir, 'temp', 'uploads');
  assert.deepEqual(readdirSync(uploadTemp), []);
});

test('invalid format, MIME, headers, empty content and path traversal leave no records', async (t) => {
  const { runtime, api } = await setup(t);
  const topic = await createTopic(api, '错误文件 Topic', { suffix: 'invalid' });
  const cases = [
    { name: 'bad.exe', mime: 'application/octet-stream', bytes: Buffer.from('binary'), code: 'RAG_UNSUPPORTED_FORMAT' },
    { name: 'bad.pdf', mime: 'text/plain', bytes: Buffer.from('%PDF-1.4'), code: 'RAG_FILE_INVALID' },
    { name: 'bad.pdf', mime: 'application/pdf', bytes: Buffer.from('not pdf'), code: 'RAG_FILE_INVALID' },
    { name: 'bad.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: Buffer.from('PK-no-eocd'), code: 'RAG_FILE_INVALID' },
    { name: 'empty.txt', mime: 'text/plain', bytes: Buffer.alloc(0), code: 'RAG_NO_TEXT_CONTENT' },
    { name: 'blank.md', mime: 'text/markdown', bytes: Buffer.from('   '), code: 'RAG_NO_TEXT_CONTENT' }
  ];
  for (const [index, item] of cases.entries()) {
    const response = await api.post('/api/rag/v1/documents')
      .set('X-API-Key', API_KEY)
      .set('Idempotency-Key', `invalid-upload-${index}`)
      .field('topicId', topic.topicId)
      .attach('file', item.bytes, { filename: item.name, contentType: item.mime });
    assert.equal(response.status, item.code === 'RAG_FILE_TOO_LARGE' ? 413 : 422);
    assert.equal(response.body.errorCode, item.code);
  }
  assert.equal(runtime.database.prepare('SELECT COUNT(*) AS count FROM document').get().count, 0);
  assert.equal(runtime.database.prepare('SELECT COUNT(*) AS count FROM job').get().count, 0);
  await api.get('/api/rag/v1/documents/bad-id').set('X-API-Key', API_KEY).expect(400);
  await api.get('/api/rag/v1/jobs/bad-id').set('X-API-Key', API_KEY).expect(400);
});

test('file count, total bytes and single-file limits fail without usable residue', async (t) => {
  const countRuntime = await setup(t, { MAX_TOTAL_FILES: '1' });
  const countTopic = await createTopic(countRuntime.api, '文件数容量', { suffix: 'count' });
  const txt = FORMAT_FIXTURES.find((fixture) => fixture.extension === 'txt');
  await upload(countRuntime.api, { topicId: countTopic.topicId, fixture: txt, key: 'count-first-01' }).then((response) => assert.equal(response.status, 202));
  const countOverflow = await upload(countRuntime.api, {
    topicId: countTopic.topicId,
    fixture: { ...txt, bytes: Buffer.from('another valid text', 'utf8') },
    key: 'count-second-1'
  });
  assert.equal(countOverflow.status, 409);
  assert.equal(countOverflow.body.errorCode, 'RAG_CAPACITY_LIMIT');

  const bytesRuntime = await setup(t, { MAX_TOTAL_STORAGE_GB: '0.00000002' });
  const bytesTopic = await createTopic(bytesRuntime.api, '字节容量', { suffix: 'bytes' });
  const storageOverflow = await upload(bytesRuntime.api, { topicId: bytesTopic.topicId, fixture: txt, key: 'bytes-overflow1' });
  assert.equal(storageOverflow.status, 409);
  assert.equal(storageOverflow.body.errorCode, 'RAG_CAPACITY_LIMIT');

  const sizeRuntime = await setup(t, { MAX_FILE_MB: '1' });
  const sizeTopic = await createTopic(sizeRuntime.api, '单文件容量', { suffix: 'size' });
  const tooLarge = await sizeRuntime.api.post('/api/rag/v1/documents')
    .set('X-API-Key', API_KEY).set('Idempotency-Key', 'file-too-large')
    .field('topicId', sizeTopic.topicId)
    .attach('file', Buffer.alloc(1024 * 1024 + 1, 0x61), { filename: 'large.txt', contentType: 'text/plain' });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.errorCode, 'RAG_FILE_TOO_LARGE');
});

test('slow multipart upload is invisible until the full file is atomically committed', async (t) => {
  const { runtime, api } = await setup(t);
  const topic = await createTopic(api, '慢上传 Topic', { suffix: 'slow' });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const boundary = `----rag-${Date.now()}`;
  const fileBytes = Buffer.from('slow but valid UTF-8 text content', 'utf8');
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="topicId"\r\n\r\n${topic.topicId}\r\n`
      + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slow.txt"\r\nContent-Type: text/plain\r\n\r\n`,
    'utf8'
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const totalLength = prefix.length + fileBytes.length + suffix.length;
  const address = server.address();
  const responsePromise = new Promise((resolve, reject) => {
    const outgoing = http.request({
      host: '127.0.0.1',
      port: address.port,
      path: '/api/rag/v1/documents',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': totalLength,
        'X-API-Key': API_KEY,
        'Idempotency-Key': 'slow-upload-001'
      }
    }, (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.on('end', () => resolve({ status: incoming.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    outgoing.on('error', reject);
    outgoing.write(prefix);
    outgoing.write(fileBytes.subarray(0, 5));
    setTimeout(() => outgoing.end(Buffer.concat([fileBytes.subarray(5), suffix])), 100);
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  const during = await api.get('/api/rag/v1/documents').query({ topicId: topic.topicId }).set('X-API-Key', API_KEY).expect(200);
  assert.deepEqual(during.body, []);
  const completed = await responsePromise;
  assert.equal(completed.status, 202);
  assert.equal(completed.body.jobStatus, 'QUEUED');
  const after = await api.get('/api/rag/v1/documents').query({ topicId: topic.topicId }).set('X-API-Key', API_KEY).expect(200);
  assert.equal(after.body.length, 1);
});
