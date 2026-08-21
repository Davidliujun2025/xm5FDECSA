import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { API_KEY, foundationEnv } from '../helpers/foundation.js';

function configuredEnv(dataDir, overrides = {}) {
  return foundationEnv({
    DATA_DIR: dataDir,
    MODEL_BASE_URL: 'https://models.example.test/v1',
    MODEL_API_KEY: 'approved-model-key',
    EMBEDDING_MODEL: 'embed-approved-v1',
    MODEL_CONNECT_TIMEOUT_SECONDS: '2',
    MODEL_TOTAL_TIMEOUT_SECONDS: '5',
    ...overrides
  });
}

function successResponse(options, dimension = 3) {
  const body = JSON.parse(options.body);
  return new Response(JSON.stringify({
    model: body.model,
    data: body.input.map((text, index) => ({
      index,
      embedding: Array.from({ length: dimension }, (_, offset) => (text.length + index + offset + 1) / 100)
    }))
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function createActiveTopic(api, suffix) {
  const created = await api.post('/api/rag/v1/topics')
    .set('X-API-Key', API_KEY)
    .set('Idempotency-Key', `ingestion-topic-${suffix}`)
    .send({ name: `Ingestion ${suffix}` })
    .expect(201);
  await api.patch(`/api/rag/v1/topics/${created.body.topicId}`)
    .set('X-API-Key', API_KEY)
    .set('Idempotency-Key', `ingestion-active-${suffix}`)
    .send({ status: 'ACTIVE' })
    .expect(200);
  return created.body.topicId;
}

async function uploadText(api, topicId, suffix, text) {
  const response = await api.post('/api/rag/v1/documents')
    .set('X-API-Key', API_KEY)
    .set('Idempotency-Key', `ingestion-upload-${suffix}`)
    .field('topicId', topicId)
    .attach('file', Buffer.from(text, 'utf8'), { filename: `${suffix}.txt`, contentType: 'text/plain' })
    .expect(202);
  return response.body;
}

async function getJob(api, jobId) {
  return (await api.get(`/api/rag/v1/jobs/${jobId}`).set('X-API-Key', API_KEY).expect(200)).body;
}

async function waitForJob(api, jobId, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let job;
  while (Date.now() < deadline) {
    job = await getJob(api, jobId);
    if (predicate(job)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`job ${jobId} did not reach expected state: ${JSON.stringify(job)}`);
}

test('job loop serializes ingestion and lifecycle keeps READY separate from PUBLISHED', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-ingestion-main-'));
  let releaseFirst;
  let markModelStarted;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const modelStarted = new Promise((resolve) => {
    markModelStarted = resolve;
  });
  let calls = 0;
  let activeCalls = 0;
  let maxActiveCalls = 0;
  let outputDimension = 3;
  const batchSizes = [];
  const embeddingFetch = async (url, options) => {
    calls += 1;
    activeCalls += 1;
    maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
    batchSizes.push(JSON.parse(options.body).input.length);
    if (calls === 1) {
      markModelStarted();
      await firstGate;
    }
    const response = successResponse(options, outputDimension);
    activeCalls -= 1;
    return response;
  };
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: configuredEnv(dataDir),
    embeddingFetch
  });
  t.after(async () => {
    releaseFirst();
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();
  const api = request(runtime.app);
  const topicId = await createActiveTopic(api, 'main');

  const first = await uploadText(api, topicId, 'first', 'First policy fact. '.repeat(2200));
  await modelStarted;
  const firstProcessing = await getJob(api, first.jobId);
  assert.equal(firstProcessing.status, 'PROCESSING');
  assert.equal(firstProcessing.stage, 'EMBEDDING');

  const second = await uploadText(api, topicId, 'second', 'Second different policy fact. '.repeat(150));
  assert.equal((await getJob(api, second.jobId)).status, 'QUEUED');
  await api.get('/health/live').expect(200);
  const tooEarly = await api.post(`/api/rag/v1/documents/${second.documentId}/publish`)
    .set('X-API-Key', API_KEY).expect(409);
  assert.equal(tooEarly.body.errorCode, 'RAG_DOCUMENT_NOT_READY');

  releaseFirst();
  const firstDone = await waitForJob(api, first.jobId, (job) => job.status === 'SUCCEEDED');
  const secondDone = await waitForJob(api, second.jobId, (job) => job.status === 'SUCCEEDED');
  assert.equal(firstDone.attemptCount, 1);
  assert.equal(secondDone.attemptCount, 1);
  assert.equal(maxActiveCalls, 1);
  assert.ok(batchSizes.every((size) => size >= 1 && size <= 32));
  assert.equal(batchSizes.includes(32), true);

  outputDimension = 4;
  const drifted = await uploadText(api, topicId, 'dimension-drift', 'Third dimension drift fact.');
  const driftedJob = await waitForJob(api, drifted.jobId, (job) => job.status === 'FAILED');
  assert.equal(driftedJob.errorCode, 'RAG_MODEL_OUTPUT_INVALID');
  assert.equal(driftedJob.attemptCount, 1);
  assert.equal(runtime.ingestionRepository.listDocumentChunks(drifted.documentId).length, 0);

  const firstDocument = (await api.get(`/api/rag/v1/documents/${first.documentId}`)
    .set('X-API-Key', API_KEY).expect(200)).body;
  assert.equal(firstDocument.status, 'READY');
  assert.match(firstDocument.parseVersion, /^index_[0-9a-f]{24}$/);
  assert.equal(firstDocument.publishedAt, null);

  const chunks = runtime.ingestionRepository.listDocumentChunks(first.documentId);
  assert.ok(chunks.length > 0);
  assert.ok(chunks.every((chunk) => (
    chunk.topic_id === topicId
    && chunk.embedding_model === 'embed-approved-v1'
    && chunk.embedding_dim === 3
    && chunk.embedding_space === 'cosine'
    && chunk.embedding.length === 12
    && chunk.parse_version === firstDocument.parseVersion
  )));

  await api.post(`/api/rag/v1/documents/${first.documentId}/publish`).expect(401);
  const published = await api.post(`/api/rag/v1/documents/${first.documentId}/publish`)
    .set('X-API-Key', API_KEY).expect(200);
  assert.equal(published.body.status, 'PUBLISHED');
  assert.ok(published.body.publishedAt);
  await api.post(`/api/rag/v1/documents/${first.documentId}/publish`)
    .set('X-API-Key', API_KEY).expect(409);

  const browserSession = await api.post('/api/rag/v1/auth/browser-session')
    .set('Origin', 'http://localhost:5173').expect(204);
  const cookie = browserSession.headers['set-cookie'][0].split(';')[0];
  await api.get(`/api/rag/v1/documents/${first.documentId}`)
    .set('Origin', 'http://localhost:5173').set('Cookie', cookie).expect(200);

  const disabled = await api.post(`/api/rag/v1/documents/${first.documentId}/disable`)
    .set('X-API-Key', API_KEY).expect(200);
  assert.equal(disabled.body.status, 'DISABLED');
  assert.ok(disabled.body.disabledAt);
  await api.get(`/api/rag/v1/documents/${first.documentId}`)
    .set('Origin', 'http://localhost:5173').set('Cookie', cookie).expect(404);
});

test('deterministic model failures roll back all chunks while 429 retries at most twice', async (t) => {
  const scenarios = [
    {
      name: 'unauthorized',
      fetch: async () => new Response('vendor credential detail', { status: 401 }),
      expectedStatus: 'FAILED', expectedAttempts: 1, expectedCode: 'RAG_MODEL_UNAVAILABLE'
    },
    {
      name: 'rate-limit-recovers',
      fetch: (() => {
        let calls = 0;
        return async (url, options) => {
          calls += 1;
          return calls <= 2 ? new Response('vendor rate detail', { status: 429 }) : successResponse(options);
        };
      })(),
      expectedStatus: 'SUCCEEDED', expectedAttempts: 3, expectedCode: null
    },
    {
      name: 'rate-limit-exhausted',
      fetch: async () => new Response('vendor rate detail', { status: 429 }),
      expectedStatus: 'FAILED', expectedAttempts: 3, expectedCode: 'RAG_MODEL_RATE_LIMITED'
    },
    {
      name: 'invalid-output',
      fetch: async () => new Response(JSON.stringify({ model: 'embed-approved-v1', data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }),
      expectedStatus: 'FAILED', expectedAttempts: 1, expectedCode: 'RAG_MODEL_OUTPUT_INVALID'
    },
    {
      name: 'dimension-mismatch',
      fetch: async (url, options) => {
        const body = JSON.parse(options.body);
        return new Response(JSON.stringify({
          model: body.model,
          data: body.input.map((text, index) => ({
            index,
            embedding: index === 0 ? [0.1, 0.2] : [0.3]
          }))
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
      text: 'Dimension mismatch policy fact. '.repeat(100),
      expectedStatus: 'FAILED', expectedAttempts: 1, expectedCode: 'RAG_MODEL_OUTPUT_INVALID'
    },
    {
      name: 'timeout',
      fetch: (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('vendor timeout detail', 'AbortError')), { once: true });
      }),
      envOverrides: { MODEL_CONNECT_TIMEOUT_SECONDS: '1', MODEL_TOTAL_TIMEOUT_SECONDS: '1' },
      expectedStatus: 'FAILED', expectedAttempts: 3, expectedCode: 'RAG_MODEL_UNAVAILABLE'
    }
  ];

  for (const scenario of scenarios) {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), `rag-ingestion-${scenario.name}-`));
    const runtime = await createRuntime({
      appRoot: APP_ROOT,
      env: configuredEnv(dataDir, scenario.envOverrides),
      embeddingFetch: scenario.fetch
    });
    await runtime.initialize();
    try {
      const api = request(runtime.app);
      const topicId = await createActiveTopic(api, scenario.name);
      const uploaded = await uploadText(api, topicId, scenario.name, scenario.text ?? `${scenario.name} policy fact`);
      const job = await waitForJob(api, uploaded.jobId, (value) => value.status === scenario.expectedStatus);
      assert.equal(job.attemptCount, scenario.expectedAttempts, scenario.name);
      assert.equal(job.errorCode, scenario.expectedCode, scenario.name);
      assert.equal(JSON.stringify(job).includes('vendor'), false, scenario.name);
      const chunkCount = runtime.database.prepare('SELECT COUNT(*) AS count FROM chunk WHERE document_id = ?').get(uploaded.documentId).count;
      assert.equal(chunkCount > 0, scenario.expectedStatus === 'SUCCEEDED', scenario.name);
    } finally {
      await runtime.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
  assert.ok(true);
});

test('chunk capacity failure leaves no index and interrupted PROCESSING work recovers after restart', async (t) => {
  const capacityDir = mkdtempSync(path.join(os.tmpdir(), 'rag-ingestion-capacity-'));
  const capacityRuntime = await createRuntime({
    appRoot: APP_ROOT,
    env: configuredEnv(capacityDir, { MAX_TOTAL_CHUNKS: '1' }),
    embeddingFetch: async (url, options) => successResponse(options)
  });
  await capacityRuntime.initialize();
  try {
    const api = request(capacityRuntime.app);
    const topicId = await createActiveTopic(api, 'capacity');
    const uploaded = await uploadText(api, topicId, 'capacity', 'Capacity policy text. '.repeat(180));
    const job = await waitForJob(api, uploaded.jobId, (value) => value.status === 'FAILED');
    assert.equal(job.errorCode, 'RAG_CAPACITY_LIMIT');
    assert.equal(capacityRuntime.ingestionRepository.countChunks(), 0);
  } finally {
    await capacityRuntime.close();
    rmSync(capacityDir, { recursive: true, force: true });
  }

  const recoveryDir = mkdtempSync(path.join(os.tmpdir(), 'rag-ingestion-recovery-'));
  const firstRuntime = await createRuntime({
    appRoot: APP_ROOT,
    env: foundationEnv({ DATA_DIR: recoveryDir })
  });
  await firstRuntime.initialize();
  const firstApi = request(firstRuntime.app);
  const topicId = await createActiveTopic(firstApi, 'recovery');
  const uploaded = await uploadText(firstApi, topicId, 'recovery', 'Recovered policy fact.');
  firstRuntime.database.prepare(`
    UPDATE job SET status = 'PROCESSING', stage = 'EMBEDDING', attempt_count = 1, started_at = ? WHERE id = ?
  `).run(new Date().toISOString(), uploaded.jobId);
  firstRuntime.database.prepare(`UPDATE document SET status = 'PROCESSING' WHERE id = ?`).run(uploaded.documentId);
  await firstRuntime.close();

  const recoveredRuntime = await createRuntime({
    appRoot: APP_ROOT,
    env: configuredEnv(recoveryDir),
    embeddingFetch: async (url, options) => successResponse(options)
  });
  t.after(async () => {
    await recoveredRuntime.close();
    rmSync(recoveryDir, { recursive: true, force: true });
  });
  await recoveredRuntime.initialize();
  const recoveredJob = await waitForJob(request(recoveredRuntime.app), uploaded.jobId, (value) => value.status === 'SUCCEEDED');
  assert.equal(recoveredJob.attemptCount, 2);
  assert.equal(recoveredRuntime.ingestionRepository.countChunks(), 1);
});
