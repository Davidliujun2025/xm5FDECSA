import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const report = readFileSync(new URL('../../docs/ACCEPTANCE_REPORT.md', import.meta.url), 'utf8');

test('report records test counts, scan counts, commit SHA, CI and manual-model status', () => {
  assert.ok(report.includes('142/142'));
  assert.ok(report.includes('204'));
  assert.ok(report.includes('codex/acceptance-handoff'));
  assert.ok(/\b[0-9a-f]{7}\b/.test(report), '报告缺少提交 SHA');
  assert.ok(report.includes('CI 链接'));
  assert.ok(report.includes('真实模型人工验收'));
  assert.ok(report.includes('暂缓'));
  assert.ok(report.includes('合并前必须补验'));
});

test('report keeps second Windows non-blocking and contains no secrets or absolute paths', () => {
  assert.ok(report.includes('不阻塞本轮合并'));
  assert.ok(!/[a-zA-Z]:\\/.test(report), '报告包含本机绝对路径');
  assert.ok(!/sk-[a-z0-9]{8,}/i.test(report), '报告包含疑似密钥');
  assert.ok(!/(?:api[_-]?key|token|password)\s*[=:]\s*\S+/i.test(report), '报告包含键值形态凭据');
  assert.ok(!report.includes('RAG_API_KEY='));
});
