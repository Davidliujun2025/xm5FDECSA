import Ajv from 'ajv';

import { AppError } from '../../domain/errors.js';

const ajv = new Ajv({ allErrors: true });
const versionedSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['topicId', 'question'],
  properties: {
    topicId: { type: 'string', pattern: '^topic_[0-9a-f]{32}$' },
    question: { type: 'string', minLength: 1, maxLength: 4000 }
  }
};
const compatibilitySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: {
    message: { type: 'string', minLength: 1, maxLength: 4000 },
    conversationId: { type: 'string', minLength: 1, maxLength: 128 }
  }
};
const validateVersioned = ajv.compile(versionedSchema);
const validateCompatibility = ajv.compile(compatibilitySchema);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function invalidRequest(validate, message) {
  return new AppError({
    statusCode: 400,
    errorCode: 'RAG_INVALID_REQUEST',
    message,
    details: {
      fields: [...new Set(validate.errors.map((error) => (
        error.instancePath.slice(1) || error.params.missingProperty || error.params.additionalProperty || 'body'
      )))]
    }
  });
}

function normalizeQuestion(value) {
  const question = value.trim();
  if (!question || CONTROL_CHARACTER_PATTERN.test(question)) {
    throw new AppError({
      statusCode: 400,
      errorCode: 'RAG_INVALID_REQUEST',
      message: '问题内容非法',
      details: { field: 'question' }
    });
  }
  return question;
}

export function validateVersionedChatRequest(body) {
  if (!validateVersioned(body)) {
    throw invalidRequest(validateVersioned, 'Chat 请求格式非法');
  }
  return { topicId: body.topicId, question: normalizeQuestion(body.question) };
}

export function validateCompatibilityChatRequest(body, defaultTopicId) {
  if (!validateCompatibility(body)) {
    throw invalidRequest(validateCompatibility, 'Chat 兼容请求格式非法');
  }
  if (!defaultTopicId) {
    throw new AppError({
      statusCode: 503,
      errorCode: 'RAG_DEFAULT_TOPIC_UNAVAILABLE',
      message: '前端默认 Topic 尚未配置'
    });
  }
  return {
    topicId: defaultTopicId,
    question: normalizeQuestion(body.message),
    requestedSessionId: body.conversationId
  };
}
