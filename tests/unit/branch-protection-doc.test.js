import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const doc = readFileSync(
  new URL('../../docs/iterations/mvp-iteration-01/BRANCH_PROTECTION.md', import.meta.url),
  'utf8'
);

test('branch protection doc defines the merge gates and defers remote setup to the lead', () => {
  assert.ok(doc.includes('main'));
  assert.ok(doc.includes('Require a pull request before merging'));
  assert.ok(doc.includes('Require status checks to pass before merging'));
  assert.ok(doc.includes('Windows Node 24 gate'));
  assert.ok(doc.includes('第二台 Windows'));
  assert.ok(doc.includes('不阻塞本轮合并'));
  assert.ok(doc.includes('不执行一切推送到远端仓库的'));
  assert.ok(doc.includes('仅项目负责人'));
});
