import { createHash } from 'node:crypto';

import {
  applyTopicPatch,
  createDraftTopic,
  normalizeTopicPatch,
  topicToResponse
} from '../domain/topics.js';
import { AppError } from '../domain/errors.js';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function requireIdempotencyKey(key) {
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new AppError({
      statusCode: 400,
      errorCode: 'RAG_INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key 缺失或格式非法'
    });
  }
  return key;
}

function requestHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class TopicService {
  constructor(repository) {
    this.repository = repository;
  }

  listTopics({ includeInactive = false } = {}) {
    return this.repository.list({ includeInactive }).map(topicToResponse);
  }

  createTopic(input, idempotencyKey, { idGenerator } = {}) {
    const key = requireIdempotencyKey(idempotencyKey);
    const draft = createDraftTopic(input, idGenerator ? { idGenerator } : undefined);
    const normalizedRequest = { name: draft.name, description: draft.description };
    const result = this.repository.executeIdempotent({
      key,
      operation: 'topics:create',
      requestHash: requestHash(normalizedRequest),
      responseStatus: 201,
      action: () => topicToResponse(this.repository.create(draft))
    });
    return result;
  }

  updateTopic(topicId, input, idempotencyKey) {
    const key = requireIdempotencyKey(idempotencyKey);
    const patch = normalizeTopicPatch(input);
    return this.repository.executeIdempotent({
      key,
      operation: `topics:update:${topicId}`,
      requestHash: requestHash(patch),
      responseStatus: 200,
      action: () => {
        const current = this.repository.findById(topicId);
        if (!current) {
          throw new AppError({
            statusCode: 404,
            errorCode: 'RAG_TOPIC_NOT_FOUND',
            message: 'Topic 不存在'
          });
        }
        return topicToResponse(this.repository.update(applyTopicPatch(current, patch)));
      }
    });
  }
}
