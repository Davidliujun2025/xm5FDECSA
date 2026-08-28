import { ANSWER_STATUS, blockedInputReason, blockedResponse, refusalResponse } from '../domain/answers.js';
import { CHAT_BRANCH, CHAT_INTENT } from '../domain/chat-workflow.js';
import { detectFaqDomains, rankFaqEntries } from '../domain/faqs.js';

function publicCandidate(entry) {
  return Object.freeze({ faqId: entry.id, domain: entry.domain, question: entry.question });
}

function response(topicId, answer, {
  status = ANSWER_STATUS.ANSWERED,
  intent = CHAT_INTENT.KNOWLEDGE_QUERY,
  branch = CHAT_BRANCH.KNOWLEDGE_HIT,
  needTransferHuman = false,
  responseType,
  candidates = [],
  matchedEntry,
  intentProvider = 'LOCAL'
} = {}) {
  return Object.freeze({
    status,
    topicId,
    answer,
    citations: Object.freeze([]),
    intent,
    branch,
    needTransferHuman,
    responseType,
    intentProvider,
    candidates: Object.freeze(candidates.map((candidate) => Object.freeze({ ...candidate }))),
    ...(matchedEntry ? {
      matchedFaqId: matchedEntry.id,
      matchedQuestion: matchedEntry.question
    } : {})
  });
}

function candidatePrompt(candidates) {
  return `我找到了以下相关问题，请选择您想了解的内容：\n${candidates
    .map((candidate, index) => `${index + 1}、[${candidate.domain}] ${candidate.question}`)
    .join('\n')}`;
}

const FALLBACK_MENU_QUESTIONS = Object.freeze([
  '我们的培训服务如何帮助客户最大化PMP认证的价值？',
  'PMP的完整报考流程是怎样的？',
  'PMP考试的费用是多少？',
  '通过考试拿到证书后，如何维持证书的有效性？'
]);

export class FaqService {
  constructor(repository, config, { intentClient = null } = {}) {
    this.repository = repository;
    this.config = config;
    this.intentClient = intentClient;
    this.entries = Object.freeze(repository.list());
  }

  hasEntries() {
    return this.entries.length > 0;
  }

  async answer({
    topicId,
    question,
    contextualQuestion = question,
    intent = CHAT_INTENT.KNOWLEDGE_QUERY,
    selectedFaqId
  }) {
    if (blockedInputReason(question)) {
      const blocked = blockedResponse(topicId);
      return response(topicId, blocked.answer, {
        status: blocked.status,
        intent: CHAT_INTENT.BLOCKED,
        branch: CHAT_BRANCH.INVALID,
        responseType: 'BLOCKED'
      });
    }

    if (selectedFaqId) {
      const selected = this.repository.findById(selectedFaqId);
      if (selected) {
        return response(topicId, selected.answer, {
          intent,
          responseType: 'ANSWER',
          matchedEntry: selected
        });
      }
    }

    let recognizedIntent = null;
    if (this.intentClient) {
      try {
        const hintedDomains = detectFaqDomains(contextualQuestion || question, this.entries);
        const intentCandidates = hintedDomains.size > 0
          ? this.entries.filter((entry) => hintedDomains.has(entry.domain))
          : this.entries;
        recognizedIntent = await this.intentClient.recognize({
          question,
          contextualQuestion,
          candidates: intentCandidates.map((entry) => ({
            id: entry.id,
            domain: entry.domain,
            question: entry.question
          }))
        });
      } catch {
        recognizedIntent = null;
      }
    }
    const matchingQuestion = recognizedIntent?.standaloneQuestion || question;
    const matchingContext = recognizedIntent
      ? `${recognizedIntent.domains.join(' ')} ${matchingQuestion}`
      : (intent === CHAT_INTENT.FOLLOW_UP ? contextualQuestion : question);
    const intentProvider = recognizedIntent ? 'DEEPSEEK' : 'LOCAL';

    const { ranked, detectedDomains } = rankFaqEntries({
      question: matchingQuestion,
      contextualQuestion: matchingContext,
      entries: this.entries
    });
    const top = ranked[0];
    if (top && top.score >= this.config.faqMatchThreshold) {
      const closeMatches = ranked
        .filter((item) => item.score >= this.config.faqMatchThreshold && item.score >= top.score - 0.08)
        .slice(0, this.config.faqMaxCandidates);
      if (top.score === 1 || closeMatches.length === 1) {
        return response(topicId, top.entry.answer, {
          intent,
          responseType: 'ANSWER',
          matchedEntry: top.entry,
          intentProvider
        });
      }
      const candidates = closeMatches.map((item) => publicCandidate(item.entry));
      return response(topicId, candidatePrompt(candidates), {
        intent,
        responseType: 'CANDIDATES',
        candidates,
        intentProvider
      });
    }

    const semanticMatches = (recognizedIntent?.related === true ? recognizedIntent.matchedFaqIds ?? [] : [])
      .map((faqId) => this.repository.findById(faqId))
      .filter(Boolean)
      .slice(0, this.config.faqMaxCandidates);
    if (semanticMatches.length === 1) {
      return response(topicId, semanticMatches[0].answer, {
        intent,
        responseType: 'ANSWER',
        matchedEntry: semanticMatches[0],
        intentProvider
      });
    }
    if (semanticMatches.length > 1) {
      const candidates = semanticMatches.map(publicCandidate);
      return response(topicId, candidatePrompt(candidates), {
        intent,
        responseType: 'CANDIDATES',
        candidates,
        intentProvider
      });
    }

    const related = recognizedIntent?.related
      ?? (detectedDomains.size > 0 || Boolean(top && top.score >= this.config.faqRelatedThreshold));
    const fallback = refusalResponse(
      topicId,
      related ? this.config.humanTransferText : this.config.fixedRefusalText
    );
    const fallbackCandidates = related
      ? []
      : FALLBACK_MENU_QUESTIONS
        .map((menuQuestion) => this.entries.find((entry) => entry.question === menuQuestion))
        .filter(Boolean)
        .map(publicCandidate);
    return response(topicId, fallback.answer, {
      status: fallback.status,
      intent,
      branch: related ? CHAT_BRANCH.RELATED_WITHOUT_RESULT : CHAT_BRANCH.INVALID,
      needTransferHuman: related,
      responseType: related ? 'TRANSFER' : 'FALLBACK',
      candidates: fallbackCandidates,
      intentProvider
    });
  }
}
