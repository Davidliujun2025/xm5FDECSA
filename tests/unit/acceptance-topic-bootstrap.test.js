import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACCEPTANCE_TOPIC_DESCRIPTION,
  ACCEPTANCE_TOPIC_ID,
  ACCEPTANCE_TOPIC_NAME,
  createAcceptanceTopicBootstrap
} from '../../backend/src/acceptance/topic-bootstrap.js';

function topic(status = 'ACTIVE', overrides = {}) {
  return {
    topicId: ACCEPTANCE_TOPIC_ID,
    name: ACCEPTANCE_TOPIC_NAME,
    description: ACCEPTANCE_TOPIC_DESCRIPTION,
    status,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides
  };
}

function input(topicService) {
  return {
    app: { locals: { topicService } },
    config: { frontendDefaultTopicId: ACCEPTANCE_TOPIC_ID }
  };
}

test('acceptance Topic bootstrap creates a fixed DRAFT then explicitly activates it', async () => {
  const calls = [];
  const context = {};
  const topicService = {
    listTopics(options) {
      calls.push(['list', options]);
      return [];
    },
    createTopic(value, key, options) {
      calls.push(['create', value, key]);
      assert.equal(options.idGenerator(), ACCEPTANCE_TOPIC_ID);
      return { value: topic('DRAFT') };
    },
    updateTopic(topicId, patch, key) {
      calls.push(['update', topicId, patch, key]);
      return { value: topic('ACTIVE') };
    }
  };
  const runtimeInput = input(topicService);
  const result = await createAcceptanceTopicBootstrap({ context })(runtimeInput);

  assert.deepEqual(calls.map(([operation]) => operation), ['list', 'create', 'update']);
  assert.equal(calls[1][1].name, ACCEPTANCE_TOPIC_NAME);
  assert.equal(calls[2][2].status, 'ACTIVE');
  assert.equal(result.topicId, ACCEPTANCE_TOPIC_ID);
  assert.equal(result.topicStatus, 'ACTIVE');
  assert.equal(context.topicId, ACCEPTANCE_TOPIC_ID);
  assert.equal(runtimeInput.app.locals.acceptanceContext, context);
});

test('acceptance Topic bootstrap reuses ACTIVE and reactivates DISABLED without creating duplicates', async () => {
  let createCalls = 0;
  let updateCalls = 0;
  const activeService = {
    listTopics: () => [topic('ACTIVE')],
    createTopic: () => { createCalls += 1; },
    updateTopic: () => { updateCalls += 1; }
  };
  await createAcceptanceTopicBootstrap()(input(activeService));
  assert.equal(createCalls, 0);
  assert.equal(updateCalls, 0);

  const disabledService = {
    ...activeService,
    listTopics: () => [topic('DISABLED', { updatedAt: '2026-08-22T01:00:00.000Z' })],
    updateTopic(topicId, patch, key) {
      updateCalls += 1;
      assert.equal(topicId, ACCEPTANCE_TOPIC_ID);
      assert.deepEqual(patch, { status: 'ACTIVE' });
      assert.match(key, /^acceptance-bootstrap-activate-[a-f0-9]{20}$/);
      return { value: topic('ACTIVE') };
    }
  };
  await createAcceptanceTopicBootstrap()(input(disabledService));
  assert.equal(createCalls, 0);
  assert.equal(updateCalls, 1);
});

test('acceptance Topic bootstrap fails closed for identity conflicts and missing binding', async () => {
  const conflictService = {
    listTopics: () => [topic('ACTIVE', { topicId: `topic_${'f'.repeat(32)}` })],
    createTopic() {},
    updateTopic() {}
  };
  await assert.rejects(
    createAcceptanceTopicBootstrap()(input(conflictService)),
    (error) => error.errorCode === 'RAG_ACCEPTANCE_TOPIC_CONFLICT'
  );
  await assert.rejects(
    createAcceptanceTopicBootstrap()({
      app: { locals: { topicService: conflictService } },
      config: { frontendDefaultTopicId: null }
    }),
    (error) => error.errorCode === 'RAG_ACCEPTANCE_TOPIC_BINDING_INVALID'
  );
});
