import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DeepSeekIntentClient } from '../../backend/src/adapters/models/deepseek-intent-client.js';

function client(fetchImpl) {
  return new DeepSeekIntentClient({
    baseUrl: 'https://api.deepseek.example',
    apiKey: 'private-key',
    model: 'deepseek-v4-flash',
    connectTimeoutMs: 100,
    totalTimeoutMs: 1000,
    fetchImpl
  });
}

test('DeepSeek intent client sends JSON mode and validates the classification', async () => {
  let request;
  const allowedFaqId = `faq_${'a'.repeat(32)}`;
  const result = await client(async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        related: true,
        domains: ['PMP', 'INVALID', 'PMP'],
        standaloneQuestion: 'PMP考试费用是多少？',
        matchedFaqIds: [allowedFaqId, `faq_${'b'.repeat(32)}`, allowedFaqId, 'invalid']
      }) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }).recognize({
    question: '费用呢',
    contextualQuestion: '用户之前咨询 PMP',
    candidates: [
      { id: allowedFaqId, domain: 'PMP', question: 'PMP考试的费用是多少？' },
      { id: 'invalid', domain: 'PMP', question: '无效目录项' }
    ]
  });

  assert.equal(request.url, 'https://api.deepseek.example/chat/completions');
  assert.equal(request.body.model, 'deepseek-v4-flash');
  assert.deepEqual(request.body.response_format, { type: 'json_object' });
  assert.deepEqual(result.domains, ['PMP']);
  assert.equal(result.standaloneQuestion, 'PMP考试费用是多少？');
  assert.deepEqual(result.matchedFaqIds, [allowedFaqId]);
  assert.match(request.body.messages[1].content, new RegExp(allowedFaqId));
  assert.doesNotMatch(request.body.messages[1].content, /无效目录项/);
  assert.doesNotMatch(JSON.stringify(request.body), /private-key/);
});

test('DeepSeek intent client maps authentication and malformed output safely', async () => {
  await assert.rejects(
    client(async () => new Response('{}', { status: 401 })).recognize({ question: 'x', contextualQuestion: 'x' }),
    (error) => error.errorCode === 'RAG_MODEL_UNAVAILABLE' && !error.message.includes('private-key')
  );
  await assert.rejects(
    client(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 }))
      .recognize({ question: 'x', contextualQuestion: 'x' }),
    (error) => error.errorCode === 'RAG_MODEL_OUTPUT_INVALID'
  );
});

test('DeepSeek intent client discards FAQ selections for unrelated intent', async () => {
  const allowedFaqId = `faq_${'c'.repeat(32)}`;
  const result = await client(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      related: false,
      domains: [],
      standaloneQuestion: '今天天气怎么样？',
      matchedFaqIds: [allowedFaqId]
    }) } }]
  }), { status: 200 })).recognize({
    question: '今天天气怎么样？',
    contextualQuestion: '今天天气怎么样？',
    candidates: [{ id: allowedFaqId, domain: 'PMP', question: 'PMP是什么？' }]
  });

  assert.equal(result.related, false);
  assert.deepEqual(result.matchedFaqIds, []);
});
