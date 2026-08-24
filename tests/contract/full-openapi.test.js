import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { foundationEnv } from '../helpers/foundation.js';

const EXPECTED_OPERATIONS = Object.freeze([
  'GET /health/live',
  'GET /health/ready',
  'POST /api/rag/v1/auth/browser-session',
  'GET /api/rag/v1/topics',
  'POST /api/rag/v1/topics',
  'PATCH /api/rag/v1/topics/{topicId}',
  'POST /api/rag/v1/documents',
  'GET /api/rag/v1/documents',
  'GET /api/rag/v1/documents/{documentId}',
  'POST /api/rag/v1/documents/{documentId}/publish',
  'POST /api/rag/v1/documents/{documentId}/disable',
  'GET /api/rag/v1/documents/{documentId}/file',
  'GET /api/rag/v1/jobs/{jobId}',
  'POST /api/rag/v1/search',
  'POST /api/rag/v1/chat',
  'POST /api/chat'
]);

const REQUIRED_ERROR_CODES = Object.freeze([
  'RAG_UNAUTHORIZED', 'RAG_INVALID_REQUEST', 'RAG_TOPIC_NOT_FOUND', 'RAG_TOPIC_DISABLED',
  'RAG_DOCUMENT_NOT_FOUND', 'RAG_DOCUMENT_NOT_READY', 'RAG_DUPLICATE_DOCUMENT',
  'RAG_UNSUPPORTED_FORMAT', 'RAG_FILE_TOO_LARGE', 'RAG_NO_TEXT_CONTENT', 'RAG_CAPACITY_LIMIT',
  'RAG_JOB_FAILED', 'RAG_MODEL_UNAVAILABLE', 'RAG_MODEL_OUTPUT_INVALID', 'RAG_BUSY',
  'RAG_BLOCKED_INPUT', 'RAG_INTERNAL_ERROR'
]);

test('OpenAPI 3.1 covers all 16 public operations and stable business errors', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-openapi-full-'));
  const runtime = await createRuntime({ appRoot: APP_ROOT, env: foundationEnv({ DATA_DIR: dataDir }) });
  t.after(async () => {
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  const document = (await request(runtime.app).get('/api/rag/v1/openapi.json').expect(200)).body;
  await request(runtime.app).get('/api/rag/v1/docs')
    .expect(301).expect('Location', '/api/rag/v1/docs/');
  const swagger = await request(runtime.app).get('/api/rag/v1/docs/')
    .expect(200).expect('Content-Type', /html/);
  assert.match(swagger.text, /id="swagger-ui"/);
  assert.match(swagger.text, /swagger-ui-bundle\.js/);
  await request(runtime.app).get('/api/rag/v1/docs/swagger-ui-init.js')
    .expect(200).expect('Content-Type', /javascript/);
  assert.equal(document.openapi, '3.1.0');
  const operations = [];
  for (const [route, pathItem] of Object.entries(document.paths)) {
    for (const method of ['get', 'post', 'patch']) {
      if (pathItem[method]) operations.push(`${method.toUpperCase()} ${route}`);
    }
  }
  assert.deepEqual(operations.sort(), [...EXPECTED_OPERATIONS].sort());
  for (const operation of EXPECTED_OPERATIONS) {
    const [method, route] = operation.split(' ');
    assert.ok(document.paths[route][method.toLowerCase()].operationId, operation);
    assert.ok(document.paths[route][method.toLowerCase()].responses, operation);
  }
  const errorCodes = document.components.schemas.Error.properties.errorCode.enum;
  assert.ok(REQUIRED_ERROR_CODES.every((errorCode) => errorCodes.includes(errorCode)));
  assert.deepEqual(document.paths['/api/chat'].post.security, [{ BackendApiKey: [] }, { BrowserSession: [] }]);
  assert.deepEqual(document.paths['/api/rag/v1/chat'].post.security, [{ BackendApiKey: [] }, { BrowserSession: [] }]);
  assert.ok(document.paths['/api/rag/v1/documents'].post.requestBody.content['multipart/form-data']);
  assert.ok(document.paths['/api/rag/v1/documents/{documentId}/publish'].post.responses[200]);
  assert.ok(document.paths['/api/rag/v1/documents/{documentId}/file'].get.responses[200]);
});
