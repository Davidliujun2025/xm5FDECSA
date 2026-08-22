import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');

function source(name) {
  return readFileSync(path.join(ROOT, name), 'utf8');
}

test('frontend exposes alerts, focus indicators and native disabled states', () => {
  const upload = source('frontend/src/components/UploadAcceptance.jsx');
  const chat = source('frontend/src/components/ChatBot.jsx');
  const messages = source('frontend/src/components/MessageList.jsx');
  const input = source('frontend/src/components/InputBar.jsx');
  const acceptanceCss = source('frontend/src/styles/acceptance.css');
  const chatCss = source('frontend/src/styles/chat.css');

  assert.equal(upload.includes('className="acceptance-error" role="alert"'), true);
  assert.equal(chat.includes("role={sessionState === 'error' ? 'alert' : 'status'}"), true);
  assert.equal(messages.includes("role={message.status === 'ERROR' ? 'alert' : undefined}"), true);
  assert.equal(upload.includes('aria-busy={phase === \'uploading\''), true);
  assert.equal(upload.includes('aria-busy={phase === \'publishing\'}'), true);
  assert.equal(input.includes('disabled={disabled}'), true);
  assert.equal(input.includes('disabled={!canSend}'), true);
  assert.equal(acceptanceCss.includes('.file-drop:focus-within'), true);
  assert.equal(acceptanceCss.includes('.publish-action:focus-visible'), true);
  assert.equal(chatCss.includes('.send-button:focus-visible'), true);
});

test('frontend narrow-screen rules prevent fixed-width controls and long citations from overflowing', () => {
  const acceptanceCss = source('frontend/src/styles/acceptance.css');
  const chatCss = source('frontend/src/styles/chat.css');

  assert.match(acceptanceCss, /@media \(max-width: 520px\)[\s\S]*\.acceptance-actions,[\s\S]*flex-direction: column/);
  assert.match(acceptanceCss, /\.drop-title \{[\s\S]*overflow-wrap: anywhere;[\s\S]*white-space: normal/);
  assert.match(acceptanceCss, /@media \(max-width: 520px\)[\s\S]*\.audit-grid \{[\s\S]*grid-template-columns: 1fr/);
  assert.match(chatCss, /@media \(max-width: 520px\)[\s\S]*overflow-x: hidden/);
  assert.match(chatCss, /\.citation-item a \{[\s\S]*overflow-wrap: anywhere/);
});
