import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { createAcceptanceTopicBootstrap } from '../../backend/src/acceptance/topic-bootstrap.js';
import { createAcceptanceModelProvider } from '../../backend/src/adapters/models/acceptance-models.js';
import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import {
  createAcceptanceEnvironment,
  createAcceptanceRouteRegistrar
} from '../../scripts/start-acceptance.js';
import { FORMAT_FIXTURES } from '../helpers/document-fixtures.js';

const ORIGIN = 'http://127.0.0.1:3000';

async function createActiveTopic(api, apiKey, name, suffix) {
  const created = await api.post('/api/rag/v1/topics')
    .set('X-API-Key', apiKey)
    .set('Idempotency-Key', `acceptance-topic-create-${suffix}`)
    .send({ name })
    .expect(201);
  await api.patch(`/api/rag/v1/topics/${created.body.topicId}`)
    .set('X-API-Key', apiKey)
    .set('Idempotency-Key', `acceptance-topic-active-${suffix}`)
    .send({ status: 'ACTIVE' })
    .expect(200);
  return created.body;
}

function browser(api, method, pathName, cookie, { origin = true } = {}) {
  const call = api[method](pathName)
    .set('Host', '127.0.0.1:3000')
    .set('Cookie', cookie);
  return origin ? call.set('Origin', ORIGIN) : call;
}

async function waitForLocalJob(api, cookie, jobId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await browser(api, 'get', `/api/acceptance/jobs/${jobId}`, cookie).expect(200);
    if (response.body.status === 'SUCCEEDED') {
      return response.body;
    }
    if (response.body.status === 'FAILED') {
      assert.fail(JSON.stringify(response.body));
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`acceptance job timed out: ${jobId}`);
}

test('formal acceptance route keeps upload unpublished until an explicit scoped publish action', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-local-acceptance-'));
  const context = { topicId: null, topicName: null, topicStatus: null };
  const acceptanceProvider = createAcceptanceModelProvider();
  let releaseEmbedding;
  let markEmbeddingStarted;
  let embeddingMarked = false;
  const embeddingGate = new Promise((resolve) => {
    releaseEmbedding = resolve;
  });
  const embeddingStarted = new Promise((resolve) => {
    markEmbeddingStarted = resolve;
  });
  const gatedProvider = Object.freeze({
    ...acceptanceProvider,
    createEmbeddingClient(options) {
      const client = acceptanceProvider.createEmbeddingClient(options);
      const embed = client.embed.bind(client);
      client.embed = async (texts) => {
        if (!embeddingMarked) {
          embeddingMarked = true;
          markEmbeddingStarted();
        }
        await embeddingGate;
        return embed(texts);
      };
      return client;
    }
  });
  const env = createAcceptanceEnvironment({ appRoot: APP_ROOT, baseEnv: {}, dataDir });
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env,
    modelProvider: gatedProvider,
    registerRoutes: createAcceptanceRouteRegistrar(context),
    runtimeBootstrap: createAcceptanceTopicBootstrap({ context })
  });
  t.after(async () => {
    releaseEmbedding();
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();
  const api = request(runtime.app);

  const session = await api.post('/api/rag/v1/auth/browser-session')
    .set('Host', '127.0.0.1:3000')
    .set('Origin', ORIGIN)
    .expect(204);
  const cookie = session.headers['set-cookie'][0].split(';')[0];

  await api.get('/api/acceptance/context').set('Host', '127.0.0.1:3000').expect(401);
  const contextResponse = await browser(api, 'get', '/api/acceptance/context', cookie).expect(200);
  assert.equal(contextResponse.body.topicId, context.topicId);
  assert.equal(contextResponse.body.topicStatus, 'ACTIVE');
  assert.deepEqual(contextResponse.body.supportedFormats, ['PDF', 'DOCX', 'XLSX', 'PPTX', 'MD', 'TXT']);

  const fixture = FORMAT_FIXTURES.find((item) => item.extension === 'txt');
  await browser(api, 'post', '/api/acceptance/documents', cookie, { origin: false })
    .attach('file', fixture.bytes, { filename: '缺少来源头.txt', contentType: fixture.mime })
    .expect(403);
  const accepted = await browser(api, 'post', '/api/acceptance/documents', cookie)
    .attach('file', fixture.bytes, { filename: '人工验收资料.txt', contentType: fixture.mime })
    .expect(202);
  assert.equal(accepted.body.status, 'UPLOADED');
  assert.equal(accepted.body.jobStatus, 'QUEUED');

  await embeddingStarted;
  const processing = await browser(
    api,
    'get',
    `/api/acceptance/documents/${accepted.body.documentId}`,
    cookie
  ).expect(200);
  assert.equal(processing.body.status, 'PROCESSING');
  const tooEarly = await browser(
    api,
    'post',
    `/api/acceptance/documents/${accepted.body.documentId}/publish`,
    cookie
  ).expect(409);
  assert.equal(tooEarly.body.errorCode, 'RAG_DOCUMENT_NOT_READY');
  releaseEmbedding();

  const job = await waitForLocalJob(api, cookie, accepted.body.jobId);
  assert.equal(job.documentId, accepted.body.documentId);
  const ready = await browser(api, 'get', `/api/acceptance/documents/${accepted.body.documentId}`, cookie).expect(200);
  assert.equal(ready.body.status, 'READY');
  assert.equal(ready.body.fileName, '人工验收资料.txt');

  const question = fixture.bytes.toString('utf8');
  const beforePublish = await api.post('/api/rag/v1/search')
    .set('X-API-Key', env.RAG_API_KEY)
    .send({ topicId: context.topicId, question })
    .expect(200);
  assert.deepEqual(beforePublish.body.results, []);

  const published = await browser(
    api,
    'post',
    `/api/acceptance/documents/${accepted.body.documentId}/publish`,
    cookie
  ).expect(200);
  assert.equal(published.body.status, 'PUBLISHED');
  const duplicatePublish = await browser(
    api,
    'post',
    `/api/acceptance/documents/${accepted.body.documentId}/publish`,
    cookie
  ).expect(409);
  assert.equal(duplicatePublish.body.errorCode, 'RAG_DOCUMENT_NOT_READY');

  const afterPublish = await api.post('/api/rag/v1/search')
    .set('X-API-Key', env.RAG_API_KEY)
    .send({ topicId: context.topicId, question })
    .expect(200);
  assert.equal(afterPublish.body.results[0].documentId, accepted.body.documentId);

  const original = await browser(
    api,
    'get',
    `/api/acceptance/documents/${accepted.body.documentId}/file`,
    cookie
  ).expect(200);
  assert.equal(original.text, fixture.bytes.toString('utf8'));
  assert.match(original.headers['content-disposition'], /filename\*=UTF-8''/);

  const otherTopic = await createActiveTopic(api, env.RAG_API_KEY, '非验收 Topic', 'other');
  const otherUpload = await api.post('/api/rag/v1/documents')
    .set('X-API-Key', env.RAG_API_KEY)
    .set('Idempotency-Key', 'acceptance-other-upload')
    .field('topicId', otherTopic.topicId)
    .attach('file', Buffer.from('另一个 Topic 的资料', 'utf8'), { filename: 'other.txt', contentType: 'text/plain' })
    .expect(202);
  for (const [method, pathName] of [
    ['get', `/api/acceptance/documents/${otherUpload.body.documentId}`],
    ['get', `/api/acceptance/jobs/${otherUpload.body.jobId}`],
    ['post', `/api/acceptance/documents/${otherUpload.body.documentId}/publish`]
  ]) {
    const hidden = await browser(api, method, pathName, cookie).expect(404);
    assert.equal(hidden.body.errorCode, 'RAG_DOCUMENT_NOT_FOUND');
  }
});
