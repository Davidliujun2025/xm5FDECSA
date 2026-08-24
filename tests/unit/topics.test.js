import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyTopicPatch,
  createDraftTopic,
  normalizeTopicName,
  normalizeTopicPatch,
  TOPIC_STATUS,
  topicToResponse
} from '../../backend/src/domain/topics.js';

const NOW = new Date('2026-08-21T08:00:00.000Z');

function draft() {
  return createDraftTopic(
    { name: '  PMP 项目管理  ', description: '  课程知识  ' },
    { now: () => NOW, idGenerator: () => 'topic_0123456789abcdef0123456789abcdef' }
  );
}

test('new Topic is normalized and always starts in DRAFT', () => {
  const topic = draft();
  assert.equal(topic.name, 'PMP 项目管理');
  assert.equal(topic.normalizedName, 'pmp 项目管理');
  assert.equal(topic.description, '课程知识');
  assert.equal(topic.status, TOPIC_STATUS.DRAFT);
  assert.equal(topic.createdAt, NOW.toISOString());
  assert.deepEqual(topicToResponse(topic), {
    topicId: topic.id,
    name: topic.name,
    description: topic.description,
    status: topic.status,
    createdAt: topic.createdAt,
    updatedAt: topic.updatedAt
  });
  assert.equal(normalizeTopicName('ＰＭＰ'), 'pmp');
});

test('Topic state machine permits only DRAFT -> ACTIVE -> DISABLED -> ACTIVE', () => {
  const active = applyTopicPatch(draft(), normalizeTopicPatch({ status: 'ACTIVE' }), { now: () => NOW });
  const disabled = applyTopicPatch(active, normalizeTopicPatch({ status: 'DISABLED' }), { now: () => NOW });
  const reactivated = applyTopicPatch(disabled, normalizeTopicPatch({ status: 'ACTIVE' }), { now: () => NOW });
  assert.equal(reactivated.status, TOPIC_STATUS.ACTIVE);

  assert.throws(
    () => applyTopicPatch(draft(), normalizeTopicPatch({ status: 'DISABLED' })),
    (error) => error.errorCode === 'RAG_TOPIC_STATE_INVALID'
  );
  assert.throws(
    () => applyTopicPatch(active, normalizeTopicPatch({ status: 'DRAFT' })),
    (error) => error.errorCode === 'RAG_TOPIC_STATE_INVALID'
  );
});

test('DISABLED Topic rejects metadata edits until re-enabled', () => {
  const active = applyTopicPatch(draft(), normalizeTopicPatch({ status: 'ACTIVE' }));
  const disabled = applyTopicPatch(active, normalizeTopicPatch({ status: 'DISABLED' }));
  assert.throws(
    () => applyTopicPatch(disabled, normalizeTopicPatch({ description: 'new' })),
    (error) => error.errorCode === 'RAG_TOPIC_DISABLED'
  );
});

test('Topic input rejects empty, control characters and unknown fields', () => {
  assert.throws(() => createDraftTopic({ name: '   ' }), (error) => error.errorCode === 'RAG_INVALID_REQUEST');
  assert.throws(() => createDraftTopic({ name: 'bad\u0000name' }), (error) => error.errorCode === 'RAG_INVALID_REQUEST');
  assert.throws(() => normalizeTopicPatch({ autoRoute: true }), (error) => error.errorCode === 'RAG_INVALID_REQUEST');
});
