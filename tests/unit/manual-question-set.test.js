import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const questionSetUrl = new URL(
  '../../docs/iterations/mvp-iteration-01/manual-question-set.json',
  import.meta.url
);
const questionSetDocUrl = new URL(
  '../../docs/iterations/mvp-iteration-01/MANUAL_QUESTION_SET.md',
  import.meta.url
);
const FORBIDDEN_FIELD_PATTERN = /key|secret|token|password|credential/i;
const ALLOWED_TYPES = new Set(['grounded', 'unanswerable', 'attack']);
const ALLOWED_ATTACK_KINDS = new Set(['prompt_injection', 'unauthorized_access']);

function collectKeys(value, prefix = '', keys = []) {
  if (!value || typeof value !== 'object') {
    return keys;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, `${prefix}[]`, keys);
    }
    return keys;
  }
  for (const key of Object.keys(value)) {
    keys.push(`${prefix}.${key}`);
    collectKeys(value[key], `${prefix}.${key}`, keys);
  }
  return keys;
}

const questionSet = JSON.parse(readFileSync(questionSetUrl, 'utf8'));

test('manual question set has the fixed 6/2/2 composition and expected statuses', () => {
  assert.equal(questionSet.composition.grounded, 6);
  assert.equal(questionSet.composition.unanswerable, 2);
  assert.equal(questionSet.composition.attack, 2);
  assert.equal(questionSet.items.length, 10);

  const byType = { grounded: 0, unanswerable: 0, attack: 0 };
  const ids = new Set();
  for (const item of questionSet.items) {
    assert.ok(ALLOWED_TYPES.has(item.type), `${item.id} 类型非法`);
    assert.ok(item.id && item.question && item.judgment, `${item.id} 缺少必填字段`);
    assert.ok(!ids.has(item.id), `题号重复 ${item.id}`);
    ids.add(item.id);
    byType[item.type] += 1;

    if (item.type === 'grounded') {
      assert.equal(item.expectedStatus, 'ANSWERED', item.id);
      assert.ok(Array.isArray(item.expectedCitations) && item.expectedCitations.length > 0, `${item.id} 缺少预期 citation`);
      for (const citation of item.expectedCitations) {
        assert.ok(citation.documentId && citation.location, `${item.id} citation 占位不完整`);
      }
    } else if (item.type === 'unanswerable') {
      assert.equal(item.expectedStatus, 'REFUSED', item.id);
      assert.deepEqual(item.expectedCitations, [], item.id);
    } else {
      assert.equal(item.expectedStatus, 'BLOCKED_OR_REFUSED', item.id);
      assert.ok(ALLOWED_ATTACK_KINDS.has(item.attackKind), `${item.id} attackKind 非法`);
      assert.deepEqual(item.expectedCitations, [], item.id);
    }
  }
  assert.deepEqual(byType, questionSet.composition);
});

test('manual question set contains no credential fields and no tracked business text', () => {
  const forbidden = collectKeys(questionSet).filter((key) => FORBIDDEN_FIELD_PATTERN.test(key));
  assert.deepEqual(forbidden, []);
  const serialized = JSON.stringify(questionSet);
  for (const pattern of ['sk-', 'MODEL_API_KEY', 'RAG_API_KEY']) {
    assert.ok(!serialized.includes(pattern), `题集包含疑似密钥标记 ${pattern}`);
  }
});

test('confirmation document lists every question id for the project lead review', () => {
  const document = readFileSync(questionSetDocUrl, 'utf8');
  assert.ok(document.includes('固定 10 题人工题集'));
  for (const item of questionSet.items) {
    assert.ok(document.includes(item.id), `确认文档缺少 ${item.id}`);
  }
});
