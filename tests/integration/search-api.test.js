import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Ajv from 'ajv';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { API_KEY, foundationEnv } from '../helpers/foundation.js';

async function createTopic(api, suffix, active = true) {
  const created = await api.post('/api/rag/v1/topics')
    .set('X-API-Key', API_KEY).set('Idempotency-Key', `search-topic-${suffix}`)
    .send({ name: `Search ${suffix}` }).expect(201);
  if (active) {
    await api.patch(`/api/rag/v1/topics/${created.body.topicId}`)
      .set('X-API-Key', API_KEY).set('Idempotency-Key', `search-active-${suffix}`)
      .send({ status: 'ACTIVE' }).expect(200);
  }
  return created.body.topicId;
}

async function upload(api, topicId, suffix, text) {
  return (await api.post('/api/rag/v1/documents')
    .set('X-API-Key', API_KEY).set('Idempotency-Key', `search-upload-${suffix}`)
    .field('topicId', topicId)
    .attach('file', Buffer.from(text), { filename: `${suffix}.txt`, contentType: 'text/plain' })
    .expect(202)).body;
}

async function waitSucceeded(api, jobId) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const job = (await api.get(`/api/rag/v1/jobs/${jobId}`).set('X-API-Key', API_KEY).expect(200)).body;
    if (job.status === 'SUCCEEDED') {
      return;
    }
    if (job.status === 'FAILED') {
      assert.fail(JSON.stringify(job));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`job timeout: ${jobId}`);
}

function search(api, topicId, question, limit) {
  const body = { topicId, question };
  if (limit !== undefined) {
    body.limit = limit;
  }
  return api.post('/api/rag/v1/search').set('X-API-Key', API_KEY).send(body);
}

test('Search API is Topic-scoped, publication-filtered, cached, stable and bounded', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-search-'));
  let slowEnabled = false;
  let releaseSlow;
  let markSlowStarted;
  const slowStarted = new Promise((resolve) => {
    markSlowStarted = resolve;
  });
  const slowGate = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  const embeddingFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.input.length === 1 && body.input[0].includes('model unavailable')) {
      throw new TypeError('vendor network detail');
    }
    if (slowEnabled && body.input.length === 1 && body.input[0].includes('slow alpha')) {
      markSlowStarted();
      await slowGate;
    }
    const data = body.input.map((text, index) => {
      let embedding = text.includes('beta') ? [0, 1] : [1, 0];
      if (text.includes('bad dimension')) {
        embedding = [1, 0, 0];
      }
      return { index, embedding };
    });
    return new Response(JSON.stringify({ model: body.model, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: foundationEnv({
      DATA_DIR: dataDir,
      MODEL_BASE_URL: 'https://models.example.test/v1',
      MODEL_API_KEY: 'approved-model-key',
      EMBEDDING_MODEL: 'embed-approved-v1',
      MAX_CONCURRENT_REQUESTS: '1',
      EVIDENCE_THRESHOLD: '0.45'
    }),
    embeddingFetch
  });
  t.after(async () => {
    releaseSlow();
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();
  const api = request(runtime.app);
  const topicA = await createTopic(api, 'a');
  const topicB = await createTopic(api, 'b');
  const draftTopic = await createTopic(api, 'draft', false);
  const alphaOne = await upload(api, topicA, 'alpha-one', 'alpha evidence one');
  const alphaTwo = await upload(api, topicA, 'alpha-two', 'alpha evidence two distinct');
  const betaReady = await upload(api, topicA, 'beta-ready', 'beta unpublished evidence');
  const otherTopic = await upload(api, topicB, 'other-alpha', 'alpha other topic evidence');
  await Promise.all([alphaOne, alphaTwo, betaReady, otherTopic].map((item) => waitSucceeded(api, item.jobId)));

  assert.deepEqual((await search(api, topicA, 'alpha question').expect(200)).body.results, []);
  await api.post(`/api/rag/v1/documents/${alphaOne.documentId}/publish`).set('X-API-Key', API_KEY).expect(200);
  await api.post(`/api/rag/v1/documents/${alphaTwo.documentId}/publish`).set('X-API-Key', API_KEY).expect(200);
  await api.post(`/api/rag/v1/documents/${otherTopic.documentId}/publish`).set('X-API-Key', API_KEY).expect(200);

  const found = await search(api, topicA, 'alpha question').expect(200);
  assert.equal(found.body.topicId, topicA);
  assert.equal(found.body.results.length, 2);
  assert.deepEqual(
    found.body.results.map((item) => item.citationId),
    [...found.body.results.map((item) => item.citationId)].sort()
  );
  assert.deepEqual(new Set(found.body.results.map((item) => item.documentId)), new Set([alphaOne.documentId, alphaTwo.documentId]));
  for (const result of found.body.results) {
    assert.deepEqual(Object.keys(result).sort(), ['citationId', 'documentId', 'excerpt', 'fileName', 'location', 'score']);
    assert.equal(result.score, 1);
    assert.equal(result.fileName.includes('alpha'), true);
  }
  assert.equal((await search(api, topicA, 'alpha question', 1).expect(200)).body.results.length, 1);
  assert.deepEqual((await search(api, topicA, 'beta question').expect(200)).body.results, []);

  const openApi = (await api.get('/api/rag/v1/openapi.json').expect(200)).body;
  assert.equal(openApi.paths['/api/rag/v1/search'].post.operationId, 'searchTopic');
  assert.deepEqual(openApi.paths['/api/rag/v1/search'].post.security, [{ BackendApiKey: [] }, { BrowserSession: [] }]);
  const searchResponseSchema = structuredClone(openApi.components.schemas.SearchResponse);
  searchResponseSchema.properties.results.items = openApi.components.schemas.CitationCandidate;
  const validate = new Ajv({ strict: false, allowUnionTypes: true }).compile(searchResponseSchema);
  assert.equal(validate(found.body), true, JSON.stringify(validate.errors));

  await api.post('/api/rag/v1/search').send({ topicId: topicA, question: 'alpha' }).expect(401);
  await api.post('/api/rag/v1/search').set('X-API-Key', 'wrong').send({ topicId: topicA, question: 'alpha' }).expect(401);
  await search(api, topicA, 'alpha', 0).expect(400);
  await search(api, topicA, 'alpha', 11).expect(400);
  await search(api, 'bad-topic', 'alpha').expect(400);
  await search(api, 'topic_ffffffffffffffffffffffffffffffff', 'alpha').expect(404);
  const draft = await search(api, draftTopic, 'alpha').expect(409);
  assert.equal(draft.body.errorCode, 'RAG_TOPIC_NOT_ACTIVE');

  const browserSession = await api.post('/api/rag/v1/auth/browser-session')
    .set('Origin', 'http://localhost:5173').expect(204);
  const cookie = browserSession.headers['set-cookie'][0].split(';')[0];
  await api.post('/api/rag/v1/search')
    .set('Origin', 'http://localhost:5173').set('Cookie', cookie)
    .send({ topicId: topicA, question: 'alpha question' }).expect(200);

  const oldModelChunk = runtime.database.prepare('SELECT id FROM chunk WHERE document_id = ? LIMIT 1').get(alphaOne.documentId);
  runtime.database.prepare("UPDATE chunk SET embedding_model = 'old-model' WHERE id = ?").run(oldModelChunk.id);
  const filtered = await search(api, topicA, 'alpha question').expect(200);
  assert.deepEqual(filtered.body.results.map((item) => item.documentId), [alphaTwo.documentId]);
  runtime.database.prepare("UPDATE chunk SET embedding_model = 'embed-approved-v1' WHERE id = ?").run(oldModelChunk.id);

  const badDimension = await search(api, topicA, 'bad dimension').expect(422);
  assert.equal(badDimension.body.errorCode, 'RAG_MODEL_OUTPUT_INVALID');
  const unavailable = await search(api, topicA, 'model unavailable').expect(503);
  assert.equal(unavailable.body.errorCode, 'RAG_MODEL_UNAVAILABLE');
  assert.equal(JSON.stringify(unavailable.body).includes('vendor'), false);

  slowEnabled = true;
  const firstSlow = search(api, topicA, 'slow alpha').then((response) => response);
  await slowStarted;
  const busy = await search(api, topicA, 'alpha while busy').expect(429);
  assert.equal(busy.body.errorCode, 'RAG_BUSY');
  releaseSlow();
  assert.equal((await firstSlow).status, 200);
  slowEnabled = false;

  const latencies = [];
  for (let index = 0; index < 20; index += 1) {
    const startedAt = performance.now();
    await search(api, topicA, 'alpha performance').expect(200);
    latencies.push(performance.now() - startedAt);
  }
  latencies.sort((left, right) => left - right);
  assert.ok(latencies[Math.ceil(latencies.length * 0.95) - 1] < 5000);

  await api.post(`/api/rag/v1/documents/${alphaOne.documentId}/disable`).set('X-API-Key', API_KEY).expect(200);
  await api.post(`/api/rag/v1/documents/${alphaTwo.documentId}/disable`).set('X-API-Key', API_KEY).expect(200);
  assert.deepEqual((await search(api, topicA, 'alpha question').expect(200)).body.results, []);
  await api.patch(`/api/rag/v1/topics/${topicA}`)
    .set('X-API-Key', API_KEY).set('Idempotency-Key', 'search-disable-topic-a')
    .send({ status: 'DISABLED' }).expect(200);
  const disabled = await search(api, topicA, 'alpha').expect(409);
  assert.equal(disabled.body.errorCode, 'RAG_TOPIC_DISABLED');
});
