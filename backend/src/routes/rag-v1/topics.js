import express from 'express';

import { AppError } from '../../domain/errors.js';
import { validateCreateTopic, validateTopicId, validateUpdateTopic } from './topic.schema.js';

function handle(action) {
  return (request, response, next) => {
    try {
      action(request, response);
    } catch (error) {
      next(error);
    }
  };
}

function getService(request) {
  const service = request.app.locals.topicService;
  if (!service) {
    throw new AppError({
      statusCode: 503,
      errorCode: 'RAG_NOT_READY',
      message: '服务正在初始化',
      details: { status: 'INITIALIZING' }
    });
  }
  return service;
}

export function createTopicRouter({ auth }) {
  const router = express.Router();

  router.get('/', auth.requireApiKey, handle((request, response) => {
    response.status(200).json(getService(request).listTopics({ includeInactive: true }));
  }));

  router.post('/', auth.requireApiKey, handle((request, response) => {
    const result = getService(request).createTopic(
      validateCreateTopic(request.body),
      request.get('Idempotency-Key')
    );
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    response.status(result.statusCode).json(result.value);
  }));

  router.patch('/:topicId', auth.requireApiKey, handle((request, response) => {
    const result = getService(request).updateTopic(
      validateTopicId(request.params.topicId),
      validateUpdateTopic(request.body),
      request.get('Idempotency-Key')
    );
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    response.status(result.statusCode).json(result.value);
  }));

  return router;
}
