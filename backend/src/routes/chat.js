import express from 'express';

import { answerServiceFrom } from './rag-v1/chat.js';
import { validateCompatibilityChatRequest } from './rag-v1/chat.schema.js';

function asyncHandler(action) {
  return (request, response, next) => Promise.resolve(action(request, response)).catch(next);
}

export function createCompatibilityChatRouter({ auth, config }) {
  const router = express.Router();
  router.post('/', auth.requireQueryAccess, asyncHandler(async (request, response) => {
    const input = validateCompatibilityChatRequest(request.body, config.frontendDefaultTopicId);
    const result = await answerServiceFrom(request).answer(input);
    response.status(200).json({ ...result, traceId: request.traceId });
  }));
  return router;
}
