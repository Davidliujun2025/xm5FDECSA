import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import swaggerUi from 'swagger-ui-express';

import { openSqliteDatabase } from './adapters/sqlite/database.js';
import { acquireRuntimeLock, ensureDataDirectories } from './adapters/sqlite/runtime-lock.js';
import { loadConfig } from './config.js';
import { AppError, errorMiddleware, notFoundMiddleware } from './domain/errors.js';
import { createAuthToolkit, createBrowserSessionRouter } from './routes/rag-v1/auth.js';
import { createOpenApiDocument } from './routes/rag-v1/openapi.js';
import { createLogger } from './utils/logger.js';
import { requestContextMiddleware } from './utils/request-context.js';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function createCorsMiddleware(config) {
  return cors({
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-API-Key', 'X-Trace-Id'],
    exposedHeaders: ['X-Trace-Id'],
    origin(origin, callback) {
      if (!origin) {
        callback(null, false);
        return;
      }

      if (config.corsOrigins.includes(origin)) {
        callback(null, origin);
        return;
      }

      callback(new AppError({
        statusCode: 403,
        errorCode: 'RAG_ORIGIN_FORBIDDEN',
        message: '请求来源不在允许列表中'
      }));
    }
  });
}

export function createReadinessState() {
  let ready = false;
  return {
    isReady: () => ready,
    markReady: () => {
      ready = true;
    },
    markNotReady: () => {
      ready = false;
    }
  };
}

export function createApp({ config, readiness, logger, registerRoutes } = {}) {
  if (!config || !readiness) {
    throw new TypeError('createApp requires config and readiness');
  }

  const app = express();
  const appLogger = logger ?? createLogger(config);
  const auth = createAuthToolkit(config);
  const openApi = createOpenApiDocument(config);

  app.disable('x-powered-by');
  app.use(requestContextMiddleware(appLogger));
  app.use(createCorsMiddleware(config));
  app.use(express.json({ limit: '64kb', strict: true }));

  app.get('/health/live', (request, response) => {
    response.status(200).json({ status: 'UP', traceId: request.traceId });
  });

  app.get('/health/ready', (request, response, next) => {
    if (!readiness.isReady()) {
      next(new AppError({
        statusCode: 503,
        errorCode: 'RAG_NOT_READY',
        message: '服务正在初始化',
        details: { status: 'INITIALIZING' }
      }));
      return;
    }

    response.status(200).json({ status: 'READY', traceId: request.traceId });
  });

  app.use('/api/rag/v1/auth', createBrowserSessionRouter({ config, auth }));
  app.get('/api/rag/v1/openapi.json', (request, response) => response.json(openApi));
  app.use('/api/rag/v1/docs', swaggerUi.serve, swaggerUi.setup(openApi, {
    customSiteTitle: '华夏智诚 RAG API'
  }));

  if (registerRoutes) {
    registerRoutes(app, auth);
  }

  app.use(notFoundMiddleware);
  app.use(errorMiddleware(appLogger));
  return app;
}

export async function createRuntime({ env = process.env, appRoot = APP_ROOT, logger, initializationDelayMs = 0, registerRoutes } = {}) {
  const config = loadConfig(env, { appRoot });
  const appLogger = logger ?? createLogger(config);
  ensureDataDirectories(config.dataDir);
  const runtimeLock = acquireRuntimeLock(config.dataDir);
  const readiness = createReadinessState();
  let app;
  try {
    app = createApp({ config, readiness, logger: appLogger, registerRoutes });
  } catch (error) {
    runtimeLock.release();
    throw error;
  }
  let database;
  let closed = false;

  return {
    app,
    config,
    readiness,
    get database() {
      return database;
    },
    async initialize() {
      if (database) {
        return;
      }
      if (initializationDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, initializationDelayMs));
      }
      database = openSqliteDatabase(config);
      readiness.markReady();
      appLogger.info({ operation: 'runtime.initialize', result: 'ready' }, 'runtime ready');
    },
    close() {
      if (closed) {
        return;
      }
      readiness.markNotReady();
      try {
        database?.close();
      } finally {
        runtimeLock.release();
        closed = true;
      }
    }
  };
}

export async function startServer(options = {}) {
  const runtime = await createRuntime(options);
  const server = runtime.app.listen(runtime.config.port, runtime.config.host);

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    await runtime.initialize();
  } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    runtime.close();
    throw error;
  }

  const shutdown = () => {
    runtime.readiness.markNotReady();
    server.close(() => {
      runtime.close();
      process.exitCode = 0;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return { runtime, server };
}

async function runFromCommandLine() {
  dotenv.config({ path: path.join(APP_ROOT, '.env') });
  const { runtime } = await startServer();
  createLogger(runtime.config).info({
    operation: 'server.listen',
    profile: runtime.config.profile,
    host: runtime.config.host,
    port: runtime.config.port
  }, 'server listening');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFromCommandLine().catch((error) => {
    const safeError = error instanceof AppError ? `${error.errorCode}: ${error.message}` : 'RAG_STARTUP_FAILED: 服务启动失败';
    process.stderr.write(`${safeError}\n`);
    process.exitCode = 1;
  });
}
