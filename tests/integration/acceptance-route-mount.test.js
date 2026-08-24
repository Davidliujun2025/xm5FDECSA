import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import {
  ACCEPTANCE_TOPIC_ID,
  createAcceptanceTopicBootstrap
} from '../../backend/src/acceptance/topic-bootstrap.js';
import { createAcceptanceModelProvider } from '../../backend/src/adapters/models/acceptance-models.js';
import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import {
  createAcceptanceEnvironment,
  createAcceptanceRouteRegistrar
} from '../../scripts/start-acceptance.js';
import { foundationEnv } from '../helpers/foundation.js';

const ORIGIN = 'http://127.0.0.1:3220';

test('acceptance entry registrar exposes context only after bootstrap with cookie and same origin', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-acceptance-route-'));
  const context = { topicId: null, topicName: null, topicStatus: null };
  const env = createAcceptanceEnvironment({
    appRoot: APP_ROOT,
    baseEnv: { ACCEPTANCE_PORT: '3220' },
    dataDir
  });
  let releaseBootstrap;
  const bootstrapGate = new Promise((resolve) => {
    releaseBootstrap = resolve;
  });
  const topicBootstrap = createAcceptanceTopicBootstrap({ context });
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env,
    modelProvider: createAcceptanceModelProvider(),
    registerRoutes: createAcceptanceRouteRegistrar(context),
    runtimeBootstrap: async (input) => {
      await bootstrapGate;
      return topicBootstrap(input);
    }
  });
  t.after(async () => {
    releaseBootstrap();
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  const api = request(runtime.app);

  const session = await api.post('/api/rag/v1/auth/browser-session')
    .set('Host', '127.0.0.1:3220')
    .set('Origin', ORIGIN)
    .expect(204);
  assert.match(session.headers['set-cookie'][0], /HttpOnly/);
  const cookie = session.headers['set-cookie'][0].split(';')[0];

  const initialization = runtime.initialize();
  const loading = await api.get('/api/acceptance/context')
    .set('Host', '127.0.0.1:3220')
    .set('Origin', ORIGIN)
    .set('Cookie', cookie)
    .expect(503);
  assert.equal(loading.body.errorCode, 'RAG_NOT_READY');
  assert.equal(loading.body.details.status, 'INITIALIZING');
  releaseBootstrap();
  await initialization;

  await api.get('/api/acceptance/context')
    .set('Host', '127.0.0.1:3220')
    .set('Origin', ORIGIN)
    .expect(401);
  const wrongOrigin = await api.get('/api/acceptance/context')
    .set('Host', '127.0.0.1:3220')
    .set('Origin', 'https://attacker.example')
    .set('Cookie', cookie)
    .expect(403);
  assert.equal(wrongOrigin.body.errorCode, 'RAG_ORIGIN_FORBIDDEN');

  const ready = await api.get('/api/acceptance/context')
    .set('Host', '127.0.0.1:3220')
    .set('Origin', ORIGIN)
    .set('Cookie', cookie)
    .expect(200);
  assert.deepEqual(ready.body, {
    mode: 'LOCAL_UPLOAD_ACCEPTANCE',
    topicId: ACCEPTANCE_TOPIC_ID,
    topicName: '本机 Mock 验收 Topic',
    topicStatus: 'ACTIVE',
    supportedFormats: ['PDF', 'DOCX', 'XLSX', 'PPTX', 'MD', 'TXT'],
    maxFileBytes: 30 * 1024 * 1024
  });

  const openApi = await api.get('/api/rag/v1/openapi.json').expect(200);
  assert.equal(Object.keys(openApi.body.paths).some((route) => route.startsWith('/api/acceptance')), false);
});

test('ordinary local, team and production runtimes never expose acceptance routes', async (t) => {
  const roots = [];
  const runtimes = [];
  t.after(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.close()));
    roots.forEach((root) => rmSync(root, { recursive: true, force: true }));
  });

  const cases = [
    foundationEnv({ ACCEPTANCE_MODE: '1' }),
    foundationEnv({ NODE_ENV: 'production', ACCEPTANCE_MODE: '1' }),
    foundationEnv({
      RUN_PROFILE: 'team',
      RAG_HOST: '0.0.0.0',
      CORS_ORIGINS: 'http://192.168.60.10:3000',
      FRONTEND_DEFAULT_TOPIC_ID: `topic_${'e'.repeat(32)}`,
      TEAM_ALLOWED_CIDRS: '192.168.60.0/24',
      ACCEPTANCE_MODE: '1'
    })
  ];

  for (const [index, baseEnv] of cases.entries()) {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), `rag-no-acceptance-route-${index}-`));
    roots.push(dataDir);
    const runtime = await createRuntime({
      appRoot: APP_ROOT,
      env: { ...baseEnv, DATA_DIR: dataDir }
    });
    runtimes.push(runtime);
    await runtime.initialize();
    const api = request(runtime.app);
    await api.get('/api/acceptance/context').expect(404);
    const openApi = await api.get('/api/rag/v1/openapi.json').expect(200);
    assert.equal(Object.keys(openApi.body.paths).some((route) => route.startsWith('/api/acceptance')), false);
  }
});
