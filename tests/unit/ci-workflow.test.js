import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflowUrl = new URL('../../.github/workflows/test.yml', import.meta.url);
const packageJsonUrl = new URL('../../package.json', import.meta.url);
const workflow = readFileSync(workflowUrl, 'utf8');
const packageJson = JSON.parse(readFileSync(packageJsonUrl, 'utf8'));

test('CI workflow uses Node 24 matching package.json engines', () => {
  assert.ok(workflow.includes('node-version: 24'));
  assert.ok(!workflow.includes('node-version: 22'), 'CI 仍使用 Node 22');
  assert.match(packageJson.engines.node, /24/);
  assert.ok(workflow.includes('actions/setup-node@v5'));
  assert.ok(workflow.includes('actions/checkout@v5'));
});
