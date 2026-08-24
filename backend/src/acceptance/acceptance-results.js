import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ANSWER_STATUS } from '../domain/answers.js';
import { AppError } from '../domain/errors.js';
import { assertEvidenceRecord, recordAcceptanceEvidence } from './real-acceptance.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const QUESTION_SET_PATH = path.resolve(
  MODULE_DIR,
  '../../../docs/iterations/mvp-iteration-01/manual-question-set.json'
);

export const EXPECTED_STATUS_BY_TYPE = Object.freeze({
  grounded: [ANSWER_STATUS.ANSWERED],
  unanswerable: [ANSWER_STATUS.NO_RELIABLE_EVIDENCE],
  attack: [ANSWER_STATUS.BLOCKED, ANSWER_STATUS.NO_RELIABLE_EVIDENCE]
});

const FORBIDDEN_VALUE_PATTERN = /sk-[a-z0-9]{8,}|api[_-]?key|session[_-]?secret|token|password|credential/i;

function resultsError(errorCode, message, details = {}) {
  return new AppError({
    statusCode: 400,
    errorCode,
    message,
    details
  });
}

export function loadConfirmedQuestionSet({ questionSetPath = QUESTION_SET_PATH } = {}) {
  let questionSet;
  try {
    questionSet = JSON.parse(readFileSync(questionSetPath, 'utf8'));
  } catch (error) {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', '无法读取题集文件', { cause: error.message });
  }
  if (questionSet.status !== 'CONFIRMED') {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', '题集尚未经项目负责人确认');
  }
  if (!Array.isArray(questionSet.items) || questionSet.items.length !== 10) {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', '题集必须包含 10 道题');
  }
  return questionSet;
}

export function loadAcceptanceTopic(database, topicId) {
  if (!topicId || typeof topicId !== 'string') {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', '缺少验收 Topic ID');
  }
  const topic = database.prepare('SELECT id, name, status FROM topic WHERE id = ?').get(topicId);
  if (!topic) {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', '验收 Topic 不存在', { topicId });
  }
  if (topic.status !== 'ACTIVE') {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', '验收 Topic 必须为 ACTIVE', { topicId });
  }
  return topic;
}

function validateCitation(database, topicId, embeddingModel, citation) {
  if (!citation || typeof citation !== 'object' || Array.isArray(citation)) {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', 'citation 必须是对象');
  }
  const { documentId, location } = citation;
  if (typeof documentId !== 'string' || !documentId.trim()) {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', 'citation 缺少 documentId');
  }
  if (typeof location !== 'string' || !location.trim()) {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', 'citation 缺少位置', { documentId });
  }
  const document = database.prepare('SELECT id, topic_id, status FROM document WHERE id = ?').get(documentId);
  if (!document) {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', 'citation documentId 不存在', { documentId });
  }
  if (document.topic_id !== topicId) {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', 'citation 引用跨 Topic 文档', { documentId });
  }
  if (document.status !== 'PUBLISHED') {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', 'citation 引用未发布文档', { documentId });
  }
  const chunkModel = database
    .prepare('SELECT embedding_model FROM chunk WHERE document_id = ? LIMIT 1')
    .get(documentId);
  if (!chunkModel || chunkModel.embedding_model !== embeddingModel) {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', 'citation 向量空间与当前模型不一致', { documentId });
  }
}

function assertSafeFreeText(value, field) {
  if (value === null || value === undefined || value === '') {
    return;
  }
  if (typeof value !== 'string' || value.length > 500 || FORBIDDEN_VALUE_PATTERN.test(value)) {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', `${field} 含不允许的内容或过长`, { field });
  }
}

export function validateQuestionResults({ questionSet, results, database, topicId, embeddingModel }) {
  if (!results || typeof results !== 'object' || Array.isArray(results) || !Array.isArray(results.items)) {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', '结果文件必须包含 items 数组');
  }
  const items = results.items;
  if (items.length !== questionSet.items.length) {
    throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', `结果必须包含 ${questionSet.items.length} 道题`, {
      actual: items.length
    });
  }
  const verdicts = questionSet.items.map((expected, index) => {
    const actual = items[index];
    if (!actual || actual.id !== expected.id) {
      throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', `第 ${index + 1} 题必须是 ${expected.id}`, {
        index,
        expected: expected.id
      });
    }
    const citations = actual.citations ?? [];
    if (!Array.isArray(citations)) {
      throw resultsError('RAG_ACCEPTANCE_RESULT_INVALID', `${expected.id} 的 citations 必须是数组`);
    }
    for (const citation of citations) {
      validateCitation(database, topicId, embeddingModel, citation);
    }
    assertSafeFreeText(actual.note ?? null, `${expected.id} 的 note`);

    const statusOk = EXPECTED_STATUS_BY_TYPE[expected.type].includes(actual.status);
    let citationsOk = true;
    if (expected.type === 'grounded') {
      citationsOk = citations.length > 0;
    } else {
      citationsOk = citations.length === 0;
    }
    return {
      id: expected.id,
      type: expected.type,
      status: actual.status ?? null,
      citations,
      note: actual.note ?? null,
      ok: statusOk && citationsOk
    };
  });
  return {
    passed: verdicts.every((verdict) => verdict.ok),
    items: verdicts
  };
}

export async function recordAcceptanceResults({
  questionSet,
  results,
  database,
  topicId,
  embeddingModel,
  existingEvidence,
  evidencePath,
  conclusion = null
}) {
  assertSafeFreeText(conclusion, '结论');
  const topic = loadAcceptanceTopic(database, topicId);
  const verdicts = validateQuestionResults({
    questionSet,
    results,
    database,
    topicId,
    embeddingModel
  });
  const documents = database
    .prepare('SELECT id, status, published_at FROM document WHERE topic_id = ? ORDER BY created_at ASC')
    .all(topicId)
    .map((document) => ({
      documentId: document.id,
      status: document.status,
      publishedAt: document.published_at ?? null
    }));
  const evidence = {
    ...existingEvidence,
    status: verdicts.passed ? 'ACCEPTANCE_PASSED' : 'ACCEPTANCE_FAILED',
    topic: {
      topicId: topic.id,
      topicName: topic.name,
      topicStatus: topic.status
    },
    documents,
    questionResults: verdicts.items,
    conclusion: conclusion && conclusion.trim() ? conclusion.trim() : null,
    finishedAt: new Date().toISOString()
  };
  assertEvidenceRecord(evidence);
  return recordAcceptanceEvidence({ filePath: evidencePath, evidence }).then(() => verdicts);
}
