import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { initializeBrowserSession, RagApiError, sendChat } from '../../frontend/src/api/rag-client.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('frontend creates an HttpOnly session and treats API response as the only answer source', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (url.includes('browser-session')) {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({
      status: 'ANSWERED',
      topicId: `topic_${'a'.repeat(32)}`,
      answer: 'API fact[1]',
      citations: [{ citationId: 'chunk_1', documentId: `doc_${'b'.repeat(32)}`, fileName: 'fact.txt', location: { line: 1 }, excerpt: 'API fact' }],
      traceId: 'trace_frontend'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await initializeBrowserSession({ force: true });
  const result = await sendChat('question');
  assert.equal(result.answer, 'API fact[1]');
  assert.deepEqual(calls.map((call) => call.url), ['/api/rag/v1/auth/browser-session', '/api/chat']);
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[1].options.credentials, 'include');
  assert.deepEqual(calls[1].body, { message: 'question' });
});

test('frontend exposes explicit errors and source has loading, refusal, block and citation states without demo fallback', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call === 1) {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ errorCode: 'RAG_BUSY', message: 'busy', details: {}, traceId: 'trace_busy' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  await initializeBrowserSession({ force: true });
  await assert.rejects(sendChat('question'), (error) => error instanceof RagApiError && error.status === 429 && error.errorCode === 'RAG_BUSY');

  const chatBot = readFileSync(path.join(ROOT, 'frontend/src/components/ChatBot.jsx'), 'utf8');
  const messageList = readFileSync(path.join(ROOT, 'frontend/src/components/MessageList.jsx'), 'utf8');
  const vite = readFileSync(path.join(ROOT, 'frontend/vite.config.js'), 'utf8');
  assert.equal(chatBot.includes('getDemoReply'), false);
  assert.equal(chatBot.includes('conversationId'), false);
  assert.equal(chatBot.includes('isTyping'), true);
  assert.equal(chatBot.includes("status: 'ERROR'"), true);
  assert.equal(messageList.includes('message.citations'), true);
  assert.equal(messageList.includes('/api/rag/v1/documents/'), true);
  assert.equal(vite.includes('RAG_PROXY_TARGET'), true);
  assert.equal(vite.includes("'http://localhost:3000'"), true);
});
