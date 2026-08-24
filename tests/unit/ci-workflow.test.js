import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

test('CI workflow keeps Windows as the primary gate and Ubuntu as supplementary', () => {
  const windowsJob = /runs-on: windows-latest/.exec(workflow);
  const ubuntuJob = /runs-on: ubuntu-latest/.exec(workflow);
  assert.ok(windowsJob, '缺少 windows-latest Job');
  assert.ok(ubuntuJob, '缺少 ubuntu-latest Job');
  assert.ok(windowsJob.index < ubuntuJob.index, 'Windows Job 必须是主门禁');
  assert.ok(workflow.includes('npm ci'));
  assert.ok(workflow.includes('npm run verify'));
});

test('CI workflow runs the Mock browser acceptance E2E files that exist in the repository', () => {
  const e2eStep = /node --test ([^\n]+)/.exec(workflow);
  assert.ok(e2eStep, '缺少 Mock 浏览器端到端步骤');
  const files = e2eStep[1].trim().split(/\s+/);
  assert.ok(files.length >= 4, 'Mock 端到端测试文件不足');
  for (const file of files) {
    assert.match(file, /^tests\/integration\/.+\.test\.js$/);
    assert.ok(existsSync(new URL(`../../${file}`, import.meta.url)), `端到端测试文件不存在: ${file}`);
  }
  assert.ok(files.includes('tests/integration/sample-upload.test.js'), '端到端未覆盖仓库自带样例');
});

test('CI workflow enforces the whitespace and secret gates without leaking artifacts', () => {
  assert.ok(workflow.includes('git diff --check'));
  assert.ok(workflow.includes('git merge-base HEAD origin/main'));
  assert.ok(workflow.includes('npm run verify'), 'verify 未作为门禁（内含安全扫描与禁止文件检查）');
  assert.ok(!/MODEL_API_KEY|RAG_API_KEY|X-API-Key\s*[=:]\s*\S+/.test(workflow), 'workflow 疑似包含密钥');
  assert.ok(!workflow.includes('.env'), 'workflow 不应依赖 .env');
});
