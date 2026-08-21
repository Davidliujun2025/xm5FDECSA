import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import swaggerUi from 'swagger-ui-express';

import { LocalFileStore } from './adapters/local-files.js';
import { EmbeddingClient } from './adapters/models/embedding-client.js';
import { ChatClient } from './adapters/models/chat-client.js';
import { DocumentRepository } from './adapters/sqlite/document.repository.js';
import { IngestionRepository } from './adapters/sqlite/ingestion.repository.js';
import { RetrievalRepository } from './adapters/sqlite/retrieval.repository.js';
import { openSqliteDatabase } from './adapters/sqlite/database.js';
import { acquireRuntimeLock, ensureDataDirectories } from './adapters/sqlite/runtime-lock.js';
import { TopicRepository } from './adapters/sqlite/topic.repository.js';
import { loadConfig } from './config.js';
import { AppError, errorMiddleware, notFoundMiddleware } from './domain/errors.js';
import { createAuthToolkit, createBrowserSessionRouter } from './routes/rag-v1/auth.js';
import { createCompatibilityChatRouter } from './routes/chat.js';
import { createChatRouter } from './routes/rag-v1/chat.js';
import { createDocumentRouter, createJobRouter } from './routes/rag-v1/documents.js';
import { createOpenApiDocument } from './routes/rag-v1/openapi.js';
import { createSearchRouter } from './routes/rag-v1/search.js';
import { createTopicRouter } from './routes/rag-v1/topics.js';
import { DocumentService } from './services/document.service.js';
import { AnswerService } from './services/answer.service.js';
import { IngestionService } from './services/ingestion.service.js';
import { RetrievalService } from './services/retrieval.service.js';
import { TopicService } from './services/topic.service.js';
import { createLogger } from './utils/logger.js';
import { requestContextMiddleware } from './utils/request-context.js';
import { IngestionJobLoop } from './workers/ingestion-job-loop.js';
import { ParserWorkerClient } from './workers/parser-worker.client.js';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function createCorsMiddleware(config) {
  const corsHandler = cors({
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
  return (request, response, next) => {
    const origin = request.get('Origin');
    const forwardedProto = request.get('X-Forwarded-Proto')?.split(',')[0].trim();
    const sameOrigin = origin && origin === `${forwardedProto || request.protocol}://${request.get('Host')}`;
    if (sameOrigin) {
      next();
      return;
    }
    corsHandler(request, response, next);
  };
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

export function createApp({ config, readiness, fileStore, logger, registerRoutes } = {}) {
  if (!config || !readiness || !fileStore) {
    throw new TypeError('createApp requires config, readiness and fileStore');
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
  app.use('/api/rag/v1/topics', createTopicRouter({ auth }));
  app.use('/api/rag/v1/documents', createDocumentRouter({ auth, fileStore }));
  app.use('/api/rag/v1/jobs', createJobRouter({ auth }));
  app.use('/api/rag/v1/search', createSearchRouter({ auth, config }));
  app.use('/api/rag/v1/chat', createChatRouter({ auth }));
  app.use('/api/chat', createCompatibilityChatRouter({ auth, config }));
  app.get('/api/rag/v1/openapi.json', (request, response) => response.json(openApi));
  app.use('/api/rag/v1/docs', swaggerUi.serve, swaggerUi.setup(openApi, {
    customSiteTitle: '华夏智诚 RAG API'
  }));

  if (registerRoutes) {
    registerRoutes(app, auth);
  }

  if (config.nodeEnv === 'production' && existsSync(config.frontendDistDir)) {
    app.use(express.static(config.frontendDistDir, { index: false }));
    app.get('*', (request, response, next) => {
      if (request.path.startsWith('/api/') || request.path.startsWith('/health/') || !request.accepts('html')) {
        next();
        return;
      }
      response.sendFile(path.join(config.frontendDistDir, 'index.html'));
    });
  }

  app.use(notFoundMiddleware);
  app.use(errorMiddleware(appLogger));
  return app;
}

export async function createRuntime({ env = process.env, appRoot = APP_ROOT, logger, initializationDelayMs = 0, registerRoutes, embeddingFetch, chatFetch } = {}) {
  const config = loadConfig(env, { appRoot });
  const appLogger = logger ?? createLogger(config);
  ensureDataDirectories(config.dataDir);
  const runtimeLock = acquireRuntimeLock(config.dataDir);
  const readiness = createReadinessState();
  let app;
  let fileStore;
  try {
    fileStore = new LocalFileStore(config);
    app = createApp({ config, readiness, fileStore, logger: appLogger, registerRoutes });
  } catch (error) {
    runtimeLock.release();
    throw error;
  }
  let database;
  let ingestionRepository;
  let retrievalRepository;
  let embeddingClient;
  let parserWorker;
  let jobLoop;
  let closePromise;
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
      app.locals.topicService = new TopicService(new TopicRepository(database));
      const documentRepository = new DocumentRepository(database, config);
      if (config.model.embeddingConfigured) {
        ingestionRepository = new IngestionRepository(database, config);
        parserWorker = new ParserWorkerClient();
        embeddingClient = new EmbeddingClient({
          baseUrl: config.model.baseUrl,
          apiKey: config.model.apiKey,
          model: config.model.embeddingModel,
          connectTimeoutMs: config.model.connectTimeoutMs,
          totalTimeoutMs: config.model.totalTimeoutMs,
          fetchImpl: embeddingFetch ?? globalThis.fetch
        });
        const ingestionService = new IngestionService({
          repository: ingestionRepository,
          fileStore,
          parserWorker,
          embeddingClient,
          config,
          logger: appLogger
        });
        jobLoop = new IngestionJobLoop({ repository: ingestionRepository, ingestionService, logger: appLogger });
        retrievalRepository = new RetrievalRepository(database);
        app.locals.retrievalService = new RetrievalService({
          repository: retrievalRepository,
          embeddingClient,
          config
        });
        if (config.model.chatConfigured) {
          const chatClient = new ChatClient({
            baseUrl: config.model.baseUrl,
            apiKey: config.model.apiKey,
            model: config.model.chatModel,
            connectTimeoutMs: config.model.connectTimeoutMs,
            totalTimeoutMs: config.model.totalTimeoutMs,
            fetchImpl: chatFetch ?? globalThis.fetch
          });
          app.locals.answerService = new AnswerService({
            retrievalService: app.locals.retrievalService,
            retrievalRepository,
            chatClient,
            config
          });
        }
      }
      app.locals.documentService = new DocumentService(documentRepository, fileStore, {
        onJobQueued: () => jobLoop?.wake()
      });
      jobLoop?.start();
      readiness.markReady();
      appLogger.info({ operation: 'runtime.initialize', result: 'ready' }, 'runtime ready');
    },
    get ingestionRepository() {
      return ingestionRepository;
    },
    get jobLoop() {
      return jobLoop;
    },
    get retrievalRepository() {
      return retrievalRepository;
    },
    close() {
      if (closed) {
        return closePromise ?? Promise.resolve();
      }
      readiness.markNotReady();
      closed = true;
      const finish = () => {
        try {
          database?.close();
        } finally {
          runtimeLock.release();
        }
      };
      if (!jobLoop) {
        finish();
        closePromise = Promise.resolve();
        return closePromise;
      }
      closePromise = (async () => {
        try {
          await jobLoop.stop();
          await parserWorker?.close();
        } finally {
          finish();
        }
      })();
      return closePromise;
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
    await runtime.close();
    throw error;
  }

  const shutdown = () => {
    runtime.readiness.markNotReady();
    server.close(async () => {
      await runtime.close();
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
