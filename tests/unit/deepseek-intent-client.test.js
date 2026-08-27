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
  const result = await client(async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        related: true,
        domains: ['PMP', 'INVALID', 'PMP'],
        standaloneQuestion: 'PMP考试费用是多少？'
      }) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }).recognize({ question: '费用呢', contextualQuestion: '用户之前咨询 PMP' });

  assert.equal(request.url, 'https://api.deepseek.example/chat/completions');
  assert.equal(request.body.model, 'deepseek-v4-flash');
  assert.deepEqual(request.body.response_format, { type: 'json_object' });
  assert.deepEqual(result.domains, ['PMP']);
  assert.equal(result.standaloneQuestion, 'PMP考试费用是多少？');
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
