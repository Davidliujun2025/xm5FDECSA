import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { loadFaqEntries } from '../../backend/src/adapters/faq-files.js';
import { APP_ROOT } from '../../backend/src/app.js';
import { rankFaqEntries } from '../../backend/src/domain/faqs.js';

const entries = loadFaqEntries(path.join(APP_ROOT, 'knowledge/faq'));

test('the four attached FAQ documents parse into 120 complete database entries', () => {
  assert.equal(entries.length, 120);
  for (const domain of ['PMP', 'ACP', 'PBA', 'FDE']) {
    const domainEntries = entries.filter((entry) => entry.domain === domain);
    assert.equal(domainEntries.length, 30, domain);
    assert.deepEqual(domainEntries.map((entry) => entry.ordinal), Array.from({ length: 30 }, (_, index) => index + 1));
  }
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 120);
  assert.ok(entries.every((entry) => entry.answer && !entry.answer.includes('\n### 模块')));
});

test('ranking handles exact, broad, follow-up and related-without-answer queries', () => {
  const exact = rankFaqEntries({ question: 'PMP是什么？', contextualQuestion: 'PMP是什么？', entries });
  assert.equal(exact.ranked[0].entry.question, 'PMP是什么？');
  assert.equal(exact.ranked[0].score, 1);

  const broad = rankFaqEntries({ question: 'PMP考试', contextualQuestion: 'PMP考试', entries });
  assert.equal(broad.detectedDomains.has('PMP'), true);
  assert.ok(broad.ranked.filter((item) => item.score >= 0.78 && item.score >= broad.ranked[0].score - 0.08).length > 1);

  const contextual = rankFaqEntries({
    question: '费用呢',
    contextualQuestion: '最近一轮对话上下文：\n用户: PMP是什么？\n助手: PMP认证介绍\n当前问题: 费用呢',
    entries
  });
  assert.equal(contextual.ranked[0].entry.domain, 'PMP');
  assert.equal(contextual.ranked[0].entry.ordinal, 6);

  const hotel = rankFaqEntries({ question: 'PMP考试附近酒店', contextualQuestion: 'PMP考试附近酒店', entries });
  assert.ok(hotel.ranked[0].score < 0.78);
});
