import Ajv from 'ajv';

import { AppError } from '../../domain/errors.js';

const ajv = new Ajv({ allErrors: true });
const createSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', maxLength: 1000 }
  }
};
const updateSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', maxLength: 1000 },
    status: { enum: ['DRAFT', 'ACTIVE', 'DISABLED'] }
  }
};
const validateCreate = ajv.compile(createSchema);
const validateUpdate = ajv.compile(updateSchema);
const TOPIC_ID_PATTERN = /^topic_[0-9a-f]{32}$/;

function validationDetails(errors = []) {
  return {
    fields: [...new Set(errors.map((error) => error.instancePath.slice(1) || error.params.missingProperty || 'body'))]
  };
}

export function validateCreateTopic(body) {
  if (!validateCreate(body)) {
    throw new AppError({
      statusCode: 400,
      errorCode: 'RAG_INVALID_REQUEST',
      message: 'Topic 创建请求格式非法',
      details: validationDetails(validateCreate.errors)
    });
  }
  return body;
}

export function validateUpdateTopic(body) {
  if (!validateUpdate(body)) {
    throw new AppError({
      statusCode: 400,
      errorCode: 'RAG_INVALID_REQUEST',
      message: 'Topic 更新请求格式非法',
      details: validationDetails(validateUpdate.errors)
    });
  }
  return body;
}

export function validateTopicId(topicId) {
  if (!TOPIC_ID_PATTERN.test(topicId || '')) {
    throw new AppError({
      statusCode: 400,
      errorCode: 'RAG_INVALID_REQUEST',
      message: 'topicId 格式非法',
      details: { field: 'topicId' }
    });
  }
  return topicId;
}
