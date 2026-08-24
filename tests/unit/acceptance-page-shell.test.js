import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('formal acceptance page exposes mode, limits, safety notice and two-way navigation', () => {
  const component = readFileSync(path.join(ROOT, 'frontend/src/components/UploadAcceptance.jsx'), 'utf8');
  const index = readFileSync(path.join(ROOT, 'frontend/src/index.jsx'), 'utf8');
  const chat = readFileSync(path.join(ROOT, 'frontend/src/components/ChatBot.jsx'), 'utf8');
  const styles = readFileSync(path.join(ROOT, 'frontend/src/styles/acceptance.css'), 'utf8');

  assert.equal(index.includes("window.location.pathname === '/acceptance/upload'"), true);
  assert.equal(component.includes('MOCK / LOCAL ACCEPTANCE'), true);
  assert.equal(component.includes('验收 Topic'), true);
  assert.equal(component.includes("['PDF', 'DOCX', 'XLSX', 'PPTX', 'MD', 'TXT']"), true);
  assert.equal(component.includes('30 * 1024 * 1024'), true);
  assert.equal(component.includes('禁止上传真实企业资料'), true);
  assert.equal(component.includes('href="/"'), true);
  assert.equal(chat.includes('href="/acceptance/upload"'), true);
  assert.equal(styles.includes('@media (max-width: 820px)'), true);
});

test('Topic shell distinguishes loading, empty and API error states', () => {
  const component = readFileSync(path.join(ROOT, 'frontend/src/components/UploadAcceptance.jsx'), 'utf8');
  assert.equal(component.includes('正在准备…'), true);
  assert.equal(component.includes('未提供验收 Topic'), true);
  assert.equal(component.includes('验收 Topic 加载失败'), true);
  assert.equal(component.includes("error ? 'ERROR' : 'LOADING'"), true);
  assert.equal(component.includes('role="alert"'), true);
});
