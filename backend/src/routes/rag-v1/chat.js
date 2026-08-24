import express from 'express';

import { AppError } from '../../domain/errors.js';
import { validateVersionedChatRequest } from './chat.schema.js';

function asyncHandler(action) {
  return (request, response, next) => Promise.resolve(action(request, response)).catch(next);
}

export function answerServiceFrom(request) {
  const service = request.app.locals.answerService;
  if (!service) {
    throw new AppError({ statusCode: 503, errorCode: 'RAG_MODEL_UNAVAILABLE', message: '问答模型尚未配置或服务不可用' });
  }
  return service;
}

export function createChatRouter({ auth }) {
  const router = express.Router();
  router.post('/', auth.requireApiKey, asyncHandler(async (request, response) => {
    const input = validateVersionedChatRequest(request.body);
    const result = await answerServiceFrom(request).answer(input);
    response.status(200).json({ ...result, traceId: request.traceId });
  }));
  return router;
}
