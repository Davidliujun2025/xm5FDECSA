import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { createAcceptanceTopicBootstrap } from '../../backend/src/acceptance/topic-bootstrap.js';
import { createAcceptanceModelProvider } from '../../backend/src/adapters/models/acceptance-models.js';
import { APP_ROOT, createRuntime, startServer } from '../../backend/src/app.js';
import {
  createAcceptanceEnvironment,
  safeAcceptanceStartupMessage
} from '../../scripts/start-acceptance.js';
import { FORMAT_FIXTURES } from '../helpers/document-fixtures.js';

function closeNetServer(server) {
  if (!server?.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function listenOnEphemeralPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
    server.listen(0, '127.0.0.1');
  });
  return { server, port: server.address().port };
}

async function availablePort() {
  const reservation = await listenOnEphemeralPort();
  await closeNetServer(reservation.server);
  return reservation.port;
}

function acceptanceRuntimeOptions(dataDir, port) {
  const context = { topicId: null, topicName: null, topicStatus: null };
  return {
    appRoot: APP_ROOT,
    env: createAcceptanceEnvironment({
      appRoot: APP_ROOT,
      baseEnv: { ACCEPTANCE_PORT: String(port) },
      dataDir
    }),
    modelProvider: createAcceptanceModelProvider(),
    runtimeBootstrap: createAcceptanceTopicBootstrap({ context })
  };
}

async function waitForJob(api, apiKey, jobId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await api.get(`/api/rag/v1/jobs/${jobId}`)
      .set('X-API-Key', apiKey)
      .expect(200);
    if (response.body.status === 'SUCCEEDED') {
      return response.body;
    }
    if (response.body.status === 'FAILED') {
      assert.fail(JSON.stringify(response.body));
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`job timed out: ${jobId}`);
}

test('normal close releases every runtime resource and permits same port/data restart', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-runtime-close-'));
  const port = await availablePort();
  let first;
  let second;
  t.after(async () => {
    await Promise.allSettled([first?.close(), second?.close()]);
    rmSync(dataDir, { recursive: true, force: true });
  });

  first = await startServer(acceptanceRuntimeOptions(dataDir, port));
  const firstApi = request(`http://127.0.0.1:${port}`);
  await firstApi.get('/health/ready').expect(200);
  assert.equal(existsSync(path.join(dataDir, 'runtime.lock')), true);

  const empty = await firstApi.get('/api/rag/v1/documents')
    .query({ topicId: first.runtime.config.frontendDefaultTopicId })
    .set('X-API-Key', first.runtime.config.apiKey)
    .expect(200);
  assert.deepEqual(empty.body, []);

  const fixture = FORMAT_FIXTURES.find((item) => item.extension === 'txt');
  const uploaded = await firstApi.post('/api/rag/v1/documents')
    .set('X-API-Key', first.runtime.config.apiKey)
    .set('Idempotency-Key', 'runtime-close-upload-001')
    .field('topicId', first.runtime.config.frontendDefaultTopicId)
    .attach('file', fixture.bytes, { filename: 'shutdown.txt', contentType: fixture.mime })
    .expect(202);
  await waitForJob(firstApi, first.runtime.config.apiKey, uploaded.body.jobId);

  const firstClose = first.close();
  const duplicateClose = first.close();
  assert.strictEqual(duplicateClose, firstClose);
  assert.equal(first.runtime.readiness.isReady(), false);
  await firstClose;
  assert.equal(first.server.listening, false);
  assert.equal(existsSync(path.join(dataDir, 'runtime.lock')), false);

  second = await startServer(acceptanceRuntimeOptions(dataDir, port));
  const secondApi = request(`http://127.0.0.1:${port}`);
  await secondApi.get('/health/ready').expect(200);
  const persisted = await secondApi.get('/api/rag/v1/documents')
    .query({ topicId: second.runtime.config.frontendDefaultTopicId })
    .set('X-API-Key', second.runtime.config.apiKey)
    .expect(200);
  assert.equal(persisted.body.length, 1);
  assert.equal(persisted.body[0].status, 'READY');

  await second.close();
  assert.equal(second.server.listening, false);
  assert.equal(existsSync(path.join(dataDir, 'runtime.lock')), false);
});

test('empty runtime closes cleanly and can restart without queued work', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-runtime-empty-'));
  const port = await availablePort();
  let started;
  t.after(async () => {
    await started?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  started = await startServer(acceptanceRuntimeOptions(dataDir, port));
  assert.equal(started.runtime.database.prepare('SELECT COUNT(*) AS count FROM job').get().count, 0);
  await started.close();
  assert.equal(existsSync(path.join(dataDir, 'runtime.lock')), false);

  started = await startServer(acceptanceRuntimeOptions(dataDir, port));
  assert.equal(started.runtime.database.prepare('SELECT COUNT(*) AS count FROM job').get().count, 0);
  await request(`http://127.0.0.1:${port}`).get('/health/ready').expect(200);
});

test('occupied port fails clearly and startup cleanup releases the data lock', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-runtime-port-'));
  const blocker = await listenOnEphemeralPort();
  t.after(async () => {
    await closeNetServer(blocker.server);
    rmSync(dataDir, { recursive: true, force: true });
  });

  let startupError;
  await assert.rejects(
    startServer(acceptanceRuntimeOptions(dataDir, blocker.port)),
    (error) => {
      startupError = error;
      return error.code === 'EADDRINUSE';
    }
  );
  assert.equal(
    safeAcceptanceStartupMessage(startupError),
    'RAG_ACCEPTANCE_PORT_IN_USE: 验收端口已被占用，请停止占用进程或设置 ACCEPTANCE_PORT'
  );
  assert.equal(existsSync(path.join(dataDir, 'runtime.lock')), false);
});

test('active data lock fails clearly, then the same data directory starts after release', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'rag-runtime-lock-'));
  const port = await availablePort();
  const options = acceptanceRuntimeOptions(dataDir, port);
  let holder;
  let started;
  t.after(async () => {
    await Promise.allSettled([holder?.close(), started?.close()]);
    rmSync(dataDir, { recursive: true, force: true });
  });

  holder = await createRuntime(options);
  let startupError;
  await assert.rejects(
    startServer(acceptanceRuntimeOptions(dataDir, port)),
    (error) => {
      startupError = error;
      return error.errorCode === 'RAG_INSTANCE_ALREADY_RUNNING';
    }
  );
  assert.equal(
    safeAcceptanceStartupMessage(startupError),
    'RAG_INSTANCE_ALREADY_RUNNING: 数据目录已由另一个服务实例使用'
  );

  await holder.close();
  holder = null;
  assert.equal(existsSync(path.join(dataDir, 'runtime.lock')), false);
  started = await startServer(acceptanceRuntimeOptions(dataDir, port));
  await request(`http://127.0.0.1:${port}`).get('/health/ready').expect(200);
});
