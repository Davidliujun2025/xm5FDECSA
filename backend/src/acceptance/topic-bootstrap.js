import { createHash } from 'node:crypto';

import { AppError } from '../domain/errors.js';
import { normalizeTopicName, TOPIC_STATUS } from '../domain/topics.js';

export const ACCEPTANCE_TOPIC_ID = 'topic_616363657074616e63655f6d76705f31';
export const ACCEPTANCE_TOPIC_NAME = '本机 Mock 验收 Topic';
export const ACCEPTANCE_TOPIC_DESCRIPTION = '仅用于合成或脱敏资料的本机流程验收，不得上传真实企业资料。';

const CREATE_IDEMPOTENCY_KEY = 'acceptance-bootstrap-topic-create-v1';

function bootstrapError(errorCode, message, cause) {
  return new AppError({
    statusCode: 500,
    errorCode,
    message,
    cause
  });
}

function activationIdempotencyKey(topic) {
  const version = createHash('sha256')
    .update(`${topic.topicId}:${topic.status}:${topic.updatedAt}`)
    .digest('hex')
    .slice(0, 20);
  return `acceptance-bootstrap-activate-${version}`;
}

function validateTopicIdentity(topics) {
  const expectedName = normalizeTopicName(ACCEPTANCE_TOPIC_NAME);
  const byId = topics.find((topic) => topic.topicId === ACCEPTANCE_TOPIC_ID);
  const byName = topics.find((topic) => normalizeTopicName(topic.name) === expectedName);
  if ((byId && normalizeTopicName(byId.name) !== expectedName)
    || (byName && byName.topicId !== ACCEPTANCE_TOPIC_ID)) {
    throw bootstrapError(
      'RAG_ACCEPTANCE_TOPIC_CONFLICT',
      '验收 Topic 标识与现有数据冲突，请使用隔离的 acceptance 数据目录'
    );
  }
  return byId ?? null;
}

function requireBootstrapDependencies(input) {
  const topicService = input?.app?.locals?.topicService;
  if (!topicService
    || typeof topicService.listTopics !== 'function'
    || typeof topicService.createTopic !== 'function'
    || typeof topicService.updateTopic !== 'function') {
    throw bootstrapError('RAG_ACCEPTANCE_TOPIC_BOOTSTRAP_FAILED', '验收 Topic 服务尚未准备完成');
  }
  if (input.config?.frontendDefaultTopicId !== ACCEPTANCE_TOPIC_ID) {
    throw bootstrapError('RAG_ACCEPTANCE_TOPIC_BINDING_INVALID', '验收问答 Topic 绑定无效');
  }
  return topicService;
}

export function createAcceptanceTopicBootstrap({ context = {} } = {}) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new TypeError('acceptance topic context must be an object');
  }

  return async function bootstrapAcceptanceTopic(input) {
    const topicService = requireBootstrapDependencies(input);
    try {
      let topic = validateTopicIdentity(topicService.listTopics({ includeInactive: true }));
      if (!topic) {
        topic = topicService.createTopic({
          name: ACCEPTANCE_TOPIC_NAME,
          description: ACCEPTANCE_TOPIC_DESCRIPTION
        }, CREATE_IDEMPOTENCY_KEY, {
          idGenerator: () => ACCEPTANCE_TOPIC_ID
        }).value;
      }
      if (topic.status !== TOPIC_STATUS.ACTIVE) {
        topic = topicService.updateTopic(
          topic.topicId,
          { status: TOPIC_STATUS.ACTIVE },
          activationIdempotencyKey(topic)
        ).value;
      }
      if (topic.topicId !== ACCEPTANCE_TOPIC_ID || topic.status !== TOPIC_STATUS.ACTIVE) {
        throw bootstrapError('RAG_ACCEPTANCE_TOPIC_BOOTSTRAP_FAILED', '验收 Topic 未能进入 ACTIVE 状态');
      }

      Object.assign(context, {
        topicId: topic.topicId,
        topicName: topic.name,
        topicStatus: topic.status
      });
      input.app.locals.acceptanceContext = context;
      return Object.freeze({ ...context });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw bootstrapError('RAG_ACCEPTANCE_TOPIC_BOOTSTRAP_FAILED', '验收 Topic 创建或复用失败', error);
    }
  };
}
