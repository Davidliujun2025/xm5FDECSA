import path from 'node:path';
import net from 'node:net';
import Ajv from 'ajv';

import { AppError } from './domain/errors.js';

const ajv = new Ajv({ allErrors: true, coerceTypes: true });
const baseSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['RAG_API_KEY', 'FRONTEND_SESSION_SECRET'],
  properties: {
    NODE_ENV: { enum: ['development', 'test', 'production'] },
    RUN_PROFILE: { enum: ['local', 'team'] },
    RAG_HOST: { type: 'string', minLength: 1 },
    RAG_PORT: { type: 'integer', minimum: 1, maximum: 65535 },
    RAG_API_KEY: { type: 'string', minLength: 32 },
    FRONTEND_SESSION_SECRET: { type: 'string', minLength: 32 },
    FRONTEND_SESSION_TTL_SECONDS: { type: 'integer', minimum: 60, maximum: 14400 },
    FRONTEND_DEFAULT_TOPIC_ID: { type: 'string', pattern: '^(?:|topic_[0-9a-f]{32})$' },
    FRONTEND_DIST_DIR: { type: 'string', minLength: 1 },
    CORS_ORIGINS: { type: 'string', minLength: 1 },
    DATA_DIR: { type: 'string', minLength: 1 },
    MAX_FILE_MB: { type: 'integer', minimum: 1, maximum: 30 },
    MAX_TOTAL_FILES: { type: 'integer', minimum: 1, maximum: 500 },
    MAX_TOTAL_STORAGE_GB: { type: 'number', exclusiveMinimum: 0, maximum: 5 },
    MAX_TOTAL_CHUNKS: { type: 'integer', minimum: 1, maximum: 50000 },
    MODEL_BASE_URL: { type: 'string' },
    MODEL_API_KEY: { type: 'string' },
    EMBEDDING_MODEL: { type: 'string' },
    CHAT_MODEL: { type: 'string' },
    FIXED_REFUSAL_TEXT: { type: 'string', minLength: 1, maxLength: 500 },
    MODEL_CONNECT_TIMEOUT_SECONDS: { type: 'integer', minimum: 1, maximum: 60 },
    MODEL_TOTAL_TIMEOUT_SECONDS: { type: 'integer', minimum: 1, maximum: 300 },
    CHUNK_TARGET_CHARS: { type: 'integer', minimum: 800, maximum: 1200 },
    CHUNK_OVERLAP_CHARS: { type: 'integer', minimum: 0, maximum: 300 },
    RETRIEVAL_CANDIDATES: { type: 'integer', minimum: 1, maximum: 10 },
    ANSWER_CONTEXT_LIMIT: { type: 'integer', minimum: 1, maximum: 5 },
    EVIDENCE_THRESHOLD: { type: 'number', minimum: 0, maximum: 1 },
    MAX_CONCURRENT_REQUESTS: { type: 'integer', minimum: 1, maximum: 3 }
  }
};
const validateBase = ajv.compile(baseSchema);
const PLACEHOLDER_PATTERN = /^(change[-_ ]?me|password|secret|example|test|1234)/i;

function failConfig(message, details = {}) {
  throw new AppError({
    statusCode: 500,
    errorCode: 'RAG_CONFIG_INVALID',
    message,
    details
  });
}

function validateSecret(name, value) {
  if (Buffer.byteLength(value, 'utf8') < 32 || new Set(value).size < 8 || PLACEHOLDER_PATTERN.test(value)) {
    failConfig(`${name} 必须是至少 32 字节的高强度随机值`, { field: name });
  }
}

function parseOrigins(raw) {
  const origins = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (origins.length === 0 || origins.includes('*')) {
    failConfig('CORS_ORIGINS 必须是明确的 Origin 列表', { field: 'CORS_ORIGINS' });
  }

  return origins.map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      failConfig('CORS_ORIGINS 包含非法 Origin', { field: 'CORS_ORIGINS' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      failConfig('CORS_ORIGINS 只能包含 http/https Origin', { field: 'CORS_ORIGINS' });
    }
    return parsed.origin;
  });
}

export function ipv4ToNumber(address) {
  if (net.isIP(address) !== 4) {
    return null;
  }
  return address.split('.').reduce((value, octet) => ((value * 256) + Number(octet)) >>> 0, 0);
}

const PRIVATE_IPV4_RANGES = [
  [0x0a000000, 0x0affffff],
  [0xac100000, 0xac1fffff],
  [0xc0a80000, 0xc0a8ffff],
  [0x7f000000, 0x7fffffff]
];

function isPrivateIpv4Range(start, end = start) {
  return PRIVATE_IPV4_RANGES.some(([allowedStart, allowedEnd]) => start >= allowedStart && end <= allowedEnd);
}

export function parseIpv4Cidr(value) {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/.exec(value);
  if (!match || net.isIP(match[1]) !== 4) {
    return null;
  }
  const prefix = Number(match[2]);
  const address = ipv4ToNumber(match[1]);
  const size = 2 ** (32 - prefix);
  const start = Math.floor(address / size) * size;
  const end = start + size - 1;
  if (address !== start) {
    return null;
  }
  return { value, start, end, prefix };
}

function isPrivateIpv4(address) {
  const numeric = ipv4ToNumber(address);
  return numeric !== null && isPrivateIpv4Range(numeric);
}

function parseTeamCidrs(raw) {
  const values = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) {
    failConfig('team profile 必须配置 TEAM_ALLOWED_CIDRS', { field: 'TEAM_ALLOWED_CIDRS' });
  }

  for (const value of values) {
    const cidr = parseIpv4Cidr(value);
    if (!cidr || !isPrivateIpv4Range(cidr.start, cidr.end)) {
      failConfig('TEAM_ALLOWED_CIDRS 只能包含私有 IPv4 网段', { field: 'TEAM_ALLOWED_CIDRS' });
    }
  }
  return values;
}

function parseModelConfig(values) {
  const baseUrl = values.MODEL_BASE_URL.trim();
  const apiKey = values.MODEL_API_KEY.trim();
  const embeddingModel = values.EMBEDDING_MODEL.trim();
  const chatModel = values.CHAT_MODEL.trim();
  const configuredCount = [baseUrl, apiKey, embeddingModel, chatModel].filter(Boolean).length;
  if (configuredCount !== 0 && configuredCount !== 4) {
    failConfig('真实模型配置必须同时提供地址、API Key、Embedding 模型 ID 和 Chat 模型 ID', {
      fields: ['MODEL_BASE_URL', 'MODEL_API_KEY', 'EMBEDDING_MODEL', 'CHAT_MODEL']
    });
  }
  if (Number(values.MODEL_CONNECT_TIMEOUT_SECONDS) > Number(values.MODEL_TOTAL_TIMEOUT_SECONDS)) {
    failConfig('模型连接超时不得大于总超时', { field: 'MODEL_CONNECT_TIMEOUT_SECONDS' });
  }
  if (baseUrl) {
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      failConfig('MODEL_BASE_URL 格式非法', { field: 'MODEL_BASE_URL' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      failConfig('MODEL_BASE_URL 必须是无凭据、查询参数和片段的 http/https 地址', { field: 'MODEL_BASE_URL' });
    }
  }
  return {
    baseUrl: baseUrl || null,
    apiKey: apiKey || null,
    embeddingModel: embeddingModel || null,
    embeddingConfigured: configuredCount === 4,
    chatModel: chatModel || null,
    chatConfigured: configuredCount === 4,
    connectTimeoutMs: Number(values.MODEL_CONNECT_TIMEOUT_SECONDS) * 1000,
    totalTimeoutMs: Number(values.MODEL_TOTAL_TIMEOUT_SECONDS) * 1000
  };
}

export function loadConfig(env = process.env, { appRoot = process.cwd() } = {}) {
  const values = {
    ...env,
    NODE_ENV: env.NODE_ENV || 'development',
    RUN_PROFILE: env.RUN_PROFILE || 'local',
    RAG_HOST: env.RAG_HOST || '127.0.0.1',
    RAG_PORT: env.RAG_PORT || '3000',
    FRONTEND_SESSION_TTL_SECONDS: env.FRONTEND_SESSION_TTL_SECONDS || '3600',
    FRONTEND_DEFAULT_TOPIC_ID: env.FRONTEND_DEFAULT_TOPIC_ID || '',
    FRONTEND_DIST_DIR: env.FRONTEND_DIST_DIR || './frontend/dist',
    CORS_ORIGINS: env.CORS_ORIGINS || 'http://localhost:5173',
    DATA_DIR: env.DATA_DIR || './data',
    MAX_FILE_MB: env.MAX_FILE_MB || '30',
    MAX_TOTAL_FILES: env.MAX_TOTAL_FILES || '500',
    MAX_TOTAL_STORAGE_GB: env.MAX_TOTAL_STORAGE_GB || '5',
    MAX_TOTAL_CHUNKS: env.MAX_TOTAL_CHUNKS || '50000',
    MODEL_BASE_URL: env.MODEL_BASE_URL || '',
    MODEL_API_KEY: env.MODEL_API_KEY || '',
    EMBEDDING_MODEL: env.EMBEDDING_MODEL || '',
    CHAT_MODEL: env.CHAT_MODEL || '',
    FIXED_REFUSAL_TEXT: env.FIXED_REFUSAL_TEXT || '知识库中未找到可靠依据，暂时无法回答该问题。',
    MODEL_CONNECT_TIMEOUT_SECONDS: env.MODEL_CONNECT_TIMEOUT_SECONDS || '5',
    MODEL_TOTAL_TIMEOUT_SECONDS: env.MODEL_TOTAL_TIMEOUT_SECONDS || '30',
    CHUNK_TARGET_CHARS: env.CHUNK_TARGET_CHARS || '1000',
    CHUNK_OVERLAP_CHARS: env.CHUNK_OVERLAP_CHARS || '150',
    RETRIEVAL_CANDIDATES: env.RETRIEVAL_CANDIDATES || '10',
    ANSWER_CONTEXT_LIMIT: env.ANSWER_CONTEXT_LIMIT || '5',
    EVIDENCE_THRESHOLD: env.EVIDENCE_THRESHOLD || '0.45',
    MAX_CONCURRENT_REQUESTS: env.MAX_CONCURRENT_REQUESTS || '3'
  };

  if (!validateBase(values)) {
    failConfig('必填配置缺失或格式非法', {
      fields: [...new Set(validateBase.errors.map((error) => error.instancePath.slice(1) || error.params.missingProperty))]
    });
  }

  validateSecret('RAG_API_KEY', values.RAG_API_KEY);
  validateSecret('FRONTEND_SESSION_SECRET', values.FRONTEND_SESSION_SECRET);
  const corsOrigins = parseOrigins(values.CORS_ORIGINS);
  const model = parseModelConfig(values);
  if (!values.FIXED_REFUSAL_TEXT.trim()) {
    failConfig('FIXED_REFUSAL_TEXT 不得为空', { field: 'FIXED_REFUSAL_TEXT' });
  }
  let teamAllowedCidrs = [];

  if (values.RUN_PROFILE === 'local' && values.RAG_HOST !== '127.0.0.1') {
    failConfig('local profile 只能监听 127.0.0.1', { field: 'RAG_HOST' });
  }

  if (values.RUN_PROFILE === 'team') {
    if (!env.RAG_HOST?.trim()) {
      failConfig('team profile 必须显式配置 RAG_HOST', { field: 'RAG_HOST' });
    }
    if (!env.CORS_ORIGINS?.trim()) {
      failConfig('team profile 必须显式配置 CORS_ORIGINS', { field: 'CORS_ORIGINS' });
    }
    if (!values.FRONTEND_DEFAULT_TOPIC_ID?.trim()) {
      failConfig('team profile 必须配置 FRONTEND_DEFAULT_TOPIC_ID', { field: 'FRONTEND_DEFAULT_TOPIC_ID' });
    }
    if (values.RAG_HOST !== '0.0.0.0' && (net.isIP(values.RAG_HOST) !== 4 || !isPrivateIpv4(values.RAG_HOST))) {
      failConfig('team profile 只能监听私有 IPv4 地址或 0.0.0.0', { field: 'RAG_HOST' });
    }
    teamAllowedCidrs = parseTeamCidrs(values.TEAM_ALLOWED_CIDRS || '');
  }

  return Object.freeze({
    nodeEnv: values.NODE_ENV,
    appVersion: values.APP_VERSION || '0.1.0',
    profile: values.RUN_PROFILE,
    host: values.RAG_HOST,
    port: Number(values.RAG_PORT),
    apiKey: values.RAG_API_KEY,
    sessionSecret: values.FRONTEND_SESSION_SECRET,
    sessionTtlSeconds: Number(values.FRONTEND_SESSION_TTL_SECONDS),
    frontendDefaultTopicId: values.FRONTEND_DEFAULT_TOPIC_ID?.trim() || null,
    frontendDistDir: path.resolve(appRoot, values.FRONTEND_DIST_DIR || './frontend/dist'),
    fixedRefusalText: values.FIXED_REFUSAL_TEXT.trim(),
    corsOrigins,
    teamAllowedCidrs,
    dataDir: path.resolve(appRoot, values.DATA_DIR),
    migrationsDir: path.resolve(appRoot, 'database/migrations'),
    maxFileBytes: Number(values.MAX_FILE_MB) * 1024 * 1024,
    maxTotalFiles: Number(values.MAX_TOTAL_FILES),
    maxTotalStorageBytes: Number(values.MAX_TOTAL_STORAGE_GB) * 1024 * 1024 * 1024,
    maxTotalChunks: Number(values.MAX_TOTAL_CHUNKS),
    maxConcurrentRequests: Number(values.MAX_CONCURRENT_REQUESTS),
    retrievalCandidates: Number(values.RETRIEVAL_CANDIDATES),
    answerContextLimit: Number(values.ANSWER_CONTEXT_LIMIT),
    evidenceThreshold: Number(values.EVIDENCE_THRESHOLD),
    chunk: Object.freeze({
      minChars: 800,
      targetChars: Number(values.CHUNK_TARGET_CHARS),
      maxChars: 1200,
      overlapChars: Number(values.CHUNK_OVERLAP_CHARS)
    }),
    model: Object.freeze(model)
  });
}
