import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Ajv from 'ajv';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { API_KEY, foundationEnv } from '../helpers/foundation.js';

test('OpenAPI documents all three production Topic operations and validates responses', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-topic-contract-'));
  const runtime = await createRuntime({ appRoot: APP_ROOT, env: foundationEnv({ DATA_DIR: dataDir }) });
  t.after(() => {
    runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();

  const http = request(runtime.app);
  const openApiResponse = await http.get('/api/rag/v1/openapi.json').expect(200);
  const openApi = openApiResponse.body;
  assert.equal(openApi.paths['/api/rag/v1/topics'].get.operationId, 'listTopics');
  assert.equal(openApi.paths['/api/rag/v1/topics'].post.operationId, 'createTopic');
  assert.equal(openApi.paths['/api/rag/v1/topics/{topicId}'].patch.operationId, 'updateTopic');
  assert.deepEqual(openApi.paths['/api/rag/v1/topics'].post.security, [{ BackendApiKey: [] }]);
  assert.deepEqual(openApi.paths['/api/rag/v1/topics'].get.security, [{ BackendApiKey: [] }, { BrowserSession: [] }]);

  const created = await http.post('/api/rag/v1/topics')
    .set('X-API-Key', API_KEY)
    .set('Idempotency-Key', 'contract-topic-1')
    .send({ name: 'Contract Topic' })
    .expect(201);
  const validateTopic = new Ajv({ allErrors: true }).compile(openApi.components.schemas.Topic);
  assert.equal(validateTopic(created.body), true, JSON.stringify(validateTopic.errors));

  const list = await http.get('/api/rag/v1/topics').set('X-API-Key', API_KEY).expect(200);
  assert.equal(Array.isArray(list.body), true);
  assert.equal(list.body.every((topic) => validateTopic(topic)), true);
});
