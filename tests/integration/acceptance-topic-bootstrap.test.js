import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import {
  ACCEPTANCE_TOPIC_ID,
  ACCEPTANCE_TOPIC_NAME,
  createAcceptanceTopicBootstrap
} from '../../backend/src/acceptance/topic-bootstrap.js';
import { createAcceptanceModelProvider } from '../../backend/src/adapters/models/acceptance-models.js';
import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { AppError } from '../../backend/src/domain/errors.js';
import { createAcceptanceEnvironment } from '../../scripts/start-acceptance.js';

const ORIGIN = 'http://127.0.0.1:3000';

function runtimeOptions(dataDir, context, runtimeBootstrap = createAcceptanceTopicBootstrap({ context })) {
  return {
    appRoot: APP_ROOT,
    env: createAcceptanceEnvironment({ appRoot: APP_ROOT, baseEnv: {}, dataDir }),
    modelProvider: createAcceptanceModelProvider(),
    runtimeBootstrap
  };
}

test('acceptance Topic is ready atomically, binds default chat and is reused on restart', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-acceptance-topic-'));
  let firstRuntime;
  let secondRuntime;
  t.after(async () => {
    await firstRuntime?.close();
    await secondRuntime?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const firstContext = { topicId: null, topicName: null, topicStatus: null };
  const topicBootstrap = createAcceptanceTopicBootstrap({ context: firstContext });
  let releaseBootstrap;
  const bootstrapGate = new Promise((resolve) => {
    releaseBootstrap = resolve;
  });
  firstRuntime = await createRuntime(runtimeOptions(dataDir, firstContext, async (input) => {
    await bootstrapGate;
    return topicBootstrap(input);
  }));
  const firstApi = request(firstRuntime.app);
  const initialization = firstRuntime.initialize();
  const loading = await firstApi.get('/health/ready').expect(503);
  assert.equal(loading.body.details.status, 'INITIALIZING');
  releaseBootstrap();
  await initialization;
  await firstApi.get('/health/ready').expect(200);

  const firstRow = firstRuntime.database.prepare('SELECT * FROM topic WHERE id = ?').get(ACCEPTANCE_TOPIC_ID);
  assert.equal(firstRuntime.database.prepare('SELECT COUNT(*) AS count FROM topic').get().count, 1);
  assert.equal(firstRow.name, ACCEPTANCE_TOPIC_NAME);
  assert.equal(firstRow.status, 'ACTIVE');
  assert.equal(firstRuntime.config.frontendDefaultTopicId, ACCEPTANCE_TOPIC_ID);
  assert.deepEqual(firstContext, {
    topicId: ACCEPTANCE_TOPIC_ID,
    topicName: ACCEPTANCE_TOPIC_NAME,
    topicStatus: 'ACTIVE'
  });

  const session = await firstApi.post('/api/rag/v1/auth/browser-session')
    .set('Host', '127.0.0.1:3000')
    .set('Origin', ORIGIN)
    .expect(204);
  const cookie = session.headers['set-cookie'][0].split(';')[0];
  const defaultChat = await firstApi.post('/api/chat')
    .set('Host', '127.0.0.1:3000')
    .set('Origin', ORIGIN)
    .set('Cookie', cookie)
    .send({ message: '当前空验收 Topic 中没有依据的问题' })
    .expect(200);
  assert.equal(defaultChat.body.topicId, ACCEPTANCE_TOPIC_ID);
  assert.equal(defaultChat.body.status, 'NO_RELIABLE_EVIDENCE');
  await firstApi.get('/api/acceptance/context').expect(404);

  const firstCreatedAt = firstRow.created_at;
  const firstIdempotencyCount = firstRuntime.database
    .prepare('SELECT COUNT(*) AS count FROM idempotency_record')
    .get().count;
  await firstRuntime.close();
  firstRuntime = null;

  const secondContext = { topicId: null, topicName: null, topicStatus: null };
  secondRuntime = await createRuntime(runtimeOptions(dataDir, secondContext));
  await secondRuntime.initialize();
  const secondRow = secondRuntime.database.prepare('SELECT * FROM topic WHERE id = ?').get(ACCEPTANCE_TOPIC_ID);
  assert.equal(secondRuntime.database.prepare('SELECT COUNT(*) AS count FROM topic').get().count, 1);
  assert.equal(secondRow.created_at, firstCreatedAt);
  assert.equal(secondRow.status, 'ACTIVE');
  assert.equal(
    secondRuntime.database.prepare('SELECT COUNT(*) AS count FROM idempotency_record').get().count,
    firstIdempotencyCount
  );
  assert.equal(secondContext.topicId, ACCEPTANCE_TOPIC_ID);
});

test('acceptance Topic bootstrap failure keeps readiness closed and exposes a stable error', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-acceptance-topic-error-'));
  const context = {};
  const runtime = await createRuntime(runtimeOptions(dataDir, context, async () => {
    throw new AppError({
      statusCode: 500,
      errorCode: 'RAG_ACCEPTANCE_TOPIC_BOOTSTRAP_FAILED',
      message: '验收 Topic 创建或复用失败'
    });
  }));
  t.after(async () => {
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  await assert.rejects(
    runtime.initialize(),
    (error) => error.errorCode === 'RAG_ACCEPTANCE_TOPIC_BOOTSTRAP_FAILED'
  );
  assert.equal(runtime.readiness.isReady(), false);
  const response = await request(runtime.app).get('/health/ready').expect(503);
  assert.equal(response.body.errorCode, 'RAG_NOT_READY');
});
