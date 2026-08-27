import express from 'express';

import { answerServiceFrom } from './rag-v1/chat.js';
import { validateCompatibilityChatRequest } from './rag-v1/chat.schema.js';
import { AppError } from '../domain/errors.js';
import { selectedFaqFromHistory } from '../domain/chat-workflow.js';
import { clientIpFromRequest } from '../utils/client-ip.js';

function asyncHandler(action) {
  return (request, response, next) => Promise.resolve(action(request, response)).catch(next);
}

export function createCompatibilityChatRouter({ auth, config }) {
  const router = express.Router();
  router.post('/', auth.requireFrontendQueryAccess, asyncHandler(async (request, response) => {
    const { requestedSessionId, selectedFaqId, ...input } = validateCompatibilityChatRequest(
      request.body,
      config.frontendDefaultTopicId
    );
    const conversationService = request.app.locals.chatConversationService;
    if (!conversationService) {
      throw new AppError({
        statusCode: 503,
        errorCode: 'RAG_NOT_READY',
        message: '会话历史服务尚未就绪'
      });
    }
    const turn = conversationService.begin({
      userIp: clientIpFromRequest(request, config),
      requestedSessionId,
      ...input
    });
    const faqService = request.app.locals.faqService;
    const answerProvider = faqService?.hasEntries() ? faqService : answerServiceFrom(request);
    const resolvedFaqId = selectedFaqId ?? selectedFaqFromHistory(input.question, turn.recentHistory);
    const answer = await answerProvider.answer({
      ...input,
      contextualQuestion: turn.contextualQuestion,
      intent: turn.intent,
      ...(resolvedFaqId ? { selectedFaqId: resolvedFaqId } : {})
    });
    const result = conversationService.complete(turn, answer);
    response.status(200).json({ ...result, traceId: request.traceId });
  }));
  return router;
}
