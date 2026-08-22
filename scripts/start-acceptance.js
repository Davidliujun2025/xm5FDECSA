import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACCEPTANCE_TOPIC_ID,
  createAcceptanceTopicBootstrap
} from '../backend/src/acceptance/topic-bootstrap.js';
import { APP_ROOT, startServer } from '../backend/src/app.js';
import { createAcceptanceModelProvider } from '../backend/src/adapters/models/acceptance-models.js';
import { createLocalAcceptanceRouter } from '../backend/src/routes/local-acceptance.js';

const DEFAULT_PORT = 3000;
const ACCEPTANCE_DATA_PATH = path.join('data', 'acceptance');

function startupError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function acceptancePort(baseEnv) {
  const raw = baseEnv.ACCEPTANCE_PORT || String(DEFAULT_PORT);
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
    throw startupError('RAG_ACCEPTANCE_CONFIG_INVALID', 'ACCEPTANCE_PORT 必须是 1 到 65535 的整数');
  }
  return Number(raw);
}

export function createAcceptanceEnvironment({
  appRoot = APP_ROOT,
  baseEnv = process.env,
  randomBytesImpl = randomBytes,
  dataDir = path.resolve(appRoot, ACCEPTANCE_DATA_PATH)
} = {}) {
  const port = acceptancePort(baseEnv);
  const apiSecret = randomBytesImpl(32).toString('base64url');
  const sessionSecret = randomBytesImpl(32).toString('base64url');
  return {
    ...baseEnv,
    NODE_ENV: 'production',
    RUN_PROFILE: 'local',
    RAG_HOST: '127.0.0.1',
    RAG_PORT: String(port),
    RAG_API_KEY: `acceptance_api_${apiSecret}`,
    FRONTEND_SESSION_SECRET: `acceptance_session_${sessionSecret}`,
    FRONTEND_DEFAULT_TOPIC_ID: ACCEPTANCE_TOPIC_ID,
    FRONTEND_DIST_DIR: './frontend/dist',
    CORS_ORIGINS: `http://127.0.0.1:${port}`,
    DATA_DIR: path.resolve(dataDir),
    MODEL_BASE_URL: '',
    MODEL_API_KEY: '',
    EMBEDDING_MODEL: '',
    CHAT_MODEL: ''
  };
}

export function runFrontendBuild(appRoot = APP_ROOT) {
  const npmCli = process.env.npm_execpath;
  const npmExecutable = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npmArguments = npmCli ? [npmCli, 'run', 'build'] : ['run', 'build'];
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(npmExecutable, npmArguments, {
        cwd: appRoot,
        env: process.env,
        stdio: 'inherit',
        windowsHide: true
      });
    } catch (error) {
      reject(startupError(
        error.code === 'ENOENT' ? 'RAG_ACCEPTANCE_DEPENDENCY_MISSING' : 'RAG_ACCEPTANCE_BUILD_FAILED',
        error.code === 'ENOENT' ? '未找到 npm，请安装 Node.js 24.x 与 npm 11.x' : '无法启动前端构建',
        error
      ));
      return;
    }
    child.once('error', (error) => {
      reject(startupError(
        error.code === 'ENOENT' ? 'RAG_ACCEPTANCE_DEPENDENCY_MISSING' : 'RAG_ACCEPTANCE_BUILD_FAILED',
        error.code === 'ENOENT' ? '未找到 npm，请安装 Node.js 24.x 与 npm 11.x' : '无法启动前端构建',
        error
      ));
    });
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(startupError(
        'RAG_ACCEPTANCE_BUILD_FAILED',
        signal ? `前端构建被信号 ${signal} 中止` : `前端构建失败，退出码 ${code}`
      ));
    });
  });
}

export function createAcceptanceRouteRegistrar(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new TypeError('acceptance route context must be an object');
  }
  return (app, auth, fileStore) => {
    app.use('/api/acceptance', createLocalAcceptanceRouter({ auth, fileStore, context }));
  };
}

export async function startAcceptance({
  appRoot = APP_ROOT,
  baseEnv = process.env,
  build = runFrontendBuild,
  start = startServer,
  runtimeOptions = {}
} = {}) {
  await build(appRoot);
  const env = createAcceptanceEnvironment({ appRoot, baseEnv });
  const acceptanceContext = { topicId: null, topicName: null, topicStatus: null };
  return start({
    ...runtimeOptions,
    appRoot,
    env,
    modelProvider: createAcceptanceModelProvider(),
    runtimeBootstrap: createAcceptanceTopicBootstrap({ context: acceptanceContext }),
    registerRoutes: createAcceptanceRouteRegistrar(acceptanceContext)
  });
}

export function safeAcceptanceStartupMessage(error) {
  if (error?.code === 'EADDRINUSE') {
    return 'RAG_ACCEPTANCE_PORT_IN_USE: 验收端口已被占用，请停止占用进程或设置 ACCEPTANCE_PORT';
  }
  if (error?.code?.startsWith('RAG_ACCEPTANCE_')) {
    return `${error.code}: ${error.message}`;
  }
  if (error?.errorCode) {
    return `${error.errorCode}: ${error.message}`;
  }
  return 'RAG_ACCEPTANCE_STARTUP_FAILED: 本机验收服务启动失败，请检查依赖、端口和 data/acceptance 目录权限';
}

function acceptanceUrls(port) {
  const baseUrl = `http://127.0.0.1:${port}`;
  return [
    'LOCAL ACCEPTANCE bootstrap ready',
    `问答页: ${baseUrl}/`,
    `健康检查: ${baseUrl}/health/ready`,
    `Swagger: ${baseUrl}/api/rag/v1/docs`,
    `上传页: ${baseUrl}/acceptance/upload`
  ];
}

async function runFromCommandLine() {
  const { runtime } = await startAcceptance();
  process.stdout.write(`${acceptanceUrls(runtime.config.port).join('\n')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFromCommandLine().catch((error) => {
    process.stderr.write(`${safeAcceptanceStartupMessage(error)}\n`);
    process.exitCode = 1;
  });
}
