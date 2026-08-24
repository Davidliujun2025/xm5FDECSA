import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import { ParserWorkerClient } from '../../backend/src/workers/parser-worker.client.js';
import { serializeParserFailure } from '../../backend/src/workers/parser-worker.protocol.js';
import { foundationEnv } from '../helpers/foundation.js';

test('large parsing stays in one worker while health remains responsive', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-parser-worker-'));
  const runtime = await createRuntime({
    env: foundationEnv({ DATA_DIR: dataDir }),
    appRoot: APP_ROOT
  });
  const client = new ParserWorkerClient();
  t.after(async () => {
    await client.close();
    runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await runtime.initialize();

  const events = [];
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  client.on('started', (event) => {
    events.push({ type: 'started', ...event });
    markStarted(event);
  });
  client.on('completed', (event) => events.push({ type: 'completed', ...event }));

  const bytes = Buffer.from('worker-visible-content '.repeat(20_000), 'utf8');
  let settled = false;
  const parsing = client.parse({
    documentId: 'doc_large_worker',
    fileName: 'large.txt',
    mime: 'text/plain',
    bytes
  }).finally(() => {
    settled = true;
  });

  const startEvent = await started;
  assert.equal(settled, false);
  assert.ok(startEvent.threadId > 0);
  const startTime = performance.now();
  await request(runtime.app).get('/health/live').expect(200);
  assert.ok(performance.now() - startTime < 1000);

  const result = await parsing;
  assert.ok(result.chunks.length > 1);
  assert.deepEqual(events.map((event) => event.type), ['started', 'completed']);
  assert.equal(events[1].threadId, startEvent.threadId);

  const second = await client.parse({
    documentId: 'doc_second_worker',
    fileName: 'second.txt',
    mime: 'text/plain',
    bytes: Buffer.from('second parse', 'utf8')
  });
  assert.equal(second.blocks[0].text, 'second parse');
  assert.equal(events[2].threadId, startEvent.threadId);
  assert.equal(events[3].threadId, startEvent.threadId);
});

test('worker failure exposes stable fields only and never publishes partial output', async (t) => {
  const client = new ParserWorkerClient();
  t.after(() => client.close());
  const events = [];
  client.on('failed', (event) => events.push(event));

  await assert.rejects(client.parse({
    documentId: 'doc_failed_worker',
    fileName: 'blank.txt',
    mime: 'text/plain',
    bytes: Buffer.from('   ', 'utf8')
  }), (error) => error.errorCode === 'RAG_NO_TEXT_CONTENT');

  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), ['errorCode', 'requestId', 'threadId']);
  assert.equal(events[0].errorCode, 'RAG_NO_TEXT_CONTENT');

  const serialized = serializeParserFailure(new Error('parser stack and path must not leak'));
  assert.deepEqual(Object.keys(serialized).sort(), ['details', 'errorCode', 'message', 'statusCode']);
  assert.equal(JSON.stringify(serialized).includes('stack'), false);
  assert.equal(JSON.stringify(serialized).includes('path must not leak'), false);
});
