import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { loadConfig } from '../../backend/src/config.js';
import { createOpenApiDocument } from '../../backend/src/routes/rag-v1/openapi.js';
import { foundationEnv } from '../helpers/foundation.js';

function readDoc(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

const apiDoc = readDoc('../../docs/API.md');
const handoffDoc = readDoc('../../docs/HANDOFF.md');
const openApi = createOpenApiDocument(loadConfig(foundationEnv()));

test('API.md endpoint table matches the generated OpenAPI paths and methods', () => {
  const rows = [...apiDoc.matchAll(/^\| (GET|POST|PATCH) \| `([^`]+)` \|/gm)];
  assert.ok(rows.length >= 15, `API.md 端点表行数异常: ${rows.length}`);
  for (const match of rows) {
    const method = match[1].toLowerCase();
    const pathKey = match[2];
    assert.ok(openApi.paths[pathKey], `OpenAPI 缺少路径 ${pathKey}`);
    assert.ok(openApi.paths[pathKey][method], `OpenAPI 路径 ${pathKey} 缺少 ${match[1]} 方法`);
  }
});

test('acceptance adapter stays out of the public OpenAPI and is documented as non-contract', () => {
  for (const key of Object.keys(openApi.paths)) {
    assert.ok(
      !key.startsWith('/api/acceptance') && !key.startsWith('/acceptance'),
      `验收接口误入公开 OpenAPI: ${key}`
    );
  }
  assert.ok(apiDoc.includes('验收专用接口（非公开契约）'));
  assert.ok(apiDoc.includes('/api/acceptance'));
  assert.ok(apiDoc.includes('404'));
  assert.ok(handoffDoc.includes('浏览器验收适配层'));
  assert.ok(handoffDoc.includes('/acceptance/upload'));
  assert.ok(handoffDoc.includes('120 秒'));
  assert.ok(handoffDoc.includes('无自动发布'));
  assert.ok(handoffDoc.includes('rag_query_session'));
});

test('documented answer and document statuses match the OpenAPI enums', () => {
  const chatStatuses = openApi.components.schemas.ChatResponse.properties.status.enum;
  for (const status of ['ANSWERED', 'NO_RELIABLE_EVIDENCE', 'BLOCKED']) {
    assert.ok(chatStatuses.includes(status), `ChatResponse 状态缺失 ${status}`);
    assert.ok(apiDoc.includes(status), `API.md 缺少状态 ${status}`);
    assert.ok(handoffDoc.includes(status), `HANDOFF.md 缺少状态 ${status}`);
  }
  const documentStatuses = openApi.components.schemas.Document.properties.status.enum;
  for (const status of ['UPLOADED', 'PROCESSING', 'READY', 'PUBLISHED', 'FAILED']) {
    assert.ok(documentStatuses.includes(status), `Document 状态缺失 ${status}`);
    assert.ok(apiDoc.includes(status), `API.md 缺少状态 ${status}`);
  }
  const topicStatuses = openApi.components.schemas.Topic.properties.status.enum;
  for (const status of ['DRAFT', 'ACTIVE']) {
    assert.ok(topicStatuses.includes(status), `Topic 状态缺失 ${status}`);
    assert.ok(handoffDoc.includes(status), `HANDOFF.md 缺少状态 ${status}`);
  }
});

test('HANDOFF standard backend flow uses the canonical /api/rag/v1 paths only', () => {
  for (const pathToken of ['/topics', '/documents', '/jobs/', '/publish', '/search', '/chat', '/file']) {
    assert.ok(handoffDoc.includes(pathToken), `HANDOFF.md 缺少路径片段 ${pathToken}`);
  }
  assert.ok(handoffDoc.includes('/api/rag/v1/docs'));
  assert.ok(handoffDoc.includes('X-API-Key'));
  assert.ok(handoffDoc.includes('Idempotency-Key'));
});
