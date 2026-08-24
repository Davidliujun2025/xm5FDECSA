import { randomUUID } from 'node:crypto';

import { AppError } from './errors.js';

export const TOPIC_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED'
});

const STATUS_VALUES = new Set(Object.values(TOPIC_STATUS));
const ALLOWED_TRANSITIONS = Object.freeze({
  [TOPIC_STATUS.DRAFT]: new Set([TOPIC_STATUS.ACTIVE]),
  [TOPIC_STATUS.ACTIVE]: new Set([TOPIC_STATUS.DISABLED]),
  [TOPIC_STATUS.DISABLED]: new Set([TOPIC_STATUS.ACTIVE])
});

function invalidRequest(message, details = {}) {
  throw new AppError({
    statusCode: 400,
    errorCode: 'RAG_INVALID_REQUEST',
    message,
    details
  });
}

function cleanText(value, field, maximum, { required = false } = {}) {
  if (value === undefined && !required) {
    return undefined;
  }
  if (typeof value !== 'string') {
    invalidRequest(`${field} 必须是字符串`, { field });
  }
  const cleaned = value.normalize('NFKC').trim();
  if ((required && cleaned.length === 0) || cleaned.length > maximum || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    invalidRequest(`${field} 格式非法`, { field });
  }
  return cleaned;
}

export function normalizeTopicName(name) {
  return cleanText(name, 'name', 100, { required: true }).toLocaleLowerCase('zh-CN');
}

export function createDraftTopic(input, { now = () => new Date(), idGenerator = () => `topic_${randomUUID().replaceAll('-', '')}` } = {}) {
  const name = cleanText(input?.name, 'name', 100, { required: true });
  const description = cleanText(input?.description ?? '', 'description', 1000) ?? '';
  const timestamp = now().toISOString();
  return Object.freeze({
    id: idGenerator(),
    name,
    normalizedName: normalizeTopicName(name),
    description,
    status: TOPIC_STATUS.DRAFT,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function normalizeTopicPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalidRequest('Topic 更新内容格式非法');
  }
  const keys = Object.keys(input);
  const allowed = new Set(['name', 'description', 'status']);
  if (keys.length === 0 || keys.some((key) => !allowed.has(key))) {
    invalidRequest('Topic 更新字段非法');
  }

  const patch = {};
  if ('name' in input) {
    patch.name = cleanText(input.name, 'name', 100, { required: true });
    patch.normalizedName = normalizeTopicName(patch.name);
  }
  if ('description' in input) {
    patch.description = cleanText(input.description, 'description', 1000) ?? '';
  }
  if ('status' in input) {
    if (typeof input.status !== 'string' || !STATUS_VALUES.has(input.status)) {
      invalidRequest('status 格式非法', { field: 'status' });
    }
    patch.status = input.status;
  }
  return Object.freeze(patch);
}

export function applyTopicPatch(topic, patch, { now = () => new Date() } = {}) {
  const hasMetadataChanges = patch.name !== undefined || patch.description !== undefined;
  if (topic.status === TOPIC_STATUS.DISABLED && (hasMetadataChanges || patch.status !== TOPIC_STATUS.ACTIVE)) {
    throw new AppError({
      statusCode: 409,
      errorCode: 'RAG_TOPIC_DISABLED',
      message: '已停用 Topic 只能重新启用'
    });
  }
  if (patch.status !== undefined && !ALLOWED_TRANSITIONS[topic.status].has(patch.status)) {
    throw new AppError({
      statusCode: 409,
      errorCode: 'RAG_TOPIC_STATE_INVALID',
      message: 'Topic 状态转换非法',
      details: { currentStatus: topic.status, targetStatus: patch.status }
    });
  }

  return Object.freeze({
    ...topic,
    ...patch,
    updatedAt: now().toISOString()
  });
}

export function topicToResponse(topic) {
  return {
    topicId: topic.id,
    name: topic.name,
    description: topic.description,
    status: topic.status,
    createdAt: topic.createdAt,
    updatedAt: topic.updatedAt
  };
}
