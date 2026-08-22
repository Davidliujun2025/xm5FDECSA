import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { APP_ROOT, startServer } from '../backend/src/app.js';
import {
  assertRealAcceptanceDataDir,
  buildAcceptanceEvidence,
  createRealAcceptanceEnvironment,
  REAL_ACCEPTANCE_EVIDENCE_FILE,
  recordAcceptanceEvidence
} from '../backend/src/acceptance/real-acceptance.js';

function parseDataDirArg(argv) {
  const index = argv.indexOf('--data-dir');
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('RAG_REAL_ACCEPTANCE_USAGE: --data-dir 需要跟一个目录参数');
  }
  return value;
}

export async function startRealAcceptance({
  appRoot = APP_ROOT,
  baseEnv = process.env,
  dataDir,
  start = startServer
} = {}) {
  const startedAt = new Date().toISOString();
  const { env, config } = createRealAcceptanceEnvironment({ appRoot, baseEnv, dataDir });
  assertRealAcceptanceDataDir({ appRoot, dataDir: config.dataDir });
  const started = await start({ appRoot, env });
  const evidencePath = path.join(config.dataDir, REAL_ACCEPTANCE_EVIDENCE_FILE);
  try {
    await recordAcceptanceEvidence({
      filePath: evidencePath,
      evidence: buildAcceptanceEvidence({
        config,
        status: 'ENVIRONMENT_READY',
        startedAt
      })
    });
  } catch (error) {
    await started.close().catch(() => undefined);
    throw error;
  }
  return { ...started, config, evidencePath, startedAt };
}

export function safeRealAcceptanceStartupMessage(error) {
  if (error?.code === 'EADDRINUSE') {
    return 'RAG_REAL_ACCEPTANCE_PORT_IN_USE: 验收端口已被占用，请停止占用进程或修改 .env 中的 RAG_PORT';
  }
  if (error?.code?.startsWith('RAG_REAL_ACCEPTANCE_')) {
    return `${error.code}: ${error.message}`;
  }
  if (error?.errorCode) {
    return `${error.errorCode}: ${error.message}`;
  }
  return 'RAG_REAL_ACCEPTANCE_STARTUP_FAILED: 真实模型验收环境启动失败，请检查 .env 四件套配置、端口和数据目录权限';
}

function realAcceptanceSummary({ config, evidencePath }) {
  const baseUrl = `http://127.0.0.1:${config.port}`;
  return [
    'REAL MODEL ACCEPTANCE environment ready (TEST_REAL_ACCEPTANCE_MANUAL)',
    `Embedding 模型: ${config.model.embeddingModel}`,
    `Chat 模型: ${config.model.chatModel}`,
    `数据目录: ${config.dataDir}`,
    `健康检查: ${baseUrl}/health/ready`,
    `Swagger: ${baseUrl}/api/rag/v1/docs`,
    `问答页: ${baseUrl}/`,
    `证据记录: ${evidencePath}`
  ].join('\n');
}

async function runFromCommandLine() {
  dotenv.config({ path: path.join(APP_ROOT, '.env') });
  const dataDir = parseDataDirArg(process.argv.slice(2));
  const started = await startRealAcceptance({ appRoot: APP_ROOT, baseEnv: process.env, dataDir });
  process.stdout.write(`${realAcceptanceSummary(started)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFromCommandLine().catch((error) => {
    process.stderr.write(`${safeRealAcceptanceStartupMessage(error)}\n`);
    process.exitCode = 1;
  });
}
