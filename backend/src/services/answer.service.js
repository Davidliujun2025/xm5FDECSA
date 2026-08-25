import { AppError } from '../domain/errors.js';
import {
  answeredResponse,
  blockedInputReason,
  blockedResponse,
  refusalResponse,
  validateGroundedClaims
} from '../domain/answers.js';
import { createGroundedAnswerPrompt, GROUNDED_ANSWER_SYSTEM_PROMPT } from '../routes/rag-v1/answer.prompt.js';
import { CHAT_BRANCH, CHAT_INTENT } from '../domain/chat-workflow.js';

function workflowResponse(response, { intent, branch, needTransferHuman = false }) {
  return Object.freeze({ ...response, intent, branch, needTransferHuman });
}

export class AnswerService {
  constructor({ retrievalService, retrievalRepository, chatClient, config }) {
    this.retrievalService = retrievalService;
    this.retrievalRepository = retrievalRepository;
    this.chatClient = chatClient;
    this.config = config;
    this.activeRequests = 0;
  }

  async answer({ topicId, question, contextualQuestion = question, intent = CHAT_INTENT.KNOWLEDGE_QUERY }) {
    if (blockedInputReason(question)) {
      return workflowResponse(blockedResponse(topicId), {
        intent: CHAT_INTENT.BLOCKED,
        branch: CHAT_BRANCH.INVALID
      });
    }
    if (this.activeRequests >= this.config.maxConcurrentRequests) {
      throw new AppError({ statusCode: 429, errorCode: 'RAG_BUSY', message: '问答请求并发已达到上限' });
    }
    this.activeRequests += 1;
    try {
      const search = await this.retrievalService.search({
        topicId,
        question: contextualQuestion,
        limit: this.config.answerContextLimit,
        includeDiagnostics: true
      });
      const candidates = search.results.slice(0, 5);
      if (candidates.length === 0) {
        const related = search.diagnostics?.related === true;
        return workflowResponse(
          refusalResponse(topicId, related ? this.config.humanTransferText : this.config.fixedRefusalText),
          {
            intent,
            branch: related ? CHAT_BRANCH.RELATED_WITHOUT_RESULT : CHAT_BRANCH.INVALID,
            needTransferHuman: related
          }
        );
      }

      let payload;
      try {
        payload = await this.chatClient.complete({
          systemPrompt: GROUNDED_ANSWER_SYSTEM_PROMPT,
          userPrompt: createGroundedAnswerPrompt(question, candidates)
        });
      } catch (error) {
        if (error?.errorCode === 'RAG_MODEL_OUTPUT_INVALID') {
          return workflowResponse(refusalResponse(topicId, this.config.humanTransferText), {
            intent,
            branch: CHAT_BRANCH.RELATED_WITHOUT_RESULT,
            needTransferHuman: true
          });
        }
        throw error;
      }

      const claims = validateGroundedClaims(payload, candidates.map((candidate) => candidate.citationId));
      if (!claims) {
        return workflowResponse(refusalResponse(topicId, this.config.humanTransferText), {
          intent,
          branch: CHAT_BRANCH.RELATED_WITHOUT_RESULT,
          needTransferHuman: true
        });
      }
      const usedIds = [...new Set(claims.flatMap((claim) => claim.citationIds))];
      const currentRows = this.retrievalRepository.revalidate(topicId, this.config.model.embeddingModel, usedIds);
      if (currentRows.length !== usedIds.length || !usedIds.every((id) => currentRows.some((row) => row.id === id))) {
        return workflowResponse(refusalResponse(topicId, this.config.humanTransferText), {
          intent,
          branch: CHAT_BRANCH.RELATED_WITHOUT_RESULT,
          needTransferHuman: true
        });
      }
      return workflowResponse(answeredResponse(topicId, claims, candidates), {
        intent,
        branch: CHAT_BRANCH.KNOWLEDGE_HIT
      });
    } finally {
      this.activeRequests -= 1;
    }
  }
}
