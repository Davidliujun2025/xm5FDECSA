import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { loadConfig } from '../config.js';
import { AppError } from '../domain/errors.js';
import { ACCEPTANCE_TOPIC_ID } from './topic-bootstrap.js';

export const MOCK_ACCEPTANCE_DATA_SEGMENT = path.join('data', 'acceptance');
export const REAL_ACCEPTANCE_DATA_SEGMENT = path.join('data', 'real-acceptance');
export const REAL_ACCEPTANCE_EVIDENCE_FILE = 'acceptance-evidence.json';
export const REAL_ACCEPTANCE_MODEL_KIND = 'TEST_REAL_ACCEPTANCE_MANUAL';
export const MOCK_EMBEDDING_MODEL_PREFIX = 'test-acceptance-';
export const DEFAULT_PORT = 3000;

function acceptanceError(errorCode, message, details = {}) {
  return new AppError({
    statusCode: 500,
    errorCode,
    message,
    details
  });
}

function sameFilePath(left, right) {
  if (process.platform === 'win32') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

export function realAcceptancePort(baseEnv) {
  const raw = baseEnv.RAG_PORT || String(DEFAULT_PORT);
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
    throw acceptanceError('RAG_REAL_ACCEPTANCE_CONFIG_INVALID', 'RAG_PORT 必须是 1 到 65535 的整数');
  }
  return Number(raw);
}

export function resolveRealAcceptanceDataDir({ appRoot, dataDir }) {
  const resolved = path.resolve(dataDir || path.join(appRoot, REAL_ACCEPTANCE_DATA_SEGMENT));
  const mockPath = path.resolve(appRoot, MOCK_ACCEPTANCE_DATA_SEGMENT);
  if (sameFilePath(resolved, mockPath)) {
    throw acceptanceError(
      'RAG_REAL_ACCEPTANCE_DATA_DIR_CONFLICT',
      '真实模型验收必须使用独立 DATA_DIR，不得复用 Mock 验收目录 data/acceptance',
      { dataDir: resolved }
    );
  }
  return resolved;
}

export function createRealAcceptanceEnvironment({ appRoot, baseEnv = process.env, dataDir } = {}) {
  const resolvedDataDir = resolveRealAcceptanceDataDir({ appRoot, dataDir });
  const port = realAcceptancePort(baseEnv);
  const env = {
    ...baseEnv,
    NODE_ENV: 'production',
    RUN_PROFILE: 'local',
    RAG_HOST: '127.0.0.1',
    RAG_PORT: String(port),
    FRONTEND_DIST_DIR: baseEnv.FRONTEND_DIST_DIR || './frontend/dist',
    CORS_ORIGINS: `http://127.0.0.1:${port}`,
    DATA_DIR: resolvedDataDir
  };
  const config = loadConfig(env, { appRoot });
  if (!config.model.embeddingConfigured || !config.model.chatConfigured) {
    throw acceptanceError(
      'RAG_REAL_ACCEPTANCE_MODEL_MISSING',
      '真实模型验收必须完整配置 MODEL_BASE_URL、MODEL_API_KEY、EMBEDDING_MODEL 与 CHAT_MODEL；local/team 不会回退到 Mock'
    );
  }
  return { env, config };
}

export function assertRealAcceptanceDataDir({ appRoot, dataDir }) {
  const resolved = resolveRealAcceptanceDataDir({ appRoot, dataDir });
  const databasePath = path.join(resolved, 'knowledge.db');
  if (!existsSync(databasePath)) {
    return;
  }
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const topicTable = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'topic'")
      .get();
    if (!topicTable) {
      return;
    }
    const mockTopic = database.prepare('SELECT id FROM topic WHERE id = ?').get(ACCEPTANCE_TOPIC_ID);
    const mockChunkCount = database
      .prepare('SELECT COUNT(*) AS count FROM chunk WHERE embedding_model LIKE ?')
      .get(`${MOCK_EMBEDDING_MODEL_PREFIX}%`);
    if (mockTopic || Number(mockChunkCount?.count) > 0) {
      throw acceptanceError(
        'RAG_REAL_ACCEPTANCE_MOCK_DATA_CONFLICT',
        '目标数据目录已包含 Mock 验收 Topic 或 Mock 向量，真实模型验收不得复用，请改用新的独立目录',
        { dataDir: resolved }
      );
    }
  } finally {
    database?.close();
  }
}

export const EVIDENCE_ALLOWED_FIELDS = new Set([
  'evidenceVersion',
  'appVersion',
  'profile',
  'modelKind',
  'embeddingModel',
  'chatModel',
  'modelBaseUrlHost',
  'dataDir',
  'startedAt',
  'updatedAt',
  'status',
  'topic',
  'documents',
  'questionResults',
  'conclusion',
  'finishedAt'
]);

const FORBIDDEN_FIELD_PATTERN = /key|secret|token|password|credential/i;

export function assertEvidenceRecord(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw acceptanceError('RAG_EVIDENCE_INVALID', '验收证据必须是普通对象');
  }
  const unknownField = Object.keys(evidence).find((key) => !EVIDENCE_ALLOWED_FIELDS.has(key));
  if (unknownField) {
    throw acceptanceError('RAG_EVIDENCE_INVALID', '验收证据包含未定义字段', { field: unknownField });
  }
  const stack = [[evidence, '']];
  while (stack.length > 0) {
    const [node, prefix] = stack.pop();
    for (const key of Object.keys(node)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      if (FORBIDDEN_FIELD_PATTERN.test(key)) {
        throw acceptanceError('RAG_EVIDENCE_INVALID', '验收证据不得包含密钥或凭据字段', { field: fieldPath });
      }
      const value = node[key];
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === 'object') {
              stack.push([item, fieldPath]);
            }
          }
        } else {
          stack.push([value, fieldPath]);
        }
      }
    }
  }
}

export function buildAcceptanceEvidence({
  config,
  status,
  topic = null,
  documents = [],
  conclusion = null,
  startedAt = new Date().toISOString(),
  finishedAt = null
}) {
  const evidence = {
    evidenceVersion: 1,
    appVersion: config.appVersion,
    profile: 'local',
    modelKind: REAL_ACCEPTANCE_MODEL_KIND,
    embeddingModel: config.model.embeddingModel,
    chatModel: config.model.chatModel,
    modelBaseUrlHost: config.model.baseUrl ? new URL(config.model.baseUrl).hostname : null,
    dataDir: config.dataDir,
    startedAt,
    status,
    topic: topic
      ? {
        topicId: topic.topicId,
        topicName: topic.topicName,
        topicStatus: topic.topicStatus
      }
      : null,
    documents: documents.map((document) => ({
      documentId: document.documentId,
      status: document.status,
      publishedAt: document.publishedAt ?? null
    })),
    conclusion,
    finishedAt
  };
  assertEvidenceRecord(evidence);
  return Object.freeze(evidence);
}

export async function recordAcceptanceEvidence({ filePath, evidence }) {
  assertEvidenceRecord(evidence);
  const serialized = `${JSON.stringify({ ...evidence, updatedAt: new Date().toISOString() }, null, 2)}\n`;
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, serialized, 'utf8');
  await rename(temporaryPath, filePath);
  return filePath;
}
