import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { API_KEY, foundationEnv } from '../helpers/foundation.js';

function temporaryDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rag-topics-'));
}

async function runtimeForTest(t, { initialize = true } = {}) {
  const dataDir = temporaryDataDir();
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: foundationEnv({ DATA_DIR: dataDir })
  });
  t.after(() => {
    runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  if (initialize) {
    await runtime.initialize();
  }
  return { runtime, dataDir };
}

function admin(http) {
  return http.set('X-API-Key', API_KEY);
}

async function createTopic(http, name, key, description = '') {
  return admin(http.post('/api/rag/v1/topics'))
    .set('Idempotency-Key', key)
    .send({ name, description });
}

async function updateTopic(http, topicId, patch, key) {
  return admin(http.patch(`/api/rag/v1/topics/${topicId}`))
    .set('Idempotency-Key', key)
    .send(patch);
}

test('production Topic route exposes loading, empty and complete lifecycle states', async (t) => {
  const { runtime } = await runtimeForTest(t, { initialize: false });
  const http = request(runtime.app);

  const loading = await admin(http.get('/api/rag/v1/topics')).expect(503);
  assert.equal(loading.body.errorCode, 'RAG_NOT_READY');
  await runtime.initialize();

  const empty = await admin(http.get('/api/rag/v1/topics')).expect(200);
  assert.deepEqual(empty.body, []);

  const created = await createTopic(http, '项目管理', 'topic-create-001', '初始说明');
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'DRAFT');
  assert.match(created.body.topicId, /^topic_[0-9a-f]{32}$/);

  const edited = await updateTopic(http, created.body.topicId, { name: 'PMP 项目管理', description: '课程资料' }, 'topic-edit-0001');
  assert.equal(edited.status, 200);
  assert.equal(edited.body.name, 'PMP 项目管理');

  const session = await http.post('/api/rag/v1/auth/browser-session')
    .set('Origin', 'http://localhost:5173')
    .expect(204);
  const cookie = session.headers['set-cookie'][0].split(';')[0];
  await http.get('/api/rag/v1/topics')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', cookie)
    .expect(401);
  await http.post('/api/rag/v1/topics')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', cookie)
    .set('Idempotency-Key', 'browser-write-01')
    .send({ name: 'Browser cannot create' })
    .expect(401);

  const activated = await updateTopic(http, created.body.topicId, { status: 'ACTIVE' }, 'topic-active-01');
  assert.equal(activated.status, 200);
  assert.equal(activated.body.status, 'ACTIVE');

  const allActive = await admin(http.get('/api/rag/v1/topics')).expect(200);
  assert.equal(allActive.body.length, 1);

  await http.get('/api/rag/v1/topics')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', cookie)
    .expect(401);

  const disabled = await updateTopic(http, created.body.topicId, { status: 'DISABLED' }, 'topic-disable-1');
  assert.equal(disabled.body.status, 'DISABLED');
  await http.get('/api/rag/v1/topics')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', cookie)
    .expect(401);

  const reactivated = await updateTopic(http, created.body.topicId, { status: 'ACTIVE' }, 'topic-reactive1');
  assert.equal(reactivated.body.status, 'ACTIVE');
  await http.delete(`/api/rag/v1/topics/${created.body.topicId}`).set('X-API-Key', API_KEY).expect(404);
});

test('Topic writes enforce API Key, idempotency, names, IDs and state transitions', async (t) => {
  const { runtime } = await runtimeForTest(t);
  const http = request(runtime.app);

  await http.post('/api/rag/v1/topics')
    .set('Idempotency-Key', 'topic-no-auth')
    .send({ name: 'No auth' })
    .expect(401);
  const noIdempotency = await admin(http.post('/api/rag/v1/topics')).send({ name: 'No key' }).expect(400);
  assert.equal(noIdempotency.body.errorCode, 'RAG_INVALID_IDEMPOTENCY_KEY');

  const first = await createTopic(http, '唯一主题', 'topic-idem-0001');
  assert.equal(first.status, 201);
  assert.equal(first.headers['idempotency-replayed'], 'false');
  const replay = await createTopic(http, '唯一主题', 'topic-idem-0001');
  assert.equal(replay.status, 201);
  assert.equal(replay.headers['idempotency-replayed'], 'true');
  assert.equal(replay.body.topicId, first.body.topicId);

  const conflict = await createTopic(http, '不同主题', 'topic-idem-0001');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.errorCode, 'RAG_IDEMPOTENCY_CONFLICT');
  const duplicate = await createTopic(http, '  唯一主题  ', 'topic-duplicate');
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.errorCode, 'RAG_TOPIC_NAME_CONFLICT');

  const invalidTransition = await updateTopic(http, first.body.topicId, { status: 'DISABLED' }, 'topic-invalid-1');
  assert.equal(invalidTransition.status, 409);
  assert.equal(invalidTransition.body.errorCode, 'RAG_TOPIC_STATE_INVALID');
  const malformedId = await updateTopic(http, 'bad-id', { status: 'ACTIVE' }, 'topic-bad-id-01');
  assert.equal(malformedId.status, 400);
  const missing = await updateTopic(http, 'topic_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { status: 'ACTIVE' }, 'topic-notfound1');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.errorCode, 'RAG_TOPIC_NOT_FOUND');
});

test('Topic capacity is limited to 20 immutable IDs', async (t) => {
  const { runtime } = await runtimeForTest(t);
  const http = request(runtime.app);
  const ids = new Set();
  for (let index = 0; index < 20; index += 1) {
    const response = await createTopic(http, `Topic ${index + 1}`, `capacity-key-${String(index).padStart(3, '0')}`);
    assert.equal(response.status, 201);
    ids.add(response.body.topicId);
  }
  assert.equal(ids.size, 20);
  const overflow = await createTopic(http, 'Topic 21', 'capacity-key-020');
  assert.equal(overflow.status, 409);
  assert.equal(overflow.body.errorCode, 'RAG_CAPACITY_LIMIT');
  const listed = await admin(http.get('/api/rag/v1/topics')).expect(200);
  assert.equal(listed.body.length, 20);
});

test('SQLite busy timeout returns a stable error without partial Topic or idempotency writes', async (t) => {
  const { runtime, dataDir } = await runtimeForTest(t);
  assert.equal(existsSync(path.join(dataDir, 'knowledge.db')), true);
  runtime.database.exec('PRAGMA busy_timeout = 50');
  const blocker = new DatabaseSync(path.join(dataDir, 'knowledge.db'));
  blocker.exec('PRAGMA busy_timeout = 50');
  blocker.exec('BEGIN IMMEDIATE');
  try {
    const busy = await createTopic(request(runtime.app), 'Busy Topic', 'topic-busy-key1');
    assert.equal(busy.status, 503);
    assert.equal(busy.body.errorCode, 'RAG_DATABASE_BUSY');
  } finally {
    blocker.exec('ROLLBACK');
    blocker.close();
  }

  const count = runtime.database.prepare('SELECT COUNT(*) AS count FROM topic').get().count;
  const idempotencyCount = runtime.database.prepare('SELECT COUNT(*) AS count FROM idempotency_record').get().count;
  assert.equal(count, 0);
  assert.equal(idempotencyCount, 0);
});
