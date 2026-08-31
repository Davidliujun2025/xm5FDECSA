import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ChatResponseError,
  errorMessageFromResponse,
  parseChatResponse
} from '../src/chat-response.js';

test('parses answer, candidates, transfer flag and intent', () => {
  const result = parseChatResponse({
    answer: '请选择问题',
    candidates: [{ faqId: 'faq_1', domain: 'PMP', question: 'PMP是什么？' }],
    needTransferHuman: false,
    intent: 'KNOWLEDGE_QUERY',
    responseType: 'CANDIDATES',
    conversationId: 'session_1'
  });

  assert.equal(result.answer, '请选择问题');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.needTransferHuman, false);
  assert.equal(result.intent, 'KNOWLEDGE_QUERY');
  assert.equal(result.conversationId, 'session_1');
});

test('accepts transfer responses without candidates', () => {
  const result = parseChatResponse({
    answer: '已为您转接人工服务通道。',
    candidates: [],
    needTransferHuman: true,
    intent: 'KNOWLEDGE_QUERY',
    responseType: 'TRANSFER'
  });

  assert.equal(result.needTransferHuman, true);
  assert.deepEqual(result.candidates, []);
});

test('rejects missing or invalid required response fields', () => {
  assert.throws(() => parseChatResponse({ answer: '回答' }), ChatResponseError);
  assert.throws(() => parseChatResponse({
    answer: '回答',
    candidates: 'invalid',
    needTransferHuman: false,
    intent: 'KNOWLEDGE_QUERY'
  }), ChatResponseError);
});

test('maps parameter, busy and server API errors to user-facing messages', async () => {
  const parameterError = new Response(JSON.stringify({ message: '问题内容非法' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' }
  });
  const busyError = new Response('{}', { status: 429 });
  const serverError = new Response('{}', { status: 503 });

  assert.equal(await errorMessageFromResponse(parameterError), '问题内容非法');
  assert.equal(await errorMessageFromResponse(busyError), '当前咨询人数较多，请稍后重试。');
  assert.equal(await errorMessageFromResponse(serverError), '服务暂时不可用，请稍后重试。');
});
