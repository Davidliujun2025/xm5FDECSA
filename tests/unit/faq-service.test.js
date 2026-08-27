import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { loadFaqEntries } from '../../backend/src/adapters/faq-files.js';
import { APP_ROOT } from '../../backend/src/app.js';
import { FaqService } from '../../backend/src/services/faq.service.js';

const entries = loadFaqEntries(path.join(APP_ROOT, 'knowledge/faq'));
const repository = {
  list: () => entries,
  findById: (id) => entries.find((entry) => entry.id === id) ?? null
};
const fixedRefusalText = '9-1 冷兜底';
const humanTransferText = '9-3 转人工';
const service = new FaqService(repository, {
  faqMatchThreshold: 0.78,
  faqRelatedThreshold: 0.25,
  faqMaxCandidates: 5,
  fixedRefusalText,
  humanTransferText
});
const topicId = `topic_${'0'.repeat(32)}`;

test('FAQ service returns the stored answer for one exact hit', async () => {
  const result = await service.answer({ topicId, question: 'PMP是什么？' });
  const source = entries.find((entry) => entry.domain === 'PMP' && entry.ordinal === 1);
  assert.equal(result.responseType, 'ANSWER');
  assert.equal(result.answer, source.answer);
  assert.equal(result.matchedFaqId, source.id);
  assert.equal(result.branch, '9-2');
});

test('FAQ service returns candidates for multiple hits and resolves an explicit choice', async () => {
  const result = await service.answer({ topicId, question: 'PMP考试' });
  assert.equal(result.responseType, 'CANDIDATES');
  assert.ok(result.candidates.length > 1);
  assert.match(result.answer, /请选择/);

  const selected = await service.answer({ topicId, question: result.candidates[0].question, selectedFaqId: result.candidates[0].faqId });
  assert.equal(selected.responseType, 'ANSWER');
  assert.equal(selected.answer, entries.find((entry) => entry.id === result.candidates[0].faqId).answer);
});

test('FAQ service separates cold fallback, human transfer, and contextual follow-ups', async () => {
  const cold = await service.answer({ topicId, question: '今天天气怎么样' });
  assert.equal(cold.responseType, 'FALLBACK');
  assert.equal(cold.answer, fixedRefusalText);
  assert.equal(cold.branch, '9-1');

  const transfer = await service.answer({ topicId, question: 'PMP考试附近酒店' });
  assert.equal(transfer.responseType, 'TRANSFER');
  assert.equal(transfer.answer, humanTransferText);
  assert.equal(transfer.branch, '9-3');
  assert.equal(transfer.needTransferHuman, true);

  const followUp = await service.answer({
    topicId,
    question: '费用呢',
    contextualQuestion: '最近一轮对话上下文：\n用户: PMP是什么？\n助手: PMP认证介绍\n当前问题: 费用呢',
    intent: 'FOLLOW_UP'
  });
  assert.equal(followUp.responseType, 'ANSWER');
  assert.equal(followUp.matchedQuestion, 'PMP考试的费用是多少？');

  const unrelatedAfterPmp = await service.answer({
    topicId,
    question: '今天天气怎么样',
    contextualQuestion: '最近一轮对话上下文：\n用户: PMP是什么？\n助手: PMP认证介绍\n当前问题: 今天天气怎么样',
    intent: 'KNOWLEDGE_QUERY'
  });
  assert.equal(unrelatedAfterPmp.responseType, 'FALLBACK');
});

test('FAQ service uses DeepSeek intent rewriting and falls back locally on model failure', async () => {
  const deepSeekService = new FaqService(repository, {
    faqMatchThreshold: 0.78,
    faqRelatedThreshold: 0.25,
    faqMaxCandidates: 5,
    fixedRefusalText,
    humanTransferText
  }, {
    intentClient: {
      async recognize() {
        return { related: true, domains: ['PMP'], standaloneQuestion: 'PMP考试的费用是多少？' };
      }
    }
  });
  const recognized = await deepSeekService.answer({ topicId, question: '这个多少钱' });
  assert.equal(recognized.matchedQuestion, 'PMP考试的费用是多少？');
  assert.equal(recognized.intentProvider, 'DEEPSEEK');

  deepSeekService.intentClient = { async recognize() { throw new Error('network'); } };
  const local = await deepSeekService.answer({ topicId, question: 'PMP是什么？' });
  assert.equal(local.intentProvider, 'LOCAL');
  assert.equal(local.responseType, 'ANSWER');
});
