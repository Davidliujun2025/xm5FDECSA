import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChatClient } from '../../backend/src/adapters/models/chat-client.js';

function client(fetchImpl, overrides = {}) {
  return new ChatClient({
    baseUrl: 'https://models.example.test/v1',
    apiKey: 'model-secret',
    model: 'chat-approved-v1',
    connectTimeoutMs: 50,
    totalTimeoutMs: 200,
    fetchImpl,
    ...overrides
  });
}

test('Chat client requests strict non-streaming JSON without tools', async () => {
  let captured;
  const model = client(async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ claims: [{ text: 'fact', citationIds: ['chunk_1'] }] }) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const result = await model.complete({ systemPrompt: 'fixed', userPrompt: '<knowledge_context />' });
  assert.equal(captured.url, 'https://models.example.test/v1/chat/completions');
  assert.equal(captured.options.headers.Authorization, 'Bearer model-secret');
  assert.equal(captured.body.temperature, 0);
  assert.equal(captured.body.stream, false);
  assert.equal(captured.body.tools, undefined);
  assert.equal(captured.body.tool_choice, undefined);
  assert.equal(captured.body.response_format.type, 'json_schema');
  assert.equal(captured.body.response_format.json_schema.strict, true);
  assert.deepEqual(result.claims[0].citationIds, ['chunk_1']);
});

test('Chat client maps invalid JSON, 429 and timeout to stable errors', async () => {
  await assert.rejects(
    client(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'vendor invalid json' } }] }), { status: 200 })).complete({ systemPrompt: 's', userPrompt: 'u' }),
    (error) => error.errorCode === 'RAG_MODEL_OUTPUT_INVALID' && !error.message.includes('vendor')
  );
  await assert.rejects(
    client(async () => new Response('vendor rate body', { status: 429 })).complete({ systemPrompt: 's', userPrompt: 'u' }),
    (error) => error.errorCode === 'RAG_MODEL_RATE_LIMITED' && error.retryable && !error.message.includes('vendor')
  );
  const timeout = client((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('vendor timeout', 'AbortError')), { once: true });
  }), { connectTimeoutMs: 5, totalTimeoutMs: 20 });
  await assert.rejects(
    timeout.complete({ systemPrompt: 's', userPrompt: 'u' }),
    (error) => error.errorCode === 'RAG_MODEL_UNAVAILABLE' && !error.message.includes('vendor')
  );
});
