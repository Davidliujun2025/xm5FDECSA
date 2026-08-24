import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EmbeddingClient } from '../../backend/src/adapters/models/embedding-client.js';
import { createIndexedChunks } from '../../backend/src/domain/chunks.js';

function client(fetchImpl, overrides = {}) {
  return new EmbeddingClient({
    baseUrl: 'https://models.example.test/v1',
    apiKey: 'model-secret',
    model: 'embed-approved-v1',
    connectTimeoutMs: 50,
    totalTimeoutMs: 200,
    fetchImpl,
    ...overrides
  });
}

test('Embedding client sends at most 32 ordered texts and validates model metadata', async () => {
  let request;
  const model = client(async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      model: 'embed-approved-v1',
      data: [
        { index: 1, embedding: [0.3, 0.4] },
        { index: 0, embedding: [0.1, 0.2] }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const result = await model.embed(['first', 'second']);
  assert.equal(request.url, 'https://models.example.test/v1/embeddings');
  assert.equal(request.options.headers.Authorization, 'Bearer model-secret');
  assert.deepEqual(request.body, { model: 'embed-approved-v1', input: ['first', 'second'] });
  assert.deepEqual(result.vectors, [[0.1, 0.2], [0.3, 0.4]]);
  assert.equal(result.dimension, 2);
  assert.equal(result.space, 'cosine');

  await assert.rejects(
    model.embed(Array.from({ length: 33 }, () => 'too many')),
    (error) => error.errorCode === 'RAG_INVALID_REQUEST'
  );
});

test('401, 429, timeout and invalid dimensions map to stable errors without vendor bodies', async () => {
  const cases = [
    {
      fetchImpl: async () => new Response('vendor 401 secret stack', { status: 401 }),
      code: 'RAG_MODEL_UNAVAILABLE', retryable: false
    },
    {
      fetchImpl: async () => new Response('vendor 429 secret stack', { status: 429 }),
      code: 'RAG_MODEL_RATE_LIMITED', retryable: true
    },
    {
      fetchImpl: async () => new Response(JSON.stringify({
        model: 'embed-approved-v1',
        data: [{ index: 0, embedding: [1, 2] }, { index: 1, embedding: [3] }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      code: 'RAG_MODEL_OUTPUT_INVALID', retryable: false,
      texts: ['a', 'b']
    }
  ];
  for (const item of cases) {
    await assert.rejects(client(item.fetchImpl).embed(item.texts ?? ['a']), (error) => {
      assert.equal(error.errorCode, item.code);
      assert.equal(error.retryable, item.retryable);
      assert.equal(error.message.includes('vendor'), false);
      assert.deepEqual(error.details, {});
      return true;
    });
  }

  const timeout = client((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('vendor timeout', 'AbortError')), { once: true });
  }), { connectTimeoutMs: 5, totalTimeoutMs: 20 });
  await assert.rejects(timeout.embed(['a']), (error) => (
    error.errorCode === 'RAG_MODEL_UNAVAILABLE'
    && error.retryable
    && !error.message.includes('vendor')
  ));
});

test('indexed chunks persist finite little-endian float32 vectors and complete metadata', () => {
  const chunks = createIndexedChunks({
    topicId: 'topic_test',
    drafts: [{ documentId: 'doc_test', ordinal: 0, text: 'fact', location: { page: 1 } }],
    vectors: [[1.5, -2.25]],
    model: 'embed-approved-v1',
    dimension: 2,
    space: 'cosine',
    parseVersion: 'index_test',
    now: () => new Date('2026-08-21T10:00:00.000Z'),
    idGenerator: () => 'chunk_test'
  });
  assert.equal(chunks[0].embedding.length, 8);
  assert.equal(chunks[0].embedding.readFloatLE(0), 1.5);
  assert.equal(chunks[0].embedding.readFloatLE(4), -2.25);
  assert.equal(chunks[0].embeddingModel, 'embed-approved-v1');
  assert.equal(chunks[0].embeddingDim, 2);
  assert.equal(chunks[0].embeddingSpace, 'cosine');
});
