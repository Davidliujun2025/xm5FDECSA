import Ajv from 'ajv';

import { AppError } from '../../domain/errors.js';

const ajv = new Ajv({ allErrors: true });
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['topicId', 'question'],
  properties: {
    topicId: { type: 'string', pattern: '^topic_[0-9a-f]{32}$' },
    question: { type: 'string', minLength: 1, maxLength: 4000 },
    limit: { type: 'integer', minimum: 1, maximum: 10 }
  }
};
const validate = ajv.compile(schema);

export function validateSearchRequest(body, defaultLimit) {
  if (!validate(body)) {
    throw new AppError({
      statusCode: 400,
      errorCode: 'RAG_INVALID_REQUEST',
      message: 'Search 请求格式非法',
      details: {
        fields: [...new Set(validate.errors.map((error) => error.instancePath.slice(1) || error.params.missingProperty || 'body'))]
      }
    });
  }
  const question = body.question.trim();
  if (!question || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(question)) {
    throw new AppError({ statusCode: 400, errorCode: 'RAG_INVALID_REQUEST', message: 'question 内容非法', details: { field: 'question' } });
  }
  return { topicId: body.topicId, question, limit: body.limit ?? defaultLimit };
}
