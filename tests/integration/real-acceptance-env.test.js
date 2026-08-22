import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import {
  assertRealAcceptanceDataDir,
  buildAcceptanceEvidence,
  createRealAcceptanceEnvironment,
  MOCK_ACCEPTANCE_DATA_SEGMENT,
  REAL_ACCEPTANCE_EVIDENCE_FILE,
  recordAcceptanceEvidence
} from '../../backend/src/acceptance/real-acceptance.js';
import { createAcceptanceTopicBootstrap } from '../../backend/src/acceptance/topic-bootstrap.js';
import { createAcceptanceModelProvider } from '../../backend/src/adapters/models/acceptance-models.js';
import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { createAcceptanceEnvironment } from '../../scripts/start-acceptance.js';
import { foundationEnv } from '../helpers/foundation.js';

const COMPLETE_MODEL_CONFIG = Object.freeze({
  MODEL_BASE_URL: 'https://models.example.test/v1',
  MODEL_API_KEY: 'synthetic-model-key',
  EMBEDDING_MODEL: 'synthetic-embedding-v1',
  CHAT_MODEL: 'synthetic-chat-v1'
});

test('complete real-model environment starts isolated, serves production API only, and records redacted evidence', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-real-env-'));
  const networkForbidden = async () => assert.fail('acceptance environment startup must not call the model');
  const { env, config } = createRealAcceptanceEnvironment({
    appRoot: APP_ROOT,
    baseEnv: foundationEnv({ DATA_DIR: dataDir, ...COMPLETE_MODEL_CONFIG }),
    dataDir
  });
  assert.equal(config.model.embeddingConfigured, true);
  assert.equal(config.model.chatConfigured, true);
  assert.equal(config.dataDir, dataDir);
  assertRealAcceptanceDataDir({ appRoot: APP_ROOT, dataDir });

  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: { ...env, NODE_ENV: 'test' },
    initializationDelayMs: 50,
    embeddingFetch: networkForbidden,
    chatFetch: networkForbidden
  });
  t.after(async () => {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const initializing = runtime.initialize();
  await request(runtime.app).get('/health/ready').expect(503);
  await initializing;
  await request(runtime.app).get('/health/ready').expect(200);
  assert.ok(runtime.app.locals.retrievalService);
  assert.ok(runtime.app.locals.answerService);
  await request(runtime.app).get('/api/acceptance/context').expect(404);

  const evidencePath = path.join(dataDir, REAL_ACCEPTANCE_EVIDENCE_FILE);
  await recordAcceptanceEvidence({
    filePath: evidencePath,
    evidence: buildAcceptanceEvidence({ config, status: 'ENVIRONMENT_READY' })
  });
  const serialized = readFileSync(evidencePath, 'utf8');
  const evidence = JSON.parse(serialized);
  assert.equal(evidence.embeddingModel, config.model.embeddingModel);
  assert.equal(evidence.chatModel, config.model.chatModel);
  assert.equal(evidence.dataDir, config.dataDir);
  assert.equal(evidence.modelKind, 'TEST_REAL_ACCEPTANCE_MANUAL');
  assert.ok(!serialized.includes(COMPLETE_MODEL_CONFIG.MODEL_API_KEY));
  assert.ok(!serialized.includes('MODEL_API_KEY'));
  assert.ok(!serialized.includes('RAG_API_KEY'));
});

test('empty model configuration refuses to prepare a real acceptance environment', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-real-env-empty-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  assert.throws(
    () => createRealAcceptanceEnvironment({
      appRoot: APP_ROOT,
      baseEnv: foundationEnv({ DATA_DIR: dataDir }),
      dataDir
    }),
    (error) => error.errorCode === 'RAG_REAL_ACCEPTANCE_MODEL_MISSING'
  );
  assert.equal(existsSync(path.join(dataDir, 'knowledge.db')), false);
});

test('partial model configuration fails with RAG_CONFIG_INVALID before any data is written', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-real-env-partial-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  assert.throws(
    () => createRealAcceptanceEnvironment({
      appRoot: APP_ROOT,
      baseEnv: foundationEnv({ DATA_DIR: dataDir, ...COMPLETE_MODEL_CONFIG, CHAT_MODEL: '' }),
      dataDir
    }),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
  assert.deepEqual(await readdir(dataDir), []);
});

test('refuses the Mock acceptance data directory', () => {
  assert.throws(
    () => createRealAcceptanceEnvironment({
      appRoot: APP_ROOT,
      baseEnv: foundationEnv({ ...COMPLETE_MODEL_CONFIG }),
      dataDir: path.join(APP_ROOT, MOCK_ACCEPTANCE_DATA_SEGMENT)
    }),
    (error) => error.errorCode === 'RAG_REAL_ACCEPTANCE_DATA_DIR_CONFLICT'
  );
});

test('refuses a data directory that already contains Mock acceptance data', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-real-env-mockdb-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const mockEnv = createAcceptanceEnvironment({ appRoot: APP_ROOT, dataDir });
  mockEnv.NODE_ENV = 'test';
  const mockRuntime = await createRuntime({
    appRoot: APP_ROOT,
    env: mockEnv,
    modelProvider: createAcceptanceModelProvider(),
    runtimeBootstrap: createAcceptanceTopicBootstrap({})
  });
  await mockRuntime.initialize();
  await mockRuntime.close();
  assert.throws(
    () => assertRealAcceptanceDataDir({ appRoot: APP_ROOT, dataDir }),
    (error) => error.errorCode === 'RAG_REAL_ACCEPTANCE_MOCK_DATA_CONFLICT'
  );
});

test('evidence recorder rejects unknown fields, credential fields and nested secrets', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-real-evidence-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const evidencePath = path.join(dataDir, 'evidence.json');
  await assert.rejects(
    recordAcceptanceEvidence({ filePath: evidencePath, evidence: { status: 'X', unknownField: 1 } }),
    (error) => error.errorCode === 'RAG_EVIDENCE_INVALID'
  );
  await assert.rejects(
    recordAcceptanceEvidence({ filePath: evidencePath, evidence: { status: 'X', MODEL_API_KEY: 'leak' } }),
    (error) => error.errorCode === 'RAG_EVIDENCE_INVALID'
  );
  await assert.rejects(
    recordAcceptanceEvidence({
      filePath: evidencePath,
      evidence: { status: 'X', topic: { topicId: 't', sessionSecret: 'leak' } }
    }),
    (error) => error.errorCode === 'RAG_EVIDENCE_INVALID'
  );
  assert.equal(existsSync(evidencePath), false);
});
