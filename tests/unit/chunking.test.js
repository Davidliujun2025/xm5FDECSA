import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  chunkParsedBlocks,
  createParsedBlock,
  normalizeBlockText,
  normalizeParsedBlocks
} from '../../backend/src/domain/ingestion.js';

test('normalization removes only transport whitespace and control characters', () => {
  assert.equal(normalizeBlockText('\uFEFF  利率\t  3.5%\u0000\r\n 条款不变  '), '利率 3.5%\n条款不变');
  const blocks = normalizeParsedBlocks([
    createParsedBlock({ text: '  ', location: { line: 1 }, order: 0 }),
    createParsedBlock({ text: '事实 A', location: { line: 2 }, order: 1 })
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, '事实 A');
});

test('deterministic chunks target 800-1200 characters with overlap and source locations', () => {
  const blocks = Array.from({ length: 30 }, (_, index) => createParsedBlock({
    text: `第${index + 1}段 ${'事实内容'.repeat(16)}。`,
    location: { kind: 'paragraph', paragraph: index + 1 },
    order: index
  }));
  const input = { documentId: 'doc_test', blocks };
  const first = chunkParsedBlocks(input);
  const second = chunkParsedBlocks(input);
  assert.deepEqual(first, second);
  assert.ok(first.length > 1);
  for (const chunk of first.slice(0, -1)) {
    assert.ok(chunk.text.length >= 800, chunk.text.length);
    assert.ok(chunk.text.length <= 1200, chunk.text.length);
  }
  assert.ok(first[0].location.sources.length > 0);
  assert.equal(first[0].location.start.kind, 'paragraph');
  assert.equal(first[0].ordinal, 0);
  assert.equal(first[1].ordinal, 1);
  const overlapProbe = first[0].text.slice(-100);
  assert.equal(first[1].text.includes(overlapProbe), true);
});
