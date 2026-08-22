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
  if (!response.ok) {
    throw new RagApiError(body?.message || '验收操作失败', {
      status: response.status,
      errorCode: body?.errorCode || 'RAG_API_ERROR',
      traceId: body?.traceId
    });
  }
  return body;
}

export function loadAcceptanceContext() {
  return requestAcceptance('/context');
}

export function uploadAcceptanceFile(file) {
  const form = new FormData();
  form.append('file', file, file.name);
  return requestAcceptance('/documents', { method: 'POST', body: form });
}

export function getAcceptanceJob(jobId) {
  return requestAcceptance(`/jobs/${encodeURIComponent(jobId)}`);
}

export function getAcceptanceDocument(documentId) {
  return requestAcceptance(`/documents/${encodeURIComponent(documentId)}`);
}

export function publishAcceptanceDocument(documentId) {
  return requestAcceptance(`/documents/${encodeURIComponent(documentId)}/publish`, { method: 'POST' });
}
