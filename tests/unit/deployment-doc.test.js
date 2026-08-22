import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const deploymentDoc = readFileSync(new URL('../../docs/DEPLOYMENT.md', import.meta.url), 'utf8');

test('DEPLOYMENT forbids Mock in production and documents real-model grouping and isolation', () => {
  assert.ok(deploymentDoc.includes('Mock 验收与生产边界'));
  assert.ok(deploymentDoc.includes('不可用于生产'));
  assert.ok(deploymentDoc.includes('不会回退到 Mock'));
  assert.ok(deploymentDoc.includes('MODEL_BASE_URL'));
  assert.ok(deploymentDoc.includes('MODEL_API_KEY'));
  assert.ok(deploymentDoc.includes('EMBEDDING_MODEL'));
  assert.ok(deploymentDoc.includes('CHAT_MODEL'));
  assert.ok(deploymentDoc.includes('RAG_CONFIG_INVALID'));
  assert.ok(deploymentDoc.includes('data/acceptance'));
  assert.ok(deploymentDoc.includes('data/real-acceptance'));
  assert.ok(deploymentDoc.includes('REAL_MODEL_CONFIGURATION.md'));
  assert.ok(deploymentDoc.includes('MANUAL_ACCEPTANCE.md'));
});

test('DEPLOYMENT documents backup, restore and rollback without destructive migration', () => {
  assert.ok(deploymentDoc.includes('停服备份与新目录恢复'));
  assert.ok(deploymentDoc.includes('backup-data.ps1'));
  assert.ok(deploymentDoc.includes('restore-data.ps1'));
  assert.ok(deploymentDoc.includes('回滚'));
  assert.ok(deploymentDoc.includes('回滚本轮 PR'));
  assert.ok(deploymentDoc.includes('不对用户数据执行破坏性迁移'));
});

test('DEPLOYMENT demotes the second Windows machine to a v1.1 suggestion, not a merge gate', () => {
  const sectionStart = deploymentDoc.indexOf('v1.1 建议：第二台电脑验收');
  assert.ok(sectionStart >= 0, '缺少 v1.1 第二台电脑验收分节');
  const sectionEnd = deploymentDoc.indexOf('## 已知边界', sectionStart);
  assert.ok(sectionEnd >= 0);
  const section = deploymentDoc.slice(sectionStart, sectionEnd);
  assert.ok(section.includes('不阻塞本轮合并'));
  assert.ok(!section.includes('不能代替'), '第二台电脑分节仍含旧的签字证据阻塞表述');
});
