import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { API_KEY, foundationEnv } from '../helpers/foundation.js';

const EXPECTED_OPERATIONS = new Set([
  'GET /health/live', 'GET /health/ready', 'POST /api/rag/v1/auth/browser-session',
  'GET /api/rag/v1/topics', 'POST /api/rag/v1/topics', 'PATCH /api/rag/v1/topics/{topicId}',
  'POST /api/rag/v1/documents', 'GET /api/rag/v1/documents',
  'GET /api/rag/v1/documents/{documentId}', 'POST /api/rag/v1/documents/{documentId}/publish',
  'POST /api/rag/v1/documents/{documentId}/disable', 'GET /api/rag/v1/documents/{documentId}/file',
  'GET /api/rag/v1/jobs/{jobId}', 'POST /api/rag/v1/search', 'POST /api/rag/v1/chat', 'POST /api/chat'
]);

async function waitSucceeded(api, jobId) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const job = (await api.get(`/api/rag/v1/jobs/${jobId}`).set('X-API-Key', API_KEY).expect(200)).body;
    if (job.status === 'SUCCEEDED') return job;
    if (job.status === 'FAILED') assert.fail(JSON.stringify(job));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`job timeout: ${jobId}`);
}

test('all 16 public operations run through production DI with frontend and backend callers', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-public-e2e-'));
  const covered = new Set();
  const logEvents = [];
  const logger = Object.fromEntries(['info', 'warn', 'error'].map((level) => [level, (fields, message) => logEvents.push({ level, fields, message })]));
  let releaseSlow;
  let slowStartedCount = 0;
  let markThreeSlowStarted;
  const threeSlowStarted = new Promise((resolve) => {
    markThreeSlowStarted = resolve;
  });
  const slowGate = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  const embeddingFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify({
      model: body.model,
      data: body.input.map((text, index) => ({ index, embedding: [1, 0] }))
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const chatFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.messages[1].content;
    if (prompt.includes('SLOW_CONCURRENCY')) {
      slowStartedCount += 1;
      if (slowStartedCount === 3) markThreeSlowStarted();
      await slowGate;
    }
    const citationId = /"citationId":"([^"]+)"/.exec(prompt)?.[1];
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ claims: [{ text: '生产链路脱敏事实。', citationIds: [citationId] }] }) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const defaultTopicId = `topic_${'d'.repeat(32)}`;
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: foundationEnv({
      DATA_DIR: dataDir,
      FRONTEND_DEFAULT_TOPIC_ID: defaultTopicId,
      MODEL_BASE_URL: 'https://models.example.test/v1',
      MODEL_API_KEY: 'e2e-model-key',
      EMBEDDING_MODEL: 'e2e-embedding-v1',
      CHAT_MODEL: 'e2e-chat-v1',
      MAX_CONCURRENT_REQUESTS: '3'
    }),
    logger,
    initializationDelayMs: 50,
    embeddingFetch,
    chatFetch
  });
  t.after(async () => {
    releaseSlow();
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  const api = request(runtime.app);

  await api.get('/health/live').expect(200); covered.add('GET /health/live');
  await api.get('/health/ready').expect(503); covered.add('GET /health/ready');
  const initializing = runtime.initialize();
  await initializing;
  await api.get('/health/ready').expect(200);

  const session = await api.post('/api/rag/v1/auth/browser-session')
    .set('Origin', 'http://localhost:5173').expect(204);
  covered.add('POST /api/rag/v1/auth/browser-session');
  const cookie = session.headers['set-cookie'][0].split(';')[0];

  const created = await api.post('/api/rag/v1/topics')
    .set('X-API-Key', API_KEY).set('Idempotency-Key', 'public-e2e-topic')
    .send({ name: 'Public E2E Topic' }).expect(201);
  covered.add('POST /api/rag/v1/topics');
  assert.equal(created.body.topicId.length, 38);
  runtime.database.prepare('UPDATE topic SET id = ? WHERE id = ?').run(defaultTopicId, created.body.topicId);
  await api.patch(`/api/rag/v1/topics/${defaultTopicId}`)
    .set('X-API-Key', API_KEY).set('Idempotency-Key', 'public-e2e-topic-active')
    .send({ status: 'ACTIVE' }).expect(200);
  covered.add('PATCH /api/rag/v1/topics/{topicId}');
  assert.equal((await api.get('/api/rag/v1/topics').set('X-API-Key', API_KEY).expect(200)).body.length, 1);
  covered.add('GET /api/rag/v1/topics');

  const uploadStarted = performance.now();
  const uploaded = await api.post('/api/rag/v1/documents')
    .set('X-API-Key', API_KEY).set('Idempotency-Key', 'public-e2e-upload')
    .field('topicId', defaultTopicId)
    .attach('file', Buffer.from('production route grounded evidence'), { filename: 'e2e.txt', contentType: 'text/plain' })
    .expect(202);
  assert.ok(performance.now() - uploadStarted < 2000);
  covered.add('POST /api/rag/v1/documents');
  const { documentId, jobId } = uploaded.body;
  assert.equal((await api.get('/api/rag/v1/documents').set('X-API-Key', API_KEY).query({ topicId: defaultTopicId }).expect(200)).body.length, 1);
  covered.add('GET /api/rag/v1/documents');
  await api.get(`/api/rag/v1/documents/${documentId}`).set('X-API-Key', API_KEY).expect(200);
  covered.add('GET /api/rag/v1/documents/{documentId}');
  await waitSucceeded(api, jobId);
  covered.add('GET /api/rag/v1/jobs/{jobId}');
  const ready = await api.get(`/api/rag/v1/documents/${documentId}`).set('X-API-Key', API_KEY).expect(200);
  assert.equal(ready.body.status, 'READY');
  const beforePublish = await api.post('/api/rag/v1/search').set('X-API-Key', API_KEY)
    .send({ topicId: defaultTopicId, question: 'grounded evidence' }).expect(200);
  assert.deepEqual(beforePublish.body.results, []);

  const publishStarted = performance.now();
  const published = await api.post(`/api/rag/v1/documents/${documentId}/publish`)
    .set('X-API-Key', API_KEY).expect(200);
  assert.equal(published.body.status, 'PUBLISHED');
  covered.add('POST /api/rag/v1/documents/{documentId}/publish');
  const searchStarted = performance.now();
  const search = await api.post('/api/rag/v1/search').set('X-API-Key', API_KEY)
    .send({ topicId: defaultTopicId, question: 'grounded evidence' }).expect(200);
  assert.ok(performance.now() - searchStarted < 5000);
  assert.equal(search.body.results.length, 1);
  assert.ok(performance.now() - publishStarted < 10000);
  covered.add('POST /api/rag/v1/search');

  const chatStarted = performance.now();
  const chat = await api.post('/api/rag/v1/chat').set('X-API-Key', API_KEY)
    .send({ topicId: defaultTopicId, question: 'grounded evidence' }).expect(200);
  assert.ok(performance.now() - chatStarted < 20000);
  assert.equal(chat.body.status, 'ANSWERED');
  assert.equal(chat.body.topicId, defaultTopicId);
  assert.equal(chat.body.citations.length, 1);
  assert.equal(chat.body.citations[0].documentId, documentId);
  assert.match(chat.body.answer, /\[1\]/);
  covered.add('POST /api/rag/v1/chat');
  const compatibility = await api.post('/api/chat')
    .set('Origin', 'http://localhost:5173').set('Cookie', cookie)
    .send({ message: 'grounded evidence' }).expect(200);
  assert.equal(compatibility.body.status, 'ANSWERED');
  assert.equal(compatibility.body.topicId, defaultTopicId);
  covered.add('POST /api/chat');
  await api.get(`/api/rag/v1/documents/${documentId}/file`)
    .set('Origin', 'http://localhost:5173').set('Cookie', cookie).expect(200).expect('production route grounded evidence');
  covered.add('GET /api/rag/v1/documents/{documentId}/file');

  const slowRequests = Array.from({ length: 3 }, (_, index) => api.post('/api/rag/v1/chat')
    .set('X-API-Key', API_KEY)
    .send({ topicId: defaultTopicId, question: `grounded SLOW_CONCURRENCY ${index}` })
    .then((response) => response));
  await threeSlowStarted;
  const overCapacity = await api.post('/api/rag/v1/chat').set('X-API-Key', API_KEY)
    .send({ topicId: defaultTopicId, question: 'fourth concurrent request' }).expect(429);
  assert.equal(overCapacity.body.errorCode, 'RAG_BUSY');
  releaseSlow();
  assert.deepEqual((await Promise.all(slowRequests)).map((response) => response.body.status), ['ANSWERED', 'ANSWERED', 'ANSWERED']);

  const disableStarted = performance.now();
  const disabled = await api.post(`/api/rag/v1/documents/${documentId}/disable`)
    .set('X-API-Key', API_KEY).expect(200);
  assert.equal(disabled.body.status, 'DISABLED');
  covered.add('POST /api/rag/v1/documents/{documentId}/disable');
  const afterDisable = await api.post('/api/rag/v1/search').set('X-API-Key', API_KEY)
    .send({ topicId: defaultTopicId, question: 'grounded evidence' }).expect(200);
  assert.deepEqual(afterDisable.body.results, []);
  assert.ok(performance.now() - disableStarted < 10000);

  assert.deepEqual([...covered].sort(), [...EXPECTED_OPERATIONS].sort());
  const requestLogs = logEvents.filter((event) => event.fields.operation === 'http.request');
  assert.ok(requestLogs.length >= EXPECTED_OPERATIONS.size);
  assert.ok(requestLogs.every((event) => event.fields.traceId && Number.isInteger(event.fields.statusCode)));
  assert.equal(JSON.stringify(logEvents).includes(API_KEY), false);
  assert.equal(JSON.stringify(logEvents).includes('e2e-model-key'), false);
});
