import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { ACCEPTANCE_MODEL_KIND } from '../../backend/src/adapters/models/acceptance-models.js';
import { ACCEPTANCE_TOPIC_ID } from '../../backend/src/acceptance/topic-bootstrap.js';
import { foundationEnv } from '../helpers/foundation.js';
import {
  createAcceptanceEnvironment,
  safeAcceptanceStartupMessage,
  startAcceptance
} from '../../scripts/start-acceptance.js';

function deterministicBytes(size) {
  return Buffer.alloc(size, 0x5a);
}

test('acceptance environment forces loopback, isolated data and no real model configuration', () => {
  const appRoot = path.resolve('portable-acceptance-root');
  const env = createAcceptanceEnvironment({
    appRoot,
    baseEnv: {
      RUN_PROFILE: 'team',
      RAG_HOST: '0.0.0.0',
      RAG_PORT: '9999',
      ACCEPTANCE_PORT: '3210',
      DATA_DIR: './business-data',
      MODEL_BASE_URL: 'https://models.example.test/v1',
      MODEL_API_KEY: 'real-model-key',
      EMBEDDING_MODEL: 'real-embedding',
      CHAT_MODEL: 'real-chat'
    },
    randomBytesImpl: deterministicBytes
  });
  assert.equal(env.RUN_PROFILE, 'local');
  assert.equal(env.RAG_HOST, '127.0.0.1');
  assert.equal(env.RAG_PORT, '3210');
  assert.equal(env.DATA_DIR, path.join(appRoot, 'data', 'acceptance'));
  assert.equal(env.FRONTEND_DEFAULT_TOPIC_ID, ACCEPTANCE_TOPIC_ID);
  assert.equal(env.MODEL_BASE_URL, '');
  assert.equal(env.MODEL_API_KEY, '');
  assert.equal(env.EMBEDDING_MODEL, '');
  assert.equal(env.CHAT_MODEL, '');
  assert.ok(env.RAG_API_KEY.startsWith('acceptance_api_'));
  assert.ok(env.FRONTEND_SESSION_SECRET.startsWith('acceptance_session_'));
});

test('acceptance entry builds before starting and preserves ordinary start injection boundaries', async () => {
  const events = [];
  const result = await startAcceptance({
    appRoot: path.resolve('acceptance-order-root'),
    baseEnv: { ACCEPTANCE_PORT: '3211' },
    build: async () => events.push('build'),
    start: async (options) => {
      events.push('start');
      assert.equal(options.env.RAG_HOST, '127.0.0.1');
      assert.match(options.env.DATA_DIR, /data[\\/]acceptance$/);
      assert.equal(options.modelProvider.kind, ACCEPTANCE_MODEL_KIND);
      assert.equal(options.env.FRONTEND_DEFAULT_TOPIC_ID, ACCEPTANCE_TOPIC_ID);
      assert.equal(typeof options.runtimeBootstrap, 'function');
      assert.equal(typeof options.registerRoutes, 'function');
      return { runtime: { config: { port: 3211 } } };
    }
  });
  assert.deepEqual(events, ['build', 'start']);
  assert.equal(result.runtime.config.port, 3211);
});

test('ordinary runtime with acceptance-shaped environment still has no implicit model fallback', async (t) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), 'rag-acceptance-entry-'));
  const env = createAcceptanceEnvironment({
    appRoot: APP_ROOT,
    baseEnv: {},
    randomBytesImpl: deterministicBytes,
    dataDir: appRoot
  });
  const runtime = await createRuntime({ appRoot: APP_ROOT, env });
  t.after(async () => {
    await runtime.close();
    await rm(appRoot, { recursive: true, force: true });
  });
  await runtime.initialize();
  assert.equal(runtime.readiness.isReady(), true);
  assert.equal(runtime.config.host, '127.0.0.1');
  assert.equal(runtime.config.model.embeddingConfigured, false);
  assert.equal(runtime.app.locals.retrievalService, undefined);
  assert.equal(runtime.app.locals.answerService, undefined);
  assert.equal(runtime.database.prepare('SELECT COUNT(*) AS count FROM topic').get().count, 0);
});

test('ordinary team runtime without real model configuration has no Mock fallback', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-team-no-mock-'));
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: foundationEnv({
      RUN_PROFILE: 'team',
      RAG_HOST: '0.0.0.0',
      CORS_ORIGINS: 'http://192.168.50.10:3000',
      FRONTEND_DEFAULT_TOPIC_ID: `topic_${'d'.repeat(32)}`,
      TEAM_ALLOWED_CIDRS: '192.168.50.0/24',
      DATA_DIR: dataDir
    })
  });
  t.after(async () => {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();
  assert.equal(runtime.config.profile, 'team');
  assert.equal(runtime.config.model.embeddingConfigured, false);
  assert.equal(runtime.app.locals.retrievalService, undefined);
  assert.equal(runtime.app.locals.answerService, undefined);
  assert.equal(runtime.database.prepare('SELECT COUNT(*) AS count FROM topic').get().count, 0);
});

test('acceptance entry rejects invalid ports and emits actionable safe startup errors', () => {
  assert.throws(
    () => createAcceptanceEnvironment({ baseEnv: { ACCEPTANCE_PORT: '0' } }),
    (error) => error.code === 'RAG_ACCEPTANCE_CONFIG_INVALID'
  );
  assert.match(safeAcceptanceStartupMessage({ code: 'EADDRINUSE' }), /PORT_IN_USE/);
  assert.match(safeAcceptanceStartupMessage({ code: 'ENOENT' }), /STARTUP_FAILED/);
  assert.equal(safeAcceptanceStartupMessage(new Error('secret provider body')).includes('secret provider body'), false);
});

test('package scripts expose versioned acceptance without changing ordinary npm start', async () => {
  const packageJson = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile('package.json', 'utf8')));
  assert.equal(packageJson.scripts.acceptance, 'node scripts/start-acceptance.js');
  assert.equal(packageJson.scripts.start, 'npm run start --workspace backend');
  const source = await import('node:fs/promises').then(({ readFile }) => readFile('scripts/start-acceptance.js', 'utf8'));
  assert.equal(source.includes('.codex-tmp-'), false);
});
