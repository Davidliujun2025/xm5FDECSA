import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { API_KEY, foundationEnv } from '../helpers/foundation.js';

test('the frozen 8642444 frontend request shape works without a frontend change', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-frontend-compat-'));
  const topicId = `topic_${'c'.repeat(32)}`;
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env: foundationEnv({ DATA_DIR: dataDir, FRONTEND_DEFAULT_TOPIC_ID: topicId })
  });
  t.after(async () => {
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();

  const received = [];
  runtime.app.locals.answerService = {
    async answer(input) {
      received.push(input);
      return { status: 'ANSWERED', topicId, answer: '知识库核心回答', citations: [] };
    }
  };
  const api = request(runtime.app);

  const first = await api.post('/api/chat')
    .set('Origin', 'http://localhost:5173')
    .send({ message: '前端问题', conversationId: 'legacy-conversation' })
    .expect(200);
  assert.equal(first.body.answer, '知识库核心回答');
  assert.match(first.body.traceId, /^trace_/);
  assert.deepEqual(received[0], { topicId, question: '前端问题' });
  assert.match(first.headers['set-cookie'][0], /rag_query_session=/);
  assert.match(first.headers['set-cookie'][0], /HttpOnly/);

  const cookie = first.headers['set-cookie'][0].split(';')[0];
  await api.post('/api/chat')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', cookie)
    .send({ message: '第二个问题' })
    .expect(200);
  await api.post('/api/chat').send({ message: '无浏览器来源' }).expect(403);
  await api.post('/api/chat')
    .set('X-API-Key', API_KEY)
    .send({ message: '服务端调用' })
    .expect(200);

  await api.post('/api/rag/v1/chat')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', cookie)
    .send({ topicId, question: '浏览器不能直接调用版本化接口' })
    .expect(401);
  await api.post('/api/rag/v1/chat')
    .set('X-API-Key', API_KEY)
    .send({ topicId, question: '后端可以调用版本化接口' })
    .expect(200);
});
