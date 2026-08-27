import {
  buildContextualQuestion,
  inferChatBranch,
  latestCompletedTurn,
  recognizeChatIntent
} from '../domain/chat-workflow.js';

export class ChatConversationService {
  constructor(repository, config, { clock = () => new Date() } = {}) {
    this.repository = repository;
    this.config = config;
    this.clock = clock;
  }

  begin({ userIp, topicId, requestedSessionId, question }) {
    const current = this.clock();
    const now = current.toISOString();
    const cutoff = new Date(current.getTime() - this.config.chatSessionTimeoutMs).toISOString();
    const stored = this.repository.beginTurn({
      userIp,
      topicId,
      requestedSessionId,
      question,
      now,
      cutoff,
      historyMessageLimit: this.config.chatHistoryMessageLimit
    });
    const recentHistory = latestCompletedTurn(stored.history);
    return {
      ...stored,
      recentHistory,
      hasRecentHistory: recentHistory.length > 0,
      intent: recognizeChatIntent(question, recentHistory),
      contextualQuestion: buildContextualQuestion(question, recentHistory)
    };
  }

  complete(turn, result) {
    const branch = inferChatBranch(result);
    const intent = result.intent ?? turn.intent;
    const needTransferHuman = result.needTransferHuman === true;
    const normalized = {
      ...result,
      conversationId: turn.sessionId,
      intent,
      branch,
      needTransferHuman,
      contextUsed: turn.hasRecentHistory
    };
    this.repository.completeTurn({
      sessionId: turn.sessionId,
      answer: normalized.answer,
      intent,
      branch,
      metadata: {
        status: normalized.status,
        needTransferHuman,
        citations: (normalized.citations ?? []).map((citation) => ({
          citationId: citation.citationId,
          documentId: citation.documentId
        })),
        candidates: normalized.candidates ?? [],
        responseType: normalized.responseType ?? null,
        intentProvider: normalized.intentProvider ?? 'LOCAL',
        matchedFaqId: normalized.matchedFaqId ?? null,
        matchedQuestion: normalized.matchedQuestion ?? null
      },
      now: this.clock().toISOString()
    });
    return normalized;
  }
}
