const VALID_INTENTS = new Set(['BLOCKED', 'SMALL_TALK', 'FOLLOW_UP', 'KNOWLEDGE_QUERY']);

export class ChatResponseError extends Error {
  constructor(message = '服务返回的数据格式异常，请稍后重试。') {
    super(message);
    this.name = 'ChatResponseError';
  }
}

function parseCandidates(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ChatResponseError();

  return value.map((candidate) => {
    if (!candidate
      || typeof candidate.faqId !== 'string'
      || typeof candidate.domain !== 'string'
      || typeof candidate.question !== 'string'
      || !candidate.question.trim()) {
      throw new ChatResponseError();
    }
    return {
      faqId: candidate.faqId,
      domain: candidate.domain,
      question: candidate.question
    };
  });
}

export function parseChatResponse(value) {
  if (!value || typeof value.answer !== 'string' || !value.answer.trim()) {
    throw new ChatResponseError();
  }
  if (typeof value.needTransferHuman !== 'boolean' || !VALID_INTENTS.has(value.intent)) {
    throw new ChatResponseError();
  }

  return {
    answer: value.answer,
    candidates: parseCandidates(value.candidates),
    needTransferHuman: value.needTransferHuman,
    intent: value.intent,
    responseType: typeof value.responseType === 'string' ? value.responseType : 'ANSWER',
    conversationId: typeof value.conversationId === 'string' ? value.conversationId : ''
  };
}

export async function errorMessageFromResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 400) {
    return payload?.message || '发送内容不符合要求，请检查后重试。';
  }
  if (response.status === 429) {
    return '当前咨询人数较多，请稍后重试。';
  }
  if (response.status >= 500) {
    return '服务暂时不可用，请稍后重试。';
  }
  return payload?.message || '消息发送失败，请稍后重试。';
}
