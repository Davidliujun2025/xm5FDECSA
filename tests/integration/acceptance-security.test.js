import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { createAcceptanceTopicBootstrap } from '../../backend/src/acceptance/topic-bootstrap.js';
import { createAcceptanceModelProvider } from '../../backend/src/adapters/models/acceptance-models.js';
import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { createLocalAcceptanceRouter } from '../../backend/src/routes/local-acceptance.js';
import {
  createAcceptanceEnvironment,
  createAcceptanceRouteRegistrar
} from '../../scripts/start-acceptance.js';
import { FORMAT_FIXTURES } from '../helpers/document-fixtures.js';

const HOST = '127.0.0.1:3000';
const ORIGIN = `http://${HOST}`;

function browser(api, method, pathName, cookie, origin = ORIGIN) {
  const call = api[method](pathName).set('Host', HOST);
  if (cookie) {
    call.set('Cookie', cookie);
  }
  if (origin) {
    call.set('Origin', origin);
  }
  return call;
}

async function setup(t, { envOverrides = {}, remoteAddress } = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-acceptance-security-'));
  const context = { topicId: null, topicName: null, topicStatus: null };
  const env = createAcceptanceEnvironment({
    appRoot: APP_ROOT,
    baseEnv: envOverrides,
    dataDir
  });
  const registerRoutes = remoteAddress
    ? (app, auth, fileStore) => {
      app.use('/api/acceptance', (incoming, response, next) => {
        Object.defineProperty(incoming.socket, 'remoteAddress', {
          configurable: true,
          value: remoteAddress
        });
        next();
      }, createLocalAcceptanceRouter({ auth, fileStore, context }));
    }
    : createAcceptanceRouteRegistrar(context);
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env,
    modelProvider: createAcceptanceModelProvider(),
    registerRoutes,
    runtimeBootstrap: createAcceptanceTopicBootstrap({ context })
  });
  t.after(async () => {
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();
  const api = request(runtime.app);
  const session = await api.post('/api/rag/v1/auth/browser-session')
    .set('Host', HOST)
    .set('Origin', ORIGIN)
    .expect(204);
  return {
    api,
    context,
    env,
    runtime,
    cookie: session.headers['set-cookie'][0].split(';')[0]
  };
}

async function waitForJob(api, apiKey, jobId) {
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
  assert.fail(`job timed out: ${jobId}`);
}

async function search(api, apiKey, topicId, question) {
  return api.post('/api/rag/v1/search')
    .set('X-API-Key', apiKey)
    .send({ topicId, question })
    .expect(200);
}

async function createActiveTopic(api, apiKey) {
  const created = await api.post('/api/rag/v1/topics')
    .set('X-API-Key', apiKey)
    .set('Idempotency-Key', 'security-cross-topic-create')
    .send({ name: '安全测试其他 Topic' })
    .expect(201);
  await api.patch(`/api/rag/v1/topics/${created.body.topicId}`)
    .set('X-API-Key', apiKey)
    .set('Idempotency-Key', 'security-cross-topic-activate')
    .send({ status: 'ACTIVE' })
    .expect(200);
  return created.body;
}

test('acceptance access guards reject missing session/origin and wrong origin without residue', async (t) => {
  const { api, context, cookie, env, runtime } = await setup(t);
  const fixture = FORMAT_FIXTURES.find((item) => item.extension === 'txt');

  const noCookie = await browser(api, 'get', '/api/acceptance/context', null).expect(401);
  assert.equal(noCookie.body.errorCode, 'RAG_UNAUTHORIZED');
  const missingOrigin = await browser(api, 'post', '/api/acceptance/documents', cookie, null)
    .attach('file', fixture.bytes, { filename: 'missing-origin.txt', contentType: fixture.mime })
    .expect(403);
  assert.equal(missingOrigin.body.errorCode, 'RAG_ORIGIN_FORBIDDEN');
  const wrongOrigin = await browser(
    api,
    'post',
    '/api/acceptance/documents',
    cookie,
    'https://attacker.example'
  ).attach('file', fixture.bytes, { filename: 'wrong-origin.txt', contentType: fixture.mime }).expect(403);
  assert.equal(wrongOrigin.body.errorCode, 'RAG_ORIGIN_FORBIDDEN');

  assert.equal(runtime.database.prepare('SELECT COUNT(*) AS count FROM document').get().count, 0);
  assert.equal(runtime.database.prepare('SELECT COUNT(*) AS count FROM job').get().count, 0);
  assert.equal(runtime.database.prepare('SELECT COUNT(*) AS count FROM chunk').get().count, 0);
  const empty = await search(api, env.RAG_API_KEY, context.topicId, fixture.bytes.toString('utf8'));
  assert.deepEqual(empty.body.results, []);

  const openApi = await api.get('/api/rag/v1/openapi.json').expect(200);
  assert.equal(Object.keys(openApi.body.paths).some((route) => route.startsWith('/api/acceptance')), false);
});

test('acceptance rejects a non-loopback peer before exposing context or data', async (t) => {
  const { api, context, cookie, env, runtime } = await setup(t, { remoteAddress: '192.0.2.10' });
  const forbidden = await browser(api, 'get', '/api/acceptance/context', cookie).expect(403);
  assert.equal(forbidden.body.errorCode, 'RAG_ORIGIN_FORBIDDEN');
  assert.equal(runtime.database.prepare('SELECT COUNT(*) AS count FROM chunk').get().count, 0);
  const empty = await search(api, env.RAG_API_KEY, context.topicId, '远程请求不应获得资料');
  assert.deepEqual(empty.body.results, []);
});

test('oversized and damaged acceptance uploads create no document, job or searchable chunk', async (t) => {
  const { api, context, cookie, env, runtime } = await setup(t, {
    envOverrides: { MAX_FILE_MB: '1' }
  });

  const oversized = await browser(api, 'post', '/api/acceptance/documents', cookie)
    .attach('file', Buffer.alloc(1024 * 1024 + 1, 0x61), {
      filename: 'oversized.txt',
      contentType: 'text/plain'
    })
    .expect(413);
  assert.equal(oversized.body.errorCode, 'RAG_FILE_TOO_LARGE');
  const damaged = await browser(api, 'post', '/api/acceptance/documents', cookie)
    .attach('file', Buffer.from('not a pdf', 'utf8'), {
      filename: 'damaged.pdf',
      contentType: 'application/pdf'
    })
    .expect(422);
  assert.equal(damaged.body.errorCode, 'RAG_FILE_INVALID');

  assert.equal(runtime.database.prepare('SELECT COUNT(*) AS count FROM document').get().count, 0);
  assert.equal(runtime.database.prepare('SELECT COUNT(*) AS count FROM job').get().count, 0);
  assert.equal(runtime.database.prepare('SELECT COUNT(*) AS count FROM chunk').get().count, 0);
  const empty = await search(api, env.RAG_API_KEY, context.topicId, '损坏或超限资料');
  assert.deepEqual(empty.body.results, []);
});

test('duplicate SHA, pre-publication retrieval and cross-Topic access stay fail-closed', async (t) => {
  const { api, context, cookie, env, runtime } = await setup(t);
  const fixture = FORMAT_FIXTURES.find((item) => item.extension === 'txt');
  const question = fixture.bytes.toString('utf8');
  const accepted = await browser(api, 'post', '/api/acceptance/documents', cookie)
    .attach('file', fixture.bytes, { filename: 'security-main.txt', contentType: fixture.mime })
    .expect(202);
  await waitForJob(api, env.RAG_API_KEY, accepted.body.jobId);

  const beforePublish = await search(api, env.RAG_API_KEY, context.topicId, question);
  assert.deepEqual(beforePublish.body.results, []);
  const duplicate = await browser(api, 'post', '/api/acceptance/documents', cookie)
    .attach('file', fixture.bytes, { filename: 'security-duplicate.txt', contentType: fixture.mime })
    .expect(409);
  assert.equal(duplicate.body.errorCode, 'RAG_DUPLICATE_DOCUMENT');
  assert.equal(runtime.database.prepare('SELECT COUNT(*) AS count FROM document').get().count, 1);
  assert.equal(runtime.database.prepare('SELECT COUNT(*) AS count FROM job').get().count, 1);
  assert.equal(runtime.database.prepare('SELECT COUNT(*) AS count FROM chunk').get().count, 1);

  await browser(api, 'post', `/api/acceptance/documents/${accepted.body.documentId}/publish`, cookie).expect(200);
  const published = await search(api, env.RAG_API_KEY, context.topicId, question);
  assert.deepEqual(published.body.results.map((result) => result.documentId), [accepted.body.documentId]);

  const otherTopic = await createActiveTopic(api, env.RAG_API_KEY);
  const otherUpload = await api.post('/api/rag/v1/documents')
    .set('X-API-Key', env.RAG_API_KEY)
    .set('Idempotency-Key', 'security-cross-topic-upload')
    .field('topicId', otherTopic.topicId)
    .attach('file', Buffer.from('另一 Topic 的安全隔离资料', 'utf8'), {
      filename: 'other-topic.txt',
      contentType: 'text/plain'
    })
    .expect(202);
  await waitForJob(api, env.RAG_API_KEY, otherUpload.body.jobId);
  for (const [method, pathName] of [
    ['get', `/api/acceptance/documents/${otherUpload.body.documentId}`],
    ['get', `/api/acceptance/jobs/${otherUpload.body.jobId}`],
    ['post', `/api/acceptance/documents/${otherUpload.body.documentId}/publish`]
  ]) {
    const hidden = await browser(api, method, pathName, cookie).expect(404);
    assert.equal(hidden.body.errorCode, 'RAG_DOCUMENT_NOT_FOUND');
  }
  const otherTopicSearch = await search(api, env.RAG_API_KEY, otherTopic.topicId, '安全隔离资料');
  assert.deepEqual(otherTopicSearch.body.results, []);
  const stillScoped = await search(api, env.RAG_API_KEY, context.topicId, question);
  assert.deepEqual(stillScoped.body.results.map((result) => result.documentId), [accepted.body.documentId]);
});
