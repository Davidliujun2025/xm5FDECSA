import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readmeUrl = new URL('../../README.md', import.meta.url);
const readme = readFileSync(readmeUrl, 'utf8');

function sectionBetween(startMarker, endMarker) {
  const start = readme.indexOf(startMarker);
  assert.ok(start >= 0, `缺少分节 ${startMarker}`);
  const end = readme.indexOf(endMarker, start);
  assert.ok(end >= 0, `缺少下一分节 ${endMarker}`);
  return readme.slice(start, end);
}

test('README separates the five startup paths in the required order', () => {
  const markers = [
    '路径一：Mock 浏览器验收',
    '路径二：开发模式',
    '路径三：真实模型本机验收',
    '路径四：本地 Swagger',
    '路径五：team 局域网模式'
  ];
  let position = -1;
  for (const marker of markers) {
    const found = readme.indexOf(marker);
    assert.ok(found > position, `${marker} 缺失或顺序错误`);
    position = found;
  }
});

test('README enables a colleague to start Mock acceptance from a clean clone with one command', () => {
  const mockSection = sectionBetween('路径一：Mock 浏览器验收', '路径二：开发模式');
  assert.ok(mockSection.includes('npm ci'));
  assert.ok(mockSection.includes('npm run acceptance'));
  assert.ok(mockSection.includes('/acceptance/upload'));
  assert.ok(mockSection.includes('TEST_ACCEPTANCE_ONLY'));
  assert.ok(mockSection.includes('127.0.0.1:3000'));
  assert.ok(mockSection.includes('不得上传真实企业资料'));
  assert.ok(mockSection.includes('不会自动发布'));
});

test('README describes the production order npm ci, .env, npm run build, start-local', () => {
  const productionSection = sectionBetween('路径三：真实模型本机验收', '路径四：本地 Swagger');
  const codeBlock = /```powershell([\s\S]*?)```/.exec(productionSection);
  assert.ok(codeBlock, 'production 分节缺少 powershell 代码块');
  const orderOf = (token) => {
    const index = codeBlock[1].indexOf(token);
    assert.ok(index >= 0, `production 代码块缺少 ${token}`);
    return index;
  };
  const npmCi = orderOf('npm ci');
  const envExample = orderOf('.env.example');
  const build = orderOf('npm run build');
  const startLocal = orderOf('start-local.ps1');
  assert.ok(npmCi < envExample && envExample < build && build < startLocal, 'production 启动顺序不符合 PRD');
  assert.ok(productionSection.includes('MODEL_BASE_URL'));
  assert.ok(productionSection.includes('MODEL_API_KEY'));
  assert.ok(productionSection.includes('EMBEDDING_MODEL'));
  assert.ok(productionSection.includes('CHAT_MODEL'));
  assert.ok(productionSection.includes('RAG_CONFIG_INVALID'));
});

test('README explains frontend default Topic binding and team prerequisites', () => {
  const bindingSection = sectionBetween('### 前端问答的 Topic 绑定', '## 路径四');
  assert.ok(bindingSection.includes('FRONTEND_DEFAULT_TOPIC_ID'));
  assert.ok(bindingSection.includes('acceptance bootstrap'));
  assert.ok(bindingSection.includes('ACTIVE'));

  const teamSection = sectionBetween('路径五：team 局域网模式', '## 验证、评测与发布');
  assert.ok(teamSection.includes('TEAM_ALLOWED_CIDRS'));
  assert.ok(teamSection.includes('RAG_HOST'));
  assert.ok(teamSection.includes('start-team.ps1'));
  assert.ok(teamSection.includes('不会修改 Windows 防火墙'));
});

test('README keeps Swagger, backend key rules, acceptance isolation and no secrets', () => {
  assert.ok(readme.includes('/api/rag/v1/docs'));
  assert.ok(readme.includes('X-API-Key'));
  assert.ok(readme.includes('Idempotency-Key'));
  assert.ok(readme.includes('HttpOnly'));
  assert.ok(readme.includes('/api/acceptance'));
  assert.ok(readme.includes('404'));
  assert.ok(!readme.includes('sk-'));
  assert.ok(!/\bBearer [A-Za-z0-9+/=_-]{20,}/.test(readme));
  assert.ok(!readme.includes('change-me'));
});
