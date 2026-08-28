import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { foundationEnv } from '../helpers/foundation.js';

test('FAQ chat persists every question and displayed answer for the IP-scoped conversation', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-faq-chat-'));
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: foundationEnv({ DATA_DIR: dataDir })
  });
  t.after(async () => {
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();

  const counts = runtime.database.prepare(`
    SELECT domain, COUNT(*) AS count FROM faq_entry GROUP BY domain ORDER BY domain
  `).all().map((row) => ({ ...row }));
  assert.deepEqual(counts, [
    { domain: 'ACP', count: 30 },
    { domain: 'FDE', count: 30 },
    { domain: 'PBA', count: 30 },
    { domain: 'PMP', count: 30 }
  ]);

  const api = request.agent(runtime.app);
  const first = await api.post('/api/chat')
    .set('Origin', 'http://localhost:5173')
    .send({ message: 'PMP是什么？' })
    .expect(200);
  assert.equal(first.body.responseType, 'ANSWER');
  assert.equal(first.body.branch, '9-2');
  assert.equal(first.body.contextUsed, false);
  assert.match(first.body.answer, /Project Management Professional/);

  const followUp = await api.post('/api/chat')
    .set('Origin', 'http://localhost:5173')
    .send({ message: '费用呢', conversationId: first.body.conversationId })
    .expect(200);
  assert.equal(followUp.body.responseType, 'ANSWER');
  assert.equal(followUp.body.matchedQuestion, 'PMP考试的费用是多少？');
  assert.equal(followUp.body.intent, 'FOLLOW_UP');

  const second = await api.post('/api/chat')
    .set('Origin', 'http://localhost:5173')
    .send({ message: 'PMP考试', conversationId: followUp.body.conversationId })
    .expect(200);
  assert.equal(second.body.responseType, 'CANDIDATES');
  assert.equal(second.body.contextUsed, true);
  assert.ok(second.body.candidates.length > 1);

  const selected = second.body.candidates[0];
  const third = await api.post('/api/chat')
    .set('Origin', 'http://localhost:5173')
    .send({
      message: selected.question,
      conversationId: second.body.conversationId,
      selectedFaqId: selected.faqId
    })
    .expect(200);
  assert.equal(third.body.responseType, 'ANSWER');
  assert.equal(third.body.matchedFaqId, selected.faqId);
  assert.equal(third.body.contextUsed, true);

  const session = runtime.database.prepare('SELECT id, user_ip FROM chat_session WHERE id = ?').get(first.body.conversationId);
  assert.equal(session.user_ip, '127.0.0.1');
  const messages = runtime.database.prepare(`
    SELECT role, content, metadata FROM chat_message WHERE session_id = ? ORDER BY sequence
  `).all(session.id).map((row) => ({ ...row, metadata: JSON.parse(row.metadata) }));
  assert.deepEqual(messages.map((message) => message.role), [
    'USER', 'ASSISTANT', 'USER', 'ASSISTANT', 'USER', 'ASSISTANT', 'USER', 'ASSISTANT'
  ]);
  assert.equal(messages[1].content, first.body.answer);
  assert.equal(messages[3].content, followUp.body.answer);
  assert.equal(messages[5].content, second.body.answer);
  assert.deepEqual(messages[5].metadata.candidates, second.body.candidates);
  assert.equal(messages[7].content, third.body.answer);
});

test('FAQ chat routes unrelated and related-without-answer questions to the required fallbacks', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-faq-fallback-'));
  const runtime = await createRuntime({ appRoot: APP_ROOT, env: foundationEnv({ DATA_DIR: dataDir }) });
  t.after(async () => {
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();
  const api = request.agent(runtime.app);

  const cold = await api.post('/api/chat')
    .set('Origin', 'http://localhost:5173')
    .send({ message: '今天天气怎么样' })
    .expect(200);
  assert.equal(cold.body.responseType, 'FALLBACK');
  assert.equal(cold.body.branch, '9-1');
  assert.match(cold.body.answer, /PMP®课程内容/);
  assert.equal(cold.body.candidates.length, 4);

  const menuSelection = await api.post('/api/chat')
    .set('Origin', 'http://localhost:5173')
    .send({ message: '2', conversationId: cold.body.conversationId })
    .expect(200);
  assert.notEqual(menuSelection.body.responseType, 'FALLBACK');
  assert.equal(menuSelection.body.branch, '9-2');
  assert.equal(menuSelection.body.matchedFaqId, cold.body.candidates[1].faqId);
  assert.match(menuSelection.body.matchedQuestion, /报考流程/);

  const transfer = await api.post('/api/chat')
    .set('Origin', 'http://localhost:5173')
    .send({ message: 'PMP考试附近酒店', conversationId: menuSelection.body.conversationId })
    .expect(200);
  assert.equal(transfer.body.responseType, 'TRANSFER');
  assert.equal(transfer.body.branch, '9-3');
  assert.equal(transfer.body.needTransferHuman, true);
  assert.match(transfer.body.answer, /400-638-0878/);

  const totals = runtime.database.prepare(`
    SELECT role, COUNT(*) AS count FROM chat_message GROUP BY role ORDER BY role
  `).all().map((row) => ({ ...row }));
  assert.deepEqual(totals, [{ role: 'ASSISTANT', count: 3 }, { role: 'USER', count: 3 }]);
});
