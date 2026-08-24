import { AppError } from '../domain/errors.js';
import {
  answeredResponse,
  blockedInputReason,
  blockedResponse,
  refusalResponse,
  validateGroundedClaims
} from '../domain/answers.js';
import { createGroundedAnswerPrompt, GROUNDED_ANSWER_SYSTEM_PROMPT } from '../routes/rag-v1/answer.prompt.js';

export class AnswerService {
  constructor({ retrievalService, retrievalRepository, chatClient, config }) {
    this.retrievalService = retrievalService;
    this.retrievalRepository = retrievalRepository;
    this.chatClient = chatClient;
    this.config = config;
    this.activeRequests = 0;
  }

  async answer({ topicId, question }) {
    if (blockedInputReason(question)) {
      return blockedResponse(topicId);
    }
    if (this.activeRequests >= this.config.maxConcurrentRequests) {
      throw new AppError({ statusCode: 429, errorCode: 'RAG_BUSY', message: '问答请求并发已达到上限' });
    }
    this.activeRequests += 1;
    try {
      const search = await this.retrievalService.search({
        topicId,
        question,
        limit: this.config.answerContextLimit
      });
      const candidates = search.results.slice(0, 5);
      if (candidates.length === 0) {
        return refusalResponse(topicId, this.config.fixedRefusalText);
      }

      let payload;
      try {
        payload = await this.chatClient.complete({
          systemPrompt: GROUNDED_ANSWER_SYSTEM_PROMPT,
          userPrompt: createGroundedAnswerPrompt(question, candidates)
        });
      } catch (error) {
        if (error?.errorCode === 'RAG_MODEL_OUTPUT_INVALID') {
          return refusalResponse(topicId, this.config.fixedRefusalText);
        }
        throw error;
      }

      const claims = validateGroundedClaims(payload, candidates.map((candidate) => candidate.citationId));
      if (!claims) {
        return refusalResponse(topicId, this.config.fixedRefusalText);
      }
      const usedIds = [...new Set(claims.flatMap((claim) => claim.citationIds))];
      const currentRows = this.retrievalRepository.revalidate(topicId, this.config.model.embeddingModel, usedIds);
      if (currentRows.length !== usedIds.length || !usedIds.every((id) => currentRows.some((row) => row.id === id))) {
        return refusalResponse(topicId, this.config.fixedRefusalText);
      }
      return answeredResponse(topicId, claims, candidates);
    } finally {
      this.activeRequests -= 1;
    }
  }
}
