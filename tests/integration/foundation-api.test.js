import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { API_KEY, foundationEnv } from '../helpers/foundation.js';

function createTestDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rag-foundation-'));
}

function testRoutes(app, auth) {
  app.get('/__test/admin', auth.requireApiKey, (req, res) => res.json({ auth: req.auth.type }));
  app.get('/__test/query', auth.requireQueryAccess, (req, res) => res.json({ auth: req.auth.type }));
}

test('main flow, loading state and empty data directory become ready atomically', async (t) => {
  const dataDir = createTestDataDir();
  const runtime = await createRuntime({
    env: foundationEnv({ DATA_DIR: dataDir }),
    appRoot: APP_ROOT,
    initializationDelayMs: 40,
    registerRoutes: testRoutes
  });
  t.after(() => {
    runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const live = await request(runtime.app).get('/health/live').expect(200);
  assert.equal(live.body.status, 'UP');
  assert.match(live.body.traceId, /^trace_/);

  const beforeReady = await request(runtime.app).get('/health/ready').expect(503);
  assert.deepEqual(Object.keys(beforeReady.body).sort(), ['details', 'errorCode', 'message', 'traceId']);
  assert.equal(beforeReady.body.errorCode, 'RAG_NOT_READY');

  const initialization = runtime.initialize();
  await request(runtime.app).get('/health/ready').expect(503);
  await initialization;
  await request(runtime.app).get('/health/ready').expect(200);

  for (const expected of ['knowledge.db', 'original', 'temp', 'logs', 'backups']) {
    assert.equal(existsSync(path.join(dataDir, expected)), true, `${expected} should exist`);
  }
  const migration = runtime.database.prepare('SELECT COUNT(*) AS count FROM schema_version').get();
  assert.equal(migration.count >= 2, true);

  const openApi = await request(runtime.app).get('/api/rag/v1/openapi.json').expect(200);
  assert.equal(openApi.body.openapi, '3.1.0');
  assert.ok(openApi.body.components.schemas.Error);
  assert.ok(openApi.body.paths['/health/live']);
  assert.ok(openApi.body.paths['/api/rag/v1/auth/browser-session']);
});

test('API key, browser session, CORS and stable error responses are enforced', async (t) => {
  const dataDir = createTestDataDir();
  const runtime = await createRuntime({
    env: foundationEnv({ DATA_DIR: dataDir }),
    appRoot: APP_ROOT,
    registerRoutes: testRoutes
  });
  t.after(() => {
    runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();

  const missingKey = await request(runtime.app).get('/__test/admin').expect(401);
  assert.deepEqual(Object.keys(missingKey.body).sort(), ['details', 'errorCode', 'message', 'traceId']);
  assert.equal(missingKey.body.errorCode, 'RAG_UNAUTHORIZED');
  assert.doesNotMatch(JSON.stringify(missingKey.body), /A1b2C3|rag-foundation/i);

  await request(runtime.app).get('/__test/admin').set('X-API-Key', 'wrong').expect(401);
  const admin = await request(runtime.app).get('/__test/admin').set('X-API-Key', API_KEY).expect(200);
  assert.equal(admin.body.auth, 'api-key');

  const session = await request(runtime.app)
    .post('/api/rag/v1/auth/browser-session')
    .set('Origin', 'http://localhost:5173')
    .expect(204);
  const setCookie = session.headers['set-cookie'][0];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Max-Age=3600/);
  const cookie = setCookie.split(';')[0];

  const query = await request(runtime.app)
    .get('/__test/query')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(query.body.auth, 'browser-session');

  await request(runtime.app)
    .get('/__test/query')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', 'rag_query_session=invalid')
    .expect(401);
  const forbidden = await request(runtime.app)
    .post('/api/rag/v1/auth/browser-session')
    .set('Origin', 'https://attacker.example')
    .expect(403);
  assert.equal(forbidden.body.errorCode, 'RAG_ORIGIN_FORBIDDEN');

  const unknown = await request(runtime.app).get('/does-not-exist').expect(404);
  assert.equal(unknown.body.errorCode, 'RAG_ROUTE_NOT_FOUND');
  await request(runtime.app)
    .post('/api/rag/v1/auth/browser-session')
    .set('Origin', 'http://localhost:5173')
    .set('Content-Type', 'application/json')
    .send('{')
    .expect(400);
});

test('a second runtime cannot use the same data directory', async (t) => {
  const dataDir = createTestDataDir();
  const first = await createRuntime({ env: foundationEnv({ DATA_DIR: dataDir }), appRoot: APP_ROOT });
  t.after(() => {
    first.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  await assert.rejects(
    createRuntime({ env: foundationEnv({ DATA_DIR: dataDir }), appRoot: APP_ROOT }),
    (error) => error.errorCode === 'RAG_INSTANCE_ALREADY_RUNNING' && !error.message.includes(dataDir)
  );
});

test('valid team profile initializes without requiring topics or documents', async (t) => {
  const dataDir = createTestDataDir();
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: foundationEnv({
      RUN_PROFILE: 'team',
      RAG_HOST: '0.0.0.0',
      DATA_DIR: dataDir,
      CORS_ORIGINS: 'http://192.168.50.20:5173',
      FRONTEND_DEFAULT_TOPIC_ID: 'topic_default',
      TEAM_ALLOWED_CIDRS: '192.168.50.0/24'
    })
  });
  t.after(() => {
    runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();
  assert.equal(runtime.readiness.isReady(), true);
  assert.equal(runtime.database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'topic'").get().count, 1);
  assert.equal(runtime.database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'document'").get().count, 0);
});
