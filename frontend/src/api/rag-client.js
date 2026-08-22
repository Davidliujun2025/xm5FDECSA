const CHAT_STATUSES = new Set(['ANSWERED', 'NO_RELIABLE_EVIDENCE', 'BLOCKED']);
const TOPIC_ID_PATTERN = /^topic_[0-9a-f]{32}$/;
const DOCUMENT_ID_PATTERN = /^doc_[0-9a-f]{32}$/;

export class RagApiError extends Error {
  constructor(message, { status = 0, errorCode = 'RAG_NETWORK_ERROR', traceId = null } = {}) {
    super(message);
    this.name = 'RagApiError';
    this.status = status;
    this.errorCode = errorCode;
    this.traceId = traceId;
  }
}

let sessionPromise;

async function parseResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function initializeBrowserSession({ force = false } = {}) {
  if (force) {
    sessionPromise = undefined;
  }
  if (!sessionPromise) {
    sessionPromise = fetch('/api/rag/v1/auth/browser-session', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' }
    }).then(async (response) => {
      if (!response.ok) {
        const body = await parseResponse(response);
        throw new RagApiError(body?.message || '无法建立知识库查询会话', {
          status: response.status,
          errorCode: body?.errorCode || 'RAG_SESSION_UNAVAILABLE',
          traceId: body?.traceId
        });
      }
    }).catch((error) => {
      sessionPromise = undefined;
      if (error instanceof RagApiError) {
        throw error;
      }
      throw new RagApiError('无法连接知识库服务');
    });
  }
  return sessionPromise;
}

function isCitation(citation) {
  return Boolean(
    citation
    && typeof citation === 'object'
    && typeof citation.citationId === 'string'
    && citation.citationId.length > 0
    && DOCUMENT_ID_PATTERN.test(citation.documentId)
    && typeof citation.fileName === 'string'
    && citation.fileName.length > 0
    && citation.location
    && typeof citation.location === 'object'
    && !Array.isArray(citation.location)
    && typeof citation.excerpt === 'string'
    && citation.excerpt.length > 0
  );
}

export function validateChatResponse(body, { expectedTopicId = null, status = 200 } = {}) {
  const structurallyValid = Boolean(
    body
    && typeof body === 'object'
    && CHAT_STATUSES.has(body.status)
    && TOPIC_ID_PATTERN.test(body.topicId)
    && typeof body.answer === 'string'
    && body.answer.trim().length > 0
    && Array.isArray(body.citations)
    && body.citations.length <= 5
    && body.citations.every(isCitation)
    && typeof body.traceId === 'string'
    && body.traceId.length > 0
  );
  const citationStateValid = body?.status === 'ANSWERED'
    ? body.citations?.length > 0
    : body?.citations?.length === 0;
  if (!structurallyValid || !citationStateValid) {
    throw new RagApiError('知识库返回了无法识别的响应', {
      status,
      errorCode: 'RAG_INVALID_RESPONSE',
      traceId: body?.traceId
    });
  }
  if (expectedTopicId && body.topicId !== expectedTopicId) {
    throw new RagApiError('问答响应与当前验收 Topic 不一致', {
      status,
      errorCode: 'RAG_TOPIC_MISMATCH',
      traceId: body.traceId
    });
  }
  return body;
}

export async function sendChat(message, { expectedTopicId = null } = {}) {
  await initializeBrowserSession();
  let response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message })
    });
  } catch {
    throw new RagApiError('无法连接知识库服务');
  }
  const body = await parseResponse(response);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      sessionPromise = undefined;
    }
    throw new RagApiError(body?.message || '知识库服务暂时不可用', {
      status: response.status,
      errorCode: body?.errorCode || 'RAG_API_ERROR',
      traceId: body?.traceId
    });
  }
  return validateChatResponse(body, { expectedTopicId, status: response.status });
}
