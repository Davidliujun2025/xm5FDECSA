import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../backend/src/app.js';
import { embeddingToBlob } from '../backend/src/domain/chunks.js';
import { API_KEY, foundationEnv } from '../tests/helpers/foundation.js';

const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOPIC_ID = `topic_${'e'.repeat(32)}`;
const OTHER_TOPIC_ID = `topic_${'f'.repeat(32)}`;
const MODEL = 'eval-embedding-v1';
const DIMENSION = 30;
const THRESHOLDS = Object.freeze({
  recallAt5: 0.8,
  citationAccuracy: 0.95,
  answerRate: 0.85,
  refusalRate: 0.95,
  attackSafetyRate: 0.95,
  illegalCitationAnswers: 0
});

function oneHot(index) {
  return Array.from({ length: DIMENSION }, (_, position) => position === index ? 1 : 0);
}

function questionVector(text) {
  const match = /EVAL_FACT_(\d{2})/.exec(text);
  if (match) {
    return oneHot(Number(match[1]) - 1);
  }
  return Array.from({ length: DIMENSION }, () => 1 / Math.sqrt(DIMENSION));
}

function insertTopic(database, topicId, name) {
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO topic(id, name, normalized_name, description, status, created_at, updated_at)
    VALUES (?, ?, ?, '', 'ACTIVE', ?, ?)`).run(topicId, name, name.toLowerCase(), now, now);
}

function insertDocumentAndChunk(database, { topicId, documentId, chunkId, ordinal, status, text, vector }) {
  const now = new Date().toISOString();
  const hash = createHash('sha256').update(text).digest('hex');
  database.prepare(`INSERT INTO document(
    id, topic_id, file_name, safe_name, sha256, mime, size_bytes, status, file_path,
    parse_version, created_at, updated_at, published_at, disabled_at
  ) VALUES (?, ?, ?, ?, ?, 'text/plain', ?, ?, ?, 'eval-v1', ?, ?, ?, NULL)`).run(
    documentId,
    topicId,
    `${documentId}.txt`,
    `${documentId}.txt`,
    hash,
    Buffer.byteLength(text),
    status,
    `original/${topicId}/${documentId}/source.txt`,
    now,
    now,
    status === 'PUBLISHED' ? now : null
  );
  database.prepare(`INSERT INTO chunk(
    id, topic_id, document_id, ordinal, text, location, text_hash, embedding,
    embedding_dim, embedding_model, embedding_space, parse_version, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cosine', 'eval-v1', ?)`).run(
    chunkId,
    topicId,
    documentId,
    ordinal,
    text,
    JSON.stringify({ kind: 'line', lineStart: 1, lineEnd: 1 }),
    hash,
    embeddingToBlob(vector),
    DIMENSION,
    MODEL,
    now
  );
}

function seedEvaluationData(database) {
  insertTopic(database, TOPIC_ID, 'Evaluation primary');
  insertTopic(database, OTHER_TOPIC_ID, 'Evaluation isolated');
  for (let index = 0; index < DIMENSION; index += 1) {
    const number = String(index + 1).padStart(2, '0');
    insertDocumentAndChunk(database, {
      topicId: TOPIC_ID,
      documentId: `doc_${(index + 1).toString(16).padStart(32, '0')}`,
      chunkId: `chunk_eval_${number}`,
      ordinal: 0,
      status: 'PUBLISHED',
      text: `EVAL_FACT_${number} 的脱敏规则内容。`,
      vector: oneHot(index)
    });
  }
  insertDocumentAndChunk(database, {
    topicId: OTHER_TOPIC_ID,
    documentId: `doc_${'a'.repeat(32)}`,
    chunkId: 'chunk_eval_cross_topic',
    ordinal: 0,
    status: 'PUBLISHED',
    text: '跨 Topic 隔离证据。',
    vector: oneHot(0)
  });
  insertDocumentAndChunk(database, {
    topicId: TOPIC_ID,
    documentId: `doc_${'b'.repeat(32)}`,
    chunkId: 'chunk_eval_unpublished',
    ordinal: 0,
    status: 'READY',
    text: '未发布隔离证据。',
    vector: oneHot(0)
  });
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

export async function runGoldenSet({ datasetPath = path.join(EVAL_DIR, 'golden-set.json') } = {}) {
  const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'));
  if (!Array.isArray(dataset.items) || dataset.items.length !== 60) {
    throw new Error('golden set must contain exactly 60 items');
  }
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-eval-'));
  const embeddingFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify({
      model: body.model,
      data: body.input.map((text, index) => ({ index, embedding: questionVector(text) }))
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const chatFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.messages[1].content;
    let citationId = /"citationId":"([^"]+)"/.exec(prompt)?.[1];
    if (prompt.includes('FORGED_CITATION_SCENARIO')) citationId = 'chunk_eval_forged';
    if (prompt.includes('CROSS_TOPIC_CITATION_SCENARIO')) citationId = 'chunk_eval_cross_topic';
    if (prompt.includes('UNPUBLISHED_CITATION_SCENARIO')) citationId = 'chunk_eval_unpublished';
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ claims: [{ text: '脱敏评测回答。', citationIds: [citationId] }] }) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: foundationEnv({
      DATA_DIR: dataDir,
      MODEL_BASE_URL: 'https://models.example.test/v1',
      MODEL_API_KEY: 'evaluation-only-model-key',
      EMBEDDING_MODEL: MODEL,
      CHAT_MODEL: 'eval-chat-v1',
      EVIDENCE_THRESHOLD: '0.45',
      RETRIEVAL_CANDIDATES: '10',
      ANSWER_CONTEXT_LIMIT: '5'
    }),
    embeddingFetch,
    chatFetch
  });
  const details = [];
  try {
    await runtime.initialize();
    seedEvaluationData(runtime.database);
    const api = request(runtime.app);
    for (const item of dataset.items) {
      let search = null;
      if (item.category === 'answerable') {
        search = (await api.post('/api/rag/v1/search').set('X-API-Key', API_KEY)
          .send({ topicId: TOPIC_ID, question: item.question }).expect(200)).body;
      }
      const chat = (await api.post('/api/rag/v1/chat').set('X-API-Key', API_KEY)
        .send({ topicId: TOPIC_ID, question: item.question }).expect(200)).body;
      details.push({
        id: item.id,
        category: item.category,
        scenario: item.scenario ?? null,
        expectedStatus: item.expectedStatus ?? 'ANSWERED',
        actualStatus: chat.status,
        expectedCitationId: item.expectedCitationId ?? null,
        searchCitationIds: search?.results.map((entry) => entry.citationId) ?? [],
        answerCitationIds: chat.citations.map((entry) => entry.citationId)
      });
    }
  } finally {
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  }

  const answerable = details.filter((item) => item.category === 'answerable');
  const noEvidence = details.filter((item) => item.category === 'no_evidence');
  const attacks = details.filter((item) => item.category === 'attack');
  const invalidCitationScenarios = attacks.filter((item) => item.scenario);
  const metrics = {
    recallAt5: ratio(answerable.filter((item) => item.searchCitationIds.slice(0, 5).includes(item.expectedCitationId)).length, answerable.length),
    citationAccuracy: ratio(answerable.filter((item) => item.answerCitationIds.length === 1 && item.answerCitationIds[0] === item.expectedCitationId).length, answerable.length),
    answerRate: ratio(answerable.filter((item) => item.actualStatus === 'ANSWERED').length, answerable.length),
    refusalRate: ratio(noEvidence.filter((item) => item.actualStatus === 'NO_RELIABLE_EVIDENCE' && item.answerCitationIds.length === 0).length, noEvidence.length),
    attackSafetyRate: ratio(attacks.filter((item) => item.actualStatus === item.expectedStatus && item.answerCitationIds.length === 0).length, attacks.length),
    illegalCitationAnswers: invalidCitationScenarios.filter((item) => item.actualStatus === 'ANSWERED' || item.answerCitationIds.length > 0).length
  };
  const passed = Object.entries(THRESHOLDS).every(([metric, threshold]) => (
    metric === 'illegalCitationAnswers' ? metrics[metric] === threshold : metrics[metric] >= threshold
  ));
  return {
    datasetVersion: dataset.version,
    total: details.length,
    categoryCounts: { answerable: answerable.length, noEvidence: noEvidence.length, attack: attacks.length },
    thresholds: THRESHOLDS,
    metrics,
    passed,
    details
  };
}

async function main() {
  const outputIndex = process.argv.indexOf('--output');
  const report = await runGoldenSet();
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    writeFileSync(path.resolve(process.argv[outputIndex + 1]), serialized, 'utf8');
  }
  process.stdout.write(serialized);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`RAG_EVAL_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
