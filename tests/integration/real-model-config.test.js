import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { foundationEnv } from '../helpers/foundation.js';

const COMPLETE_MODEL_CONFIG = Object.freeze({
  MODEL_BASE_URL: 'https://models.example.test/v1',
  MODEL_API_KEY: 'synthetic-model-key',
  EMBEDDING_MODEL: 'synthetic-embedding-v1',
  CHAT_MODEL: 'synthetic-chat-v1'
});

test('complete real-model configuration passes loading and startup without network access', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-real-model-config-'));
  const networkForbidden = async () => assert.fail('startup validation must not call a model');
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: foundationEnv({ DATA_DIR: dataDir, ...COMPLETE_MODEL_CONFIG }),
    initializationDelayMs: 500,
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
  assert.equal(runtime.config.model.embeddingConfigured, true);
  assert.equal(runtime.config.model.chatConfigured, true);
  assert.ok(runtime.app.locals.retrievalService);
  assert.ok(runtime.app.locals.answerService);
});

test('empty model group starts without AI services or Mock fallback', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-empty-model-config-'));
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: foundationEnv({ DATA_DIR: dataDir })
  });
  t.after(async () => {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  await runtime.initialize();
  assert.equal(runtime.config.model.embeddingConfigured, false);
  assert.equal(runtime.config.model.chatConfigured, false);
  assert.equal(runtime.app.locals.retrievalService, undefined);
  assert.equal(runtime.app.locals.answerService, undefined);
});

test('partial, mixed, invalid URL and invalid timeout model settings fail before startup writes', async () => {
  const cases = Object.keys(COMPLETE_MODEL_CONFIG).map((missingField) => ({
    name: `missing ${missingField}`,
    values: { ...COMPLETE_MODEL_CONFIG, [missingField]: '' }
  }));
  cases.push(
    { name: 'invalid protocol', values: { ...COMPLETE_MODEL_CONFIG, MODEL_BASE_URL: 'ftp://models.example.test/v1' } },
    { name: 'URL credentials', values: { ...COMPLETE_MODEL_CONFIG, MODEL_BASE_URL: 'https://user:pass@models.example.test/v1' } },
    {
      name: 'connect timeout exceeds total timeout',
      values: { ...COMPLETE_MODEL_CONFIG, MODEL_CONNECT_TIMEOUT_SECONDS: '10', MODEL_TOTAL_TIMEOUT_SECONDS: '5' }
    }
  );

  for (const scenario of cases) {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-invalid-model-config-'));
    try {
      await assert.rejects(
        createRuntime({ appRoot: APP_ROOT, env: foundationEnv({ DATA_DIR: dataDir, ...scenario.values }) }),
        (error) => error.errorCode === 'RAG_CONFIG_INVALID',
        scenario.name
      );
      assert.deepEqual(await readdir(dataDir), [], scenario.name);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  }
});
