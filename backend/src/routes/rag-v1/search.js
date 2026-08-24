import express from 'express';

import { AppError } from '../../domain/errors.js';
import { validateSearchRequest } from './search.schema.js';

function asyncHandler(action) {
  return (request, response, next) => Promise.resolve(action(request, response)).catch(next);
}

function serviceFrom(request) {
  const service = request.app.locals.retrievalService;
  if (!service) {
    throw new AppError({ statusCode: 503, errorCode: 'RAG_MODEL_UNAVAILABLE', message: '检索模型尚未配置或服务不可用' });
  }
  return service;
}

export function createSearchRouter({ auth, config }) {
  const router = express.Router();
  router.post('/', auth.requireApiKey, asyncHandler(async (request, response) => {
    const input = validateSearchRequest(request.body, config.answerContextLimit);
    response.status(200).json(await serviceFrom(request).search(input));
  }));
  return router;
}
