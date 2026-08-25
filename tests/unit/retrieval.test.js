import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cosineSimilarity, embeddingFromBlob, rankCandidates } from '../../backend/src/domain/retrieval.js';
import { RetrievalService } from '../../backend/src/services/retrieval.service.js';

function blob(values) {
  const output = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => output.writeFloatLE(value, index * 4));
  return output;
}

test('Float32 cosine ranking is stable, thresholded and dimension-safe', () => {
  assert.equal(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([1, 0])), 1);
  const ranked = rankCandidates(Float32Array.from([1, 0]), [
    { id: 'chunk_b', vector: Float32Array.from([1, 0]) },
    { id: 'chunk_a', vector: Float32Array.from([1, 0]) },
    { id: 'chunk_c', vector: Float32Array.from([0, 1]) }
  ], { candidates: 10, threshold: 0.45 });
  assert.deepEqual(ranked.map((item) => item.id), ['chunk_a', 'chunk_b']);
  assert.throws(
    () => cosineSimilarity(Float32Array.from([1]), Float32Array.from([1, 2])),
    (error) => error.errorCode === 'RAG_MODEL_OUTPUT_INVALID'
  );
  assert.throws(
    () => embeddingFromBlob(blob([1, 2]), 3),
    (error) => error.errorCode === 'RAG_MODEL_OUTPUT_INVALID'
  );
});

test('Topic vector cache reuses matching versions and invalidates on published-set change', async () => {
  let version = 'v1';
  let loads = 0;
  const row = {
    id: 'chunk_a', documentId: 'doc_a', fileName: 'a.txt', text: 'alpha evidence',
    location: { lineStart: 1, lineEnd: 1 }, embedding: blob([1, 0]), embeddingDim: 2
  };
  const repository = {
    publishedSet: () => ({ version, chunkCount: 1 }),
    loadPublished: () => {
      loads += 1;
      return [row];
    },
    revalidate: () => [row]
  };
  const service = new RetrievalService({
    repository,
    embeddingClient: { embedQuery: async () => ({ vector: [1, 0], model: 'embed-v1', dimension: 2, space: 'cosine' }) },
    config: {
      model: { embeddingModel: 'embed-v1' }, maxConcurrentRequests: 3,
      retrievalCandidates: 10, evidenceThreshold: 0.45, relatedEvidenceThreshold: 0.25
    }
  });
  assert.equal((await service.search({ topicId: 'topic_a', question: 'alpha', limit: 5 })).results.length, 1);
  assert.equal((await service.search({ topicId: 'topic_a', question: 'alpha', limit: 5 })).results.length, 1);
  assert.equal(loads, 1);
  version = 'v2';
  await service.search({ topicId: 'topic_a', question: 'alpha', limit: 5 });
  assert.equal(loads, 2);
});

test('internal diagnostics distinguish related candidates below the evidence threshold', async () => {
  const row = {
    id: 'chunk_related', documentId: 'doc_related', fileName: 'related.txt', text: 'related evidence',
    location: { lineStart: 1, lineEnd: 1 }, embedding: blob([0.4, Math.sqrt(0.84)]), embeddingDim: 2
  };
  const service = new RetrievalService({
    repository: {
      publishedSet: () => ({ version: 'v1', chunkCount: 1 }),
      loadPublished: () => [row],
      revalidate: () => []
    },
    embeddingClient: {
      embedQuery: async () => ({ vector: [1, 0], model: 'embed-v1', dimension: 2, space: 'cosine' })
    },
    config: {
      model: { embeddingModel: 'embed-v1' }, maxConcurrentRequests: 3,
      retrievalCandidates: 10, evidenceThreshold: 0.45, relatedEvidenceThreshold: 0.25
    }
  });
  const result = await service.search({
    topicId: 'topic_a',
    question: 'related query',
    limit: 5,
    includeDiagnostics: true
  });
  assert.deepEqual(result.results, []);
  assert.equal(result.diagnostics.related, true);
  assert.ok(result.diagnostics.topScore >= 0.39 && result.diagnostics.topScore <= 0.41);
});
