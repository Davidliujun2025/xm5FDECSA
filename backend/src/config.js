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
    CORS_ORIGINS: { type: 'string', minLength: 1 },
    DATA_DIR: { type: 'string', minLength: 1 },
    MAX_FILE_MB: { type: 'integer', minimum: 1, maximum: 30 },
    MAX_TOTAL_FILES: { type: 'integer', minimum: 1, maximum: 500 },
    MAX_TOTAL_STORAGE_GB: { type: 'number', exclusiveMinimum: 0, maximum: 5 },
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

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || octets[0] === 127;
}

function parseTeamCidrs(raw) {
  const values = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) {
    failConfig('team profile 必须配置 TEAM_ALLOWED_CIDRS', { field: 'TEAM_ALLOWED_CIDRS' });
  }

  for (const value of values) {
    const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/.exec(value);
    if (!match || net.isIP(match[1]) !== 4 || !isPrivateIpv4(match[1])) {
      failConfig('TEAM_ALLOWED_CIDRS 只能包含私有 IPv4 网段', { field: 'TEAM_ALLOWED_CIDRS' });
    }
  }
  return values;
}

export function loadConfig(env = process.env, { appRoot = process.cwd() } = {}) {
  const values = {
    ...env,
    NODE_ENV: env.NODE_ENV || 'development',
    RUN_PROFILE: env.RUN_PROFILE || 'local',
    RAG_HOST: env.RAG_HOST || '127.0.0.1',
    RAG_PORT: env.RAG_PORT || '3000',
    FRONTEND_SESSION_TTL_SECONDS: env.FRONTEND_SESSION_TTL_SECONDS || '3600',
    CORS_ORIGINS: env.CORS_ORIGINS || 'http://localhost:5173',
    DATA_DIR: env.DATA_DIR || './data',
    MAX_FILE_MB: env.MAX_FILE_MB || '30',
    MAX_TOTAL_FILES: env.MAX_TOTAL_FILES || '500',
    MAX_TOTAL_STORAGE_GB: env.MAX_TOTAL_STORAGE_GB || '5',
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
    corsOrigins,
    teamAllowedCidrs,
    dataDir: path.resolve(appRoot, values.DATA_DIR),
    migrationsDir: path.resolve(appRoot, 'database/migrations'),
    maxFileBytes: Number(values.MAX_FILE_MB) * 1024 * 1024,
    maxTotalFiles: Number(values.MAX_TOTAL_FILES),
    maxTotalStorageBytes: Number(values.MAX_TOTAL_STORAGE_GB) * 1024 * 1024 * 1024,
    maxConcurrentRequests: Number(values.MAX_CONCURRENT_REQUESTS),
    model: Object.freeze({
      baseUrl: values.MODEL_BASE_URL?.trim() || null,
      apiKey: values.MODEL_API_KEY?.trim() || null,
      embeddingModel: values.EMBEDDING_MODEL?.trim() || null,
      chatModel: values.CHAT_MODEL?.trim() || null
    })
  });
}
