import { readFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = (process.env.RAG_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const apiKey = process.env.RAG_API_KEY;
if (!apiKey) throw new Error('RAG_API_KEY is required in the backend process environment');

async function api(route, { method = 'GET', body, headers = {}, timeoutMs = 10_000 } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'X-API-Key': apiKey, ...headers },
    body,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const result = response.headers.get('content-type')?.includes('json') ? await response.json() : response;
  if (!response.ok) throw new Error(`${result.errorCode || response.status}: ${result.message || 'request failed'}`);
  return result;
}

export async function createTopic(name) {
  return api('/api/rag/v1/topics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `example-topic-${Date.now()}` },
    body: JSON.stringify({ name })
  });
}

export async function activateTopic(topicId) {
  return api(`/api/rag/v1/topics/${topicId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `example-activate-${Date.now()}` },
    body: JSON.stringify({ status: 'ACTIVE' })
  });
}

export async function uploadAndPublish(topicId, filePath) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.set('topicId', topicId);
  form.set('file', new Blob([bytes]), path.basename(filePath));
  const uploaded = await api('/api/rag/v1/documents', {
    method: 'POST',
    headers: { 'Idempotency-Key': `example-upload-${Date.now()}` },
    body: form,
    timeoutMs: 10_000
  });
  const deadline = Date.now() + 30_000;
  let succeeded = false;
  while (Date.now() < deadline) {
    const job = await api(`/api/rag/v1/jobs/${uploaded.jobId}`, { timeoutMs: 5_000 });
    if (job.status === 'SUCCEEDED') { succeeded = true; break; }
    if (job.status === 'FAILED') throw new Error(`${job.errorCode}: ${job.errorMessage}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!succeeded) throw new Error(`job timeout: ${uploaded.jobId}`);
  return api(`/api/rag/v1/documents/${uploaded.documentId}/publish`, { method: 'POST', timeoutMs: 5_000 });
}

export function search(topicId, question) {
  return api('/api/rag/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topicId, question }),
    timeoutMs: 10_000
  });
}

export function chat(topicId, question) {
  return api('/api/rag/v1/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topicId, question }),
    timeoutMs: 30_000
  });
}
