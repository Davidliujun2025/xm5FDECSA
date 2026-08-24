import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../backend/src/app.js';
import { embeddingToBlob } from '../backend/src/domain/chunks.js';
import { API_KEY, foundationEnv } from '../tests/helpers/foundation.js';

const TOPIC_ID = `topic_${'9'.repeat(32)}`;
const MODEL = 'performance-embedding-v1';
const THRESHOLDS_MS = Object.freeze({ uploadP95: 2000, searchP95: 5000, chatP95: 20000, publishDisableEffective: 10000 });

function percentile95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(2));
}

async function measured(action) {
  const startedAt = performance.now();
  const result = await action();
  return { result, durationMs: performance.now() - startedAt };
}

function seed(database) {
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO topic(id, name, normalized_name, description, status, created_at, updated_at)
    VALUES (?, 'Performance', 'performance', '', 'ACTIVE', ?, ?)`).run(TOPIC_ID, now, now);
  for (const [suffix, status] of [['1', 'PUBLISHED'], ['2', 'READY']]) {
    const documentId = `doc_${suffix.repeat(32)}`;
    const text = `performance evidence ${suffix}`;
    const hash = createHash('sha256').update(text).digest('hex');
    database.prepare(`INSERT INTO document(
      id, topic_id, file_name, safe_name, sha256, mime, size_bytes, status, file_path,
      parse_version, created_at, updated_at, published_at, disabled_at
    ) VALUES (?, ?, ?, ?, ?, 'text/plain', ?, ?, ?, 'perf-v1', ?, ?, ?, NULL)`).run(
      documentId, TOPIC_ID, `performance-${suffix}.txt`, `performance-${suffix}.txt`, hash,
      Buffer.byteLength(text), status, `original/${TOPIC_ID}/${documentId}/source.txt`, now, now,
      status === 'PUBLISHED' ? now : null
    );
    database.prepare(`INSERT INTO chunk(
      id, topic_id, document_id, ordinal, text, location, text_hash, embedding,
      embedding_dim, embedding_model, embedding_space, parse_version, created_at
    ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, 2, ?, 'cosine', 'perf-v1', ?)`).run(
      `chunk_performance_${suffix}`, TOPIC_ID, documentId, text,
      JSON.stringify({ kind: 'line', lineStart: 1, lineEnd: 1 }), hash,
      embeddingToBlob([1, 0]), MODEL, now
    );
  }
}

export async function runPerformanceAcceptance({ iterations = 20 } = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-performance-'));
  const embeddingFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify({
      model: body.model,
      data: body.input.map((text, index) => ({ index, embedding: [1, 0] }))
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const chatFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const citationId = /"citationId":"([^"]+)"/.exec(body.messages[1].content)?.[1];
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ claims: [{ text: '性能测试脱敏事实。', citationIds: [citationId] }] }) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: foundationEnv({
      DATA_DIR: dataDir,
      MODEL_BASE_URL: 'https://models.example.test/v1',
      MODEL_API_KEY: 'performance-model-key',
      EMBEDDING_MODEL: MODEL,
      CHAT_MODEL: 'performance-chat-v1',
      EVIDENCE_THRESHOLD: '0.45'
    }),
    embeddingFetch,
    chatFetch
  });
  try {
    await runtime.initialize();
    seed(runtime.database);
    const api = request(runtime.app);
    const uploadDurations = [];
    for (let index = 0; index < iterations; index += 1) {
      const measurement = await measured(() => api.post('/api/rag/v1/documents')
        .set('X-API-Key', API_KEY).set('Idempotency-Key', `performance-upload-${index}`)
        .field('topicId', TOPIC_ID)
        .attach('file', Buffer.from(`performance upload ${index}`), { filename: `upload-${index}.txt`, contentType: 'text/plain' })
        .expect(202));
      uploadDurations.push(measurement.durationMs);
    }
    const searchDurations = [];
    for (let index = 0; index < iterations; index += 1) {
      const measurement = await measured(() => api.post('/api/rag/v1/search').set('X-API-Key', API_KEY)
        .send({ topicId: TOPIC_ID, question: `performance search ${index}` }).expect(200));
      searchDurations.push(measurement.durationMs);
    }
    const chatDurations = [];
    for (let index = 0; index < iterations; index += 1) {
      const measurement = await measured(() => api.post('/api/rag/v1/chat').set('X-API-Key', API_KEY)
        .send({ topicId: TOPIC_ID, question: `performance chat ${index}` }).expect(200));
      assertAnswered(measurement.result.body);
      chatDurations.push(measurement.durationMs);
    }

    const lifecycleStartedAt = performance.now();
    await api.post(`/api/rag/v1/documents/doc_${'2'.repeat(32)}/publish`).set('X-API-Key', API_KEY).expect(200);
    const afterPublish = await api.post('/api/rag/v1/search').set('X-API-Key', API_KEY)
      .send({ topicId: TOPIC_ID, question: 'performance lifecycle' }).expect(200);
    const publishedVisible = afterPublish.body.results.some((item) => item.documentId === `doc_${'2'.repeat(32)}`);
    await api.post(`/api/rag/v1/documents/doc_${'2'.repeat(32)}/disable`).set('X-API-Key', API_KEY).expect(200);
    const afterDisable = await api.post('/api/rag/v1/search').set('X-API-Key', API_KEY)
      .send({ topicId: TOPIC_ID, question: 'performance lifecycle' }).expect(200);
    const disabledHidden = afterDisable.body.results.every((item) => item.documentId !== `doc_${'2'.repeat(32)}`);
    const metrics = {
      uploadP95: percentile95(uploadDurations),
      searchP95: percentile95(searchDurations),
      chatP95: percentile95(chatDurations),
      publishDisableEffective: Number((performance.now() - lifecycleStartedAt).toFixed(2))
    };
    return {
      iterations,
      thresholdsMs: THRESHOLDS_MS,
      metricsMs: metrics,
      publicationVisibility: { publishedVisible, disabledHidden },
      passed: Object.entries(THRESHOLDS_MS).every(([key, value]) => metrics[key] <= value) && publishedVisible && disabledHidden
    };
  } finally {
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function assertAnswered(body) {
  if (body.status !== 'ANSWERED' || body.citations.length === 0) {
    throw new Error('performance chat did not produce a grounded answer');
  }
}

async function main() {
  const outputIndex = process.argv.indexOf('--output');
  const report = await runPerformanceAcceptance();
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    writeFileSync(path.resolve(process.argv[outputIndex + 1]), serialized, 'utf8');
  }
  process.stdout.write(serialized);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`RAG_PERFORMANCE_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
