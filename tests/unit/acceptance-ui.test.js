import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { initializeBrowserSession } from '../../frontend/src/api/rag-client.js';
import {
  loadAcceptanceContext,
  publishAcceptanceDocument,
  uploadAcceptanceFile
} from '../../frontend/src/api/acceptance-client.js';
import { createAcceptancePublicationGate } from '../../frontend/src/components/acceptance-publication.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('acceptance client uses the HttpOnly browser session and never sends a long-lived API key', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('browser-session')) {
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/context')) {
      return Response.json({ topicId: `topic_${'a'.repeat(32)}`, supportedFormats: ['TXT'], maxFileBytes: 1024 });
    }
    if (url.endsWith('/documents')) {
      return Response.json({ documentId: `doc_${'b'.repeat(32)}`, jobId: `job_${'c'.repeat(32)}`, status: 'UPLOADED' }, { status: 202 });
    }
    return Response.json({ documentId: `doc_${'b'.repeat(32)}`, status: 'PUBLISHED' });
  };

  await initializeBrowserSession({ force: true });
  await loadAcceptanceContext();
  await uploadAcceptanceFile(new File(['验收文本'], '验收.txt', { type: 'text/plain' }));
  const publicationController = new AbortController();
  await publishAcceptanceDocument(`doc_${'b'.repeat(32)}`, { signal: publicationController.signal });

  assert.deepEqual(calls.map((call) => call.url), [
    '/api/rag/v1/auth/browser-session',
    '/api/acceptance/context',
    '/api/acceptance/documents',
    `/api/acceptance/documents/doc_${'b'.repeat(32)}/publish`
  ]);
  assert.equal(calls.every((call) => call.options.credentials === 'include'), true);
  assert.equal(calls.some((call) => Object.keys(call.options.headers ?? {}).some((name) => name.toLowerCase() === 'x-api-key')), false);
  assert.equal(calls[2].options.body instanceof FormData, true);
  assert.equal(calls[3].options.signal, publicationController.signal);
});

test('publication requires an explicit action and coalesces repeated clicks', async () => {
  let calls = 0;
  let completePublication;
  const publicationResponse = new Promise((resolve) => {
    completePublication = resolve;
  });
  const gate = createAcceptancePublicationGate(async () => {
    calls += 1;
    return publicationResponse;
  });

  assert.equal(calls, 0);
  assert.equal(gate.isPublishing(), false);
  const first = gate.publish(`doc_${'d'.repeat(32)}`);
  const duplicate = gate.publish(`doc_${'d'.repeat(32)}`);
  assert.equal(first, duplicate);
  assert.equal(gate.isPublishing(), true);
  await Promise.resolve();
  assert.equal(calls, 1);

  completePublication({ documentId: `doc_${'d'.repeat(32)}`, status: 'PUBLISHED' });
  assert.equal((await first).status, 'PUBLISHED');
  assert.equal(gate.isPublishing(), false);
});

test('publication surfaces API errors, fails closed for invalid responses and unlocks for retry', async () => {
  let attempts = 0;
  const gate = createAcceptancePublicationGate(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(new Error('发布接口暂时不可用'), {
        errorCode: 'RAG_INTERNAL_ERROR',
        traceId: 'trace_publish_api_error'
      });
    }
    if (attempts === 2) {
      return { status: 'READY', traceId: 'trace_not_published' };
    }
    return { status: 'PUBLISHED' };
  });

  await assert.rejects(
    gate.publish(`doc_${'e'.repeat(32)}`),
    (error) => error.errorCode === 'RAG_INTERNAL_ERROR'
      && error.traceId === 'trace_publish_api_error'
  );
  assert.equal(gate.isPublishing(), false);
  await assert.rejects(
    gate.publish(`doc_${'e'.repeat(32)}`),
    (error) => error.errorCode === 'LOCAL_PUBLICATION_RESPONSE_INVALID'
      && error.traceId === 'trace_not_published'
  );
  assert.equal(gate.isPublishing(), false);
  assert.equal((await gate.publish(`doc_${'e'.repeat(32)}`)).status, 'PUBLISHED');
  assert.equal(attempts, 3);
});

test('acceptance page exposes a real five-stage upload flow with explicit manual publication', () => {
  const component = readFileSync(path.join(ROOT, 'frontend/src/components/UploadAcceptance.jsx'), 'utf8');
  const client = readFileSync(path.join(ROOT, 'frontend/src/api/acceptance-client.js'), 'utf8');
  const index = readFileSync(path.join(ROOT, 'frontend/src/index.jsx'), 'utf8');

  assert.equal(index.includes("window.location.pathname === '/acceptance/upload'"), true);
  assert.equal(component.includes('选择文件，或拖放到这里'), true);
  assert.equal(component.includes('onDrop={dropFile}'), true);
  assert.equal(component.includes('onClick={publish}'), true);
  assert.equal(component.includes('发布到测试知识库'), true);
  assert.equal(component.includes('发布后可检索'), true);
  assert.equal(component.includes('phase !== \'ready\' || publicationGate.current.isPublishing()'), true);
  assert.equal(component.includes('<strong>PUBLISHED</strong>'), true);
  assert.equal(component.includes('href="/?acceptance=1"'), true);
  assert.equal(component.includes('进入问答'), true);
  assert.equal(component.includes('核对原文件'), true);
  assert.equal(component.includes("setPhase('ready')"), true);
  assert.equal(component.includes('/api/acceptance/documents/'), true);
  assert.equal(client.includes('X-API-Key'), false);
  assert.equal(client.includes("credentials: 'include'"), true);
});
