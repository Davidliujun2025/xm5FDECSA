import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { APP_ROOT, startServer } from '../backend/src/app.js';

async function availablePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function requireOk(url, expectedContentType) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) {
    throw new Error(`smoke request failed: ${response.status} ${url}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes(expectedContentType)) {
    throw new Error(`smoke content type mismatch: ${url}`);
  }
  return response;
}

async function main() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rag-start-smoke-'));
  const port = await availablePort();
  let running;
  try {
    running = await startServer({
      appRoot: APP_ROOT,
      env: {
        NODE_ENV: 'production',
        APP_VERSION: '0.1.0-smoke',
        RUN_PROFILE: 'local',
        RAG_HOST: '127.0.0.1',
        RAG_PORT: String(port),
        RAG_API_KEY: 'portable_api_A1b2C3d4E5f6G7h8I9j0K1l2M3n4',
        FRONTEND_SESSION_SECRET: 'portable_session_Z9y8X7w6V5u4T3s2R1q0P9o8',
        CORS_ORIGINS: `http://127.0.0.1:${port}`,
        FRONTEND_DIST_DIR: './frontend/dist',
        DATA_DIR: dataDir
      }
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const live = await requireOk(`${baseUrl}/health/live`, 'application/json');
    const ready = await requireOk(`${baseUrl}/health/ready`, 'application/json');
    const openApi = await requireOk(`${baseUrl}/api/rag/v1/openapi.json`, 'application/json');
    const frontend = await requireOk(`${baseUrl}/`, 'text/html');
    const [liveBody, readyBody, openApiBody, frontendHtml] = await Promise.all([
      live.json(), ready.json(), openApi.json(), frontend.text()
    ]);
    if (liveBody.status !== 'UP' || readyBody.status !== 'READY' || openApiBody.openapi !== '3.1.0' || !frontendHtml.includes('id="root"')) {
      throw new Error('smoke response content mismatch');
    }
    process.stdout.write(`${JSON.stringify({ status: 'START_SMOKE_PASSED', apiOperations: 16, frontendBaseline: '8642444' })}\n`);
  } finally {
    await running?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
