import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import {
  ACCEPTANCE_CHAT_MODEL,
  ACCEPTANCE_EMBEDDING_MODEL,
  ACCEPTANCE_MODEL_KIND,
  createAcceptanceModelProvider
} from '../../backend/src/adapters/models/acceptance-models.js';
import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { createAcceptanceEnvironment } from '../../scripts/start-acceptance.js';

const EVIDENCE = '离线验收编号 AURORA-4821 的状态是可重复。';

async function waitSucceeded(api, apiKey, jobId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await api.get(`/api/rag/v1/jobs/${jobId}`)
      .set('X-API-Key', apiKey)
      .expect(200);
    if (response.body.status === 'SUCCEEDED') {
      return response.body;
    }
    if (response.body.status === 'FAILED') {
      assert.fail(JSON.stringify(response.body));
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`acceptance model job timed out: ${jobId}`);
}

test('acceptance models complete offline upload and grounded answer with loading, empty and API error states', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-acceptance-models-'));
  const env = createAcceptanceEnvironment({ appRoot: APP_ROOT, baseEnv: {}, dataDir });
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('network is disabled for acceptance models');
  };
  let runtime;
  t.after(async () => {
    await runtime?.close();
    globalThis.fetch = originalFetch;
    rmSync(dataDir, { recursive: true, force: true });
  });

  runtime = await createRuntime({
    appRoot: APP_ROOT,
    env,
    modelProvider: createAcceptanceModelProvider()
  });
  const api = request(runtime.app);

  const loading = await api.get('/health/ready').expect(503);
  assert.equal(loading.body.errorCode, 'RAG_NOT_READY');
  assert.equal(loading.body.details.status, 'INITIALIZING');

  await runtime.initialize();
  await api.get('/health/ready').expect(200);
  assert.equal(runtime.config.model.providerKind, ACCEPTANCE_MODEL_KIND);
  assert.equal(runtime.config.model.embeddingModel, ACCEPTANCE_EMBEDDING_MODEL);
  assert.equal(runtime.config.model.chatModel, ACCEPTANCE_CHAT_MODEL);

  const topic = await api.post('/api/rag/v1/topics')
    .set('X-API-Key', env.RAG_API_KEY)
    .set('Idempotency-Key', 'acceptance-model-topic-create')
    .send({ name: 'T1.2 离线验收 Topic' })
    .expect(201);
  await api.patch(`/api/rag/v1/topics/${topic.body.topicId}`)
    .set('X-API-Key', env.RAG_API_KEY)
    .set('Idempotency-Key', 'acceptance-model-topic-activate')
    .send({ status: 'ACTIVE' })
    .expect(200);

  const uploaded = await api.post('/api/rag/v1/documents')
    .set('X-API-Key', env.RAG_API_KEY)
    .set('Idempotency-Key', 'acceptance-model-offline-upload')
    .field('topicId', topic.body.topicId)
    .attach('file', Buffer.from(EVIDENCE, 'utf8'), {
      filename: 'synthetic-offline-evidence.txt',
      contentType: 'text/plain'
    })
    .expect(202);
  await waitSucceeded(api, env.RAG_API_KEY, uploaded.body.jobId);

  const beforePublish = await api.post('/api/rag/v1/chat')
    .set('X-API-Key', env.RAG_API_KEY)
    .send({ topicId: topic.body.topicId, question: EVIDENCE })
    .expect(200);
  assert.equal(beforePublish.body.status, 'NO_RELIABLE_EVIDENCE');
  assert.deepEqual(beforePublish.body.citations, []);

  await api.post(`/api/rag/v1/documents/${uploaded.body.documentId}/publish`)
    .set('X-API-Key', env.RAG_API_KEY)
    .expect(200);

  const search = await api.post('/api/rag/v1/search')
    .set('X-API-Key', env.RAG_API_KEY)
    .send({ topicId: topic.body.topicId, question: EVIDENCE })
    .expect(200);
  assert.equal(search.body.results[0].documentId, uploaded.body.documentId);
  assert.equal(search.body.results[0].score, 1);

  const answered = await api.post('/api/rag/v1/chat')
    .set('X-API-Key', env.RAG_API_KEY)
    .send({ topicId: topic.body.topicId, question: EVIDENCE })
    .expect(200);
  assert.equal(answered.body.status, 'ANSWERED');
  assert.equal(answered.body.answer, `${EVIDENCE}[1]`);
  assert.equal(answered.body.citations.length, 1);
  assert.equal(answered.body.citations[0].documentId, uploaded.body.documentId);
  assert.equal(answered.body.citations[0].excerpt, EVIDENCE);

  const noKnowledge = await api.post('/api/rag/v1/chat')
    .set('X-API-Key', env.RAG_API_KEY)
    .send({ topicId: topic.body.topicId, question: '完全无关的 OMEGA-9900 状态是什么？' })
    .expect(200);
  assert.equal(noKnowledge.body.status, 'NO_RELIABLE_EVIDENCE');
  assert.deepEqual(noKnowledge.body.citations, []);

  const invalid = await api.post('/api/rag/v1/chat')
    .set('X-API-Key', env.RAG_API_KEY)
    .send({ topicId: topic.body.topicId, question: '' })
    .expect(400);
  assert.equal(invalid.body.errorCode, 'RAG_INVALID_REQUEST');

  const stored = runtime.database.prepare(`
    SELECT embedding_model AS embeddingModel, embedding_dim AS embeddingDimension
    FROM chunk
    WHERE document_id = ?
  `).get(uploaded.body.documentId);
  assert.equal(stored.embeddingModel, ACCEPTANCE_EMBEDDING_MODEL);
  assert.equal(stored.embeddingDimension, 384);
  assert.equal(networkCalls, 0);
});
