import { initializeBrowserSession, RagApiError } from './rag-client.js';

async function parseResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestAcceptance(path, options = {}) {
  await initializeBrowserSession();
  let response;
  try {
    response = await fetch(`/api/acceptance${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.headers ?? {})
      }
    });
  } catch {
    throw new RagApiError('无法连接本机验收服务');
  }
  const body = await parseResponse(response);
  const traceId = body?.traceId || response.headers.get('x-trace-id') || null;
  if (!response.ok) {
    throw new RagApiError(body?.message || '验收操作失败', {
      status: response.status,
      errorCode: body?.errorCode || 'RAG_API_ERROR',
      traceId
    });
  }
  return body && typeof body === 'object' && !Array.isArray(body)
    ? { ...body, traceId }
    : body;
}

export function loadAcceptanceContext() {
  return requestAcceptance('/context');
}

export function uploadAcceptanceFile(file) {
  const form = new FormData();
  form.append('file', file, file.name);
  return requestAcceptance('/documents', { method: 'POST', body: form });
}

export function getAcceptanceJob(jobId, options = {}) {
  return requestAcceptance(`/jobs/${encodeURIComponent(jobId)}`, options);
}

export function getAcceptanceDocument(documentId, options = {}) {
  return requestAcceptance(`/documents/${encodeURIComponent(documentId)}`, options);
}

export function publishAcceptanceDocument(documentId, options = {}) {
  return requestAcceptance(`/documents/${encodeURIComponent(documentId)}/publish`, {
    ...options,
    method: 'POST'
  });
}
