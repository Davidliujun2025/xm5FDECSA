import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Ajv from 'ajv';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { API_KEY, foundationEnv } from '../helpers/foundation.js';
import { FORMAT_FIXTURES } from '../helpers/document-fixtures.js';

test('OpenAPI documents seven production Document/Job operations and their responses', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-document-contract-'));
  const runtime = await createRuntime({ appRoot: APP_ROOT, env: foundationEnv({ DATA_DIR: dataDir }) });
  t.after(() => {
    runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();
  const api = request(runtime.app);

  const openApi = (await api.get('/api/rag/v1/openapi.json').expect(200)).body;
  const operations = [
    openApi.paths['/api/rag/v1/documents'].post.operationId,
    openApi.paths['/api/rag/v1/documents'].get.operationId,
    openApi.paths['/api/rag/v1/documents/{documentId}'].get.operationId,
    openApi.paths['/api/rag/v1/documents/{documentId}/publish'].post.operationId,
    openApi.paths['/api/rag/v1/documents/{documentId}/disable'].post.operationId,
    openApi.paths['/api/rag/v1/documents/{documentId}/file'].get.operationId,
    openApi.paths['/api/rag/v1/jobs/{jobId}'].get.operationId
  ];
  assert.deepEqual(operations, ['uploadDocument', 'listDocuments', 'getDocument', 'publishDocument', 'disableDocument', 'getDocumentFile', 'getJob']);
  assert.deepEqual(openApi.paths['/api/rag/v1/documents'].post.security, [{ BackendApiKey: [] }]);
  assert.deepEqual(openApi.paths['/api/rag/v1/documents/{documentId}'].get.security, [{ BackendApiKey: [] }, { BrowserSession: [] }]);

  const topic = await api.post('/api/rag/v1/topics')
    .set('X-API-Key', API_KEY).set('Idempotency-Key', 'doc-contract-topic')
    .send({ name: 'Document Contract' }).expect(201);
  await api.patch(`/api/rag/v1/topics/${topic.body.topicId}`)
    .set('X-API-Key', API_KEY).set('Idempotency-Key', 'doc-contract-active')
    .send({ status: 'ACTIVE' }).expect(200);
  const fixture = FORMAT_FIXTURES.find((item) => item.extension === 'txt');
  const uploaded = await api.post('/api/rag/v1/documents')
    .set('X-API-Key', API_KEY).set('Idempotency-Key', 'doc-contract-upload')
    .field('topicId', topic.body.topicId)
    .attach('file', fixture.bytes, { filename: 'contract.txt', contentType: fixture.mime })
    .expect(202);

  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
  for (const [schemaName, response] of [
    ['UploadDocumentResponse', uploaded.body],
    ['Document', (await api.get(`/api/rag/v1/documents/${uploaded.body.documentId}`).set('X-API-Key', API_KEY).expect(200)).body],
    ['Job', (await api.get(`/api/rag/v1/jobs/${uploaded.body.jobId}`).set('X-API-Key', API_KEY).expect(200)).body]
  ]) {
    const validate = ajv.compile(openApi.components.schemas[schemaName]);
    assert.equal(validate(response), true, `${schemaName}: ${JSON.stringify(validate.errors)}`);
  }
});
