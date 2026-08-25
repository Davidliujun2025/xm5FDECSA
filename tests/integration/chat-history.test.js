import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ChatHistoryRepository } from '../../backend/src/adapters/sqlite/chat-history.repository.js';
import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { ChatConversationService } from '../../backend/src/services/chat-conversation.service.js';
import { foundationEnv } from '../helpers/foundation.js';

const TOPIC_ID = `topic_${'e'.repeat(32)}`;

function answer(text = '知识库回答') {
  return {
    status: 'ANSWERED',
    topicId: TOPIC_ID,
    answer: text,
    citations: [],
    intent: 'KNOWLEDGE_QUERY',
    branch: '9-2',
    needTransferHuman: false
  };
}

test('chat history is isolated by IP and stale sessions end after 15 minutes', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-chat-history-'));
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: foundationEnv({ DATA_DIR: dataDir })
  });
  t.after(async () => {
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();

  let current = new Date('2026-08-25T00:00:00.000Z');
  const repository = new ChatHistoryRepository(runtime.database);
  const service = new ChatConversationService(repository, runtime.config, {
    clock: () => new Date(current)
  });

  const first = service.begin({
    userIp: '10.0.0.1',
    topicId: TOPIC_ID,
    question: 'PMP 课程是什么'
  });
  const firstResult = service.complete(first, answer());
  assert.equal(first.hasRecentHistory, false);
  assert.equal(firstResult.contextUsed, false);

  current = new Date('2026-08-25T00:01:00.000Z');
  const followUp = service.begin({
    userIp: '10.0.0.1',
    topicId: TOPIC_ID,
    requestedSessionId: first.sessionId,
    question: '那费用呢'
  });
  assert.equal(followUp.sessionId, first.sessionId);
  assert.equal(followUp.hasRecentHistory, true);
  assert.equal(followUp.intent, 'FOLLOW_UP');
  assert.match(followUp.contextualQuestion, /用户: PMP 课程是什么/);
  assert.match(followUp.contextualQuestion, /助手: 知识库回答/);
  service.complete(followUp, answer('费用回答'));

  const otherIp = service.begin({
    userIp: '10.0.0.2',
    topicId: TOPIC_ID,
    requestedSessionId: first.sessionId,
    question: '尝试读取别人的会话'
  });
  assert.notEqual(otherIp.sessionId, first.sessionId);
  assert.equal(otherIp.history.length, 0);
  assert.deepEqual(repository.listMessagesForIp('10.0.0.2', first.sessionId), []);
  service.complete(otherIp, answer('独立 IP 的回答'));

  current = new Date('2026-08-25T00:17:00.000Z');
  const expired = service.begin({
    userIp: '10.0.0.1',
    topicId: TOPIC_ID,
    requestedSessionId: first.sessionId,
    question: '超时后的新问题'
  });
  assert.notEqual(expired.sessionId, first.sessionId);
  assert.equal(expired.history.length, 0);
  service.complete(expired, answer('新会话回答'));

  const oldSession = runtime.database.prepare('SELECT status, ended_at FROM chat_session WHERE id = ?').get(first.sessionId);
  assert.equal(oldSession.status, 'ENDED');
  assert.equal(oldSession.ended_at, '2026-08-25T00:17:00.000Z');
  assert.equal(repository.listMessagesForIp('10.0.0.1', first.sessionId).length, 4);

  const totals = runtime.database.prepare(`
    SELECT s.user_ip,
           SUM(CASE WHEN m.role = 'USER' THEN 1 ELSE 0 END) AS questions,
           SUM(CASE WHEN m.role = 'ASSISTANT' THEN 1 ELSE 0 END) AS answers
    FROM chat_session s
    JOIN chat_message m ON m.session_id = s.id
    GROUP BY s.user_ip
    ORDER BY s.user_ip
  `).all().map((row) => ({ ...row }));
  assert.deepEqual(totals, [
    { user_ip: '10.0.0.1', questions: 3, answers: 3 },
    { user_ip: '10.0.0.2', questions: 1, answers: 1 }
  ]);
});
