import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { createAcceptanceTopicBootstrap } from '../../backend/src/acceptance/topic-bootstrap.js';
import { createAcceptanceModelProvider } from '../../backend/src/adapters/models/acceptance-models.js';
import { APP_ROOT, createRuntime } from '../../backend/src/app.js';
import {
  createAcceptanceEnvironment,
  createAcceptanceRouteRegistrar
} from '../../scripts/start-acceptance.js';

const SAMPLE_PATH = path.resolve(APP_ROOT, 'examples', 'sample-documents', 'acceptance-sample.md');
const ORIGIN = 'http://127.0.0.1:3000';

function browser(api, method, pathName, cookie) {
  return api[method](pathName)
    .set('Host', '127.0.0.1:3000')
    .set('Cookie', cookie)
    .set('Origin', ORIGIN);
}

test('bundled acceptance sample uploads through the browser acceptance flow to READY', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-sample-upload-'));
  const context = { topicId: null, topicName: null, topicStatus: null };
  const env = createAcceptanceEnvironment({ appRoot: APP_ROOT, dataDir });
  env.NODE_ENV = 'test';
  const runtime = await createRuntime({
    appRoot: APP_ROOT,
    env,
    modelProvider: createAcceptanceModelProvider(),
    runtimeBootstrap: createAcceptanceTopicBootstrap({ context }),
    registerRoutes: createAcceptanceRouteRegistrar(context)
  });
  await runtime.initialize();
  t.after(async () => {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const api = request(runtime.app);
  const session = await api.post('/api/rag/v1/auth/browser-session')
    .set('Host', '127.0.0.1:3000')
    .set('Origin', ORIGIN)
    .expect(204);
  const cookie = session.headers['set-cookie'][0].split(';')[0];

  const accepted = await browser(api, 'post', '/api/acceptance/documents', cookie)
    .attach('file', readFileSync(SAMPLE_PATH), { filename: 'acceptance-sample.md', contentType: 'text/markdown' })
    .expect(202);

  const deadline = Date.now() + 10_000;
  let job;
  while (Date.now() < deadline) {
    job = (await browser(api, 'get', `/api/acceptance/jobs/${accepted.body.jobId}`, cookie).expect(200)).body;
    if (job.status === 'SUCCEEDED') {
      break;
    }
    if (job.status === 'FAILED') {
      assert.fail(JSON.stringify(job));
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(job.status, 'SUCCEEDED');

  const document = (await browser(api, 'get', `/api/acceptance/documents/${accepted.body.documentId}`, cookie).expect(200)).body;
  assert.equal(document.status, 'READY');
});
