const CHAT_STATUSES = new Set(['ANSWERED', 'NO_RELIABLE_EVIDENCE', 'BLOCKED']);

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

export async function sendChat(message) {
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
  if (!body || !CHAT_STATUSES.has(body.status) || typeof body.answer !== 'string' || !Array.isArray(body.citations)) {
    throw new RagApiError('知识库返回了无法识别的响应', {
      status: response.status,
      errorCode: 'RAG_INVALID_RESPONSE',
      traceId: body?.traceId
    });
  }
  return body;
}
