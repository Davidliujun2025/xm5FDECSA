import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import {
  loadConfirmedQuestionSet,
  recordAcceptanceResults
} from '../../backend/src/acceptance/acceptance-results.js';
import {
  buildAcceptanceEvidence,
  REAL_ACCEPTANCE_EVIDENCE_FILE
} from '../../backend/src/acceptance/real-acceptance.js';
import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { API_KEY, foundationEnv } from '../helpers/foundation.js';

const COMPLETE_MODEL_CONFIG = Object.freeze({
  MODEL_BASE_URL: 'https://models.example.test/v1',
  MODEL_API_KEY: 'synthetic-model-key',
  EMBEDDING_MODEL: 'synthetic-embedding-v1',
  CHAT_MODEL: 'synthetic-chat-v1'
});

function configuredEnv(dataDir) {
  return foundationEnv({ DATA_DIR: dataDir, ...COMPLETE_MODEL_CONFIG });
}

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

async function createActiveTopic(api, suffix) {
  const created = await api.post('/api/rag/v1/topics')
    .set('X-API-Key', API_KEY)
    .set('Idempotency-Key', `results-topic-${suffix}`)
    .send({ name: `Real Acceptance ${suffix}` })
    .expect(201);
  await api.patch(`/api/rag/v1/topics/${created.body.topicId}`)
    .set('X-API-Key', API_KEY)
    .set('Idempotency-Key', `results-active-${suffix}`)
    .send({ status: 'ACTIVE' })
    .expect(200);
  return created.body.topicId;
}

async function uploadAndFinish(api, topicId, suffix, text, { publish = true } = {}) {
  const uploaded = await api.post('/api/rag/v1/documents')
    .set('X-API-Key', API_KEY)
    .set('Idempotency-Key', `results-upload-${suffix}`)
    .field('topicId', topicId)
    .attach('file', Buffer.from(text, 'utf8'), { filename: `${suffix}.txt`, contentType: 'text/plain' })
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
  if (publish) {
    await api.post(`/api/rag/v1/documents/${uploaded.body.documentId}/publish`).set('X-API-Key', API_KEY).expect(200);
  }
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
    { id: 'MQ-10', status: 'NO_RELIABLE_EVIDENCE', citations: [] }
  ];
  return {
    items: baseItems.map((item) => (overrides.items ?? []).find((override) => override.id === item.id) ?? item)
  };
}

test('records a passing 10-question manual acceptance against the published document set', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-results-main-'));
  const env = configuredEnv(dataDir);
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: { ...env, NODE_ENV: 'test' },
    embeddingFetch
  });
  await runtime.initialize();
  t.after(async () => {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const api = request(runtime.app);
  const topicId = await createActiveTopic(api, 'A');
  const uploaded = await uploadAndFinish(api, topicId, 'alpha', '已批准测试资料合成内容：第一段关键数值为 42。');

  const evidencePath = path.join(dataDir, REAL_ACCEPTANCE_EVIDENCE_FILE);
  const questionSet = loadConfirmedQuestionSet();
  assert.equal(questionSet.status, 'CONFIRMED');
  const verdicts = await recordAcceptanceResults({
    questionSet,
    results: { topicId, ...resultsFor(uploaded.documentId) },
    database: runtime.database,
    topicId,
    embeddingModel: runtime.config.model.embeddingModel,
    existingEvidence: buildAcceptanceEvidence({ config: runtime.config, status: 'ENVIRONMENT_READY' }),
    evidencePath,
    conclusion: '合成测试：10 题全部满足预期。'
  });

  assert.equal(verdicts.passed, true);
  const serialized = readFileSync(evidencePath, 'utf8');
  const evidence = JSON.parse(serialized);
  assert.equal(evidence.status, 'ACCEPTANCE_PASSED');
  assert.equal(evidence.questionResults.length, 10);
  assert.ok(evidence.questionResults.every((item) => item.ok));
  assert.equal(evidence.topic.topicId, topicId);
  assert.deepEqual(evidence.documents.map((document) => document.status), ['PUBLISHED']);
  assert.ok(!serialized.includes(COMPLETE_MODEL_CONFIG.MODEL_API_KEY));
  assert.ok(!serialized.includes('RAG_API_KEY'));
});

test('rejects forged, cross-topic and unpublished citations and inconsistent statuses', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-results-reject-'));
  const env = configuredEnv(dataDir);
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: { ...env, NODE_ENV: 'test' },
    embeddingFetch
  });
  await runtime.initialize();
  t.after(async () => {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const api = request(runtime.app);
  const topicA = await createActiveTopic(api, 'A');
  const topicB = await createActiveTopic(api, 'B');
  const published = await uploadAndFinish(api, topicA, 'alpha', '合成资料 A');
  const crossTopic = await uploadAndFinish(api, topicB, 'beta', '合成资料 B');
  const unpublished = await uploadAndFinish(api, topicA, 'gamma', '合成资料 C', { publish: false });

  const questionSet = loadConfirmedQuestionSet();
  const evidencePath = path.join(dataDir, REAL_ACCEPTANCE_EVIDENCE_FILE);
  const existingEvidence = buildAcceptanceEvidence({ config: runtime.config, status: 'ENVIRONMENT_READY' });
  const base = {
    questionSet,
    database: runtime.database,
    topicId: topicA,
    embeddingModel: runtime.config.model.embeddingModel,
    existingEvidence,
    evidencePath
  };

  await assert.rejects(
    recordAcceptanceResults({
      ...base,
      results: { topicId: topicA, ...resultsFor(`doc_${'f'.repeat(32)}`) }
    }),
    (error) => error.errorCode === 'RAG_ACCEPTANCE_RESULT_INVALID'
  );
  await assert.rejects(
    recordAcceptanceResults({
      ...base,
      results: { topicId: topicA, ...resultsFor(crossTopic.documentId) }
    }),
    (error) => error.errorCode === 'RAG_ACCEPTANCE_RESULT_INVALID'
  );
  await assert.rejects(
    recordAcceptanceResults({
      ...base,
      results: { topicId: topicA, ...resultsFor(unpublished.documentId) }
    }),
    (error) => error.errorCode === 'RAG_ACCEPTANCE_RESULT_INVALID'
  );

  const wrongOrder = recordAcceptanceResults({
    ...base,
    results: { topicId: topicA, items: [resultsFor(published.documentId).items[1], ...resultsFor(published.documentId).items.slice(2)] }
  });
  await assert.rejects(wrongOrder, (error) => error.errorCode === 'RAG_ACCEPTANCE_RESULT_INVALID');

  const inconsistent = await recordAcceptanceResults({
    ...base,
    results: {
      topicId: topicA,
      ...resultsFor(published.documentId, {
        items: [
          { id: 'MQ-07', status: 'ANSWERED', citations: [{ documentId: published.documentId, location: '第1页' }] },
          { id: 'MQ-09', status: 'ANSWERED', citations: [{ documentId: published.documentId, location: '第1页' }] }
        ]
      })
    }
  });
  assert.equal(inconsistent.passed, false);
  const failedEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  assert.equal(failedEvidence.status, 'ACCEPTANCE_FAILED');
  assert.ok(failedEvidence.questionResults.some((item) => !item.ok));
});

test('rejects secret-like notes, conclusions and unconfirmed question sets', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-results-secret-'));
  const env = configuredEnv(dataDir);
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: { ...env, NODE_ENV: 'test' },
    embeddingFetch
  });
  await runtime.initialize();
  t.after(async () => {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const api = request(runtime.app);
  const topicId = await createActiveTopic(api, 'A');
  const published = await uploadAndFinish(api, topicId, 'alpha', '合成资料');

  const questionSet = loadConfirmedQuestionSet();
  const evidencePath = path.join(dataDir, REAL_ACCEPTANCE_EVIDENCE_FILE);
  const existingEvidence = buildAcceptanceEvidence({ config: runtime.config, status: 'ENVIRONMENT_READY' });
  const base = {
    questionSet,
    database: runtime.database,
    topicId,
    embeddingModel: runtime.config.model.embeddingModel,
    existingEvidence,
    evidencePath
  };

  await assert.rejects(
    recordAcceptanceResults({
      ...base,
      results: {
        topicId,
        ...resultsFor(published.documentId, {
          items: [{ id: 'MQ-01', status: 'ANSWERED', citations: [], note: 'api_key=sk-abcdefgh12345678' }]
        })
      }
    }),
    (error) => error.errorCode === 'RAG_ACCEPTANCE_RESULT_INVALID'
  );
  await assert.rejects(
    recordAcceptanceResults({
      ...base,
      results: { topicId, ...resultsFor(published.documentId) },
      conclusion: '结论附带 token=sk-abcdefgh12345678 泄露'
    }),
    (error) => error.errorCode === 'RAG_ACCEPTANCE_RESULT_INVALID'
  );
});
