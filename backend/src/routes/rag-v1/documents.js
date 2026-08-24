import express from 'express';

import { AppError } from '../../domain/errors.js';

function serviceFrom(request) {
  const service = request.app.locals.documentService;
  if (!service) {
    throw new AppError({
      statusCode: 503,
      errorCode: 'RAG_NOT_READY',
      message: '服务正在初始化',
      details: { status: 'INITIALIZING' }
    });
  }
  return service;
}

function asyncHandler(action) {
  return (request, response, next) => Promise.resolve(action(request, response)).catch(next);
}

function mapUploadError(error) {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return new AppError({ statusCode: 413, errorCode: 'RAG_FILE_TOO_LARGE', message: '文件超过允许大小' });
  }
  if (error?.code?.startsWith('LIMIT_')) {
    return new AppError({ statusCode: 400, errorCode: 'RAG_INVALID_REQUEST', message: 'multipart 上传格式非法' });
  }
  return error;
}

export function createDocumentRouter({ auth, fileStore }) {
  const router = express.Router();
  const receiveSingleFile = fileStore.singleUploadMiddleware();

  router.post('/', auth.requireApiKey, (request, response, next) => {
    receiveSingleFile(request, response, (uploadError) => {
      if (uploadError) {
        next(mapUploadError(uploadError));
        return;
      }
      Promise.resolve(serviceFrom(request).uploadDocument({
        topicId: request.body?.topicId,
        file: request.file,
        idempotencyKey: request.get('Idempotency-Key')
      })).then((result) => {
        response.setHeader('Idempotency-Replayed', String(result.replayed));
        response.status(result.statusCode).json(result.value);
      }).catch(next);
    });
  });

  router.get('/', auth.requireApiKey, asyncHandler(async (request, response) => {
    response.status(200).json(serviceFrom(request).listDocuments(request.query.topicId));
  }));

  router.post('/:documentId/publish', auth.requireApiKey, asyncHandler(async (request, response) => {
    response.status(200).json(serviceFrom(request).publishDocument(request.params.documentId));
  }));

  router.post('/:documentId/disable', auth.requireApiKey, asyncHandler(async (request, response) => {
    response.status(200).json(serviceFrom(request).disableDocument(request.params.documentId));
  }));

  router.get('/:documentId', auth.requireApiKey, asyncHandler(async (request, response) => {
    response.status(200).json(serviceFrom(request).getDocument(request.params.documentId, { browserSession: false }).response);
  }));

  router.get('/:documentId/file', auth.requireApiKey, asyncHandler(async (request, response) => {
    const file = await serviceFrom(request).openDocumentFile(request.params.documentId, { browserSession: false });
    response.status(200);
    response.setHeader('Content-Type', file.mime);
    response.setHeader('Content-Length', String(file.size));
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    file.stream.once('error', () => {
      if (!response.headersSent) {
        response.status(500).json({
          errorCode: 'RAG_FILE_STORAGE_ERROR',
          message: '原文件读取失败',
          details: {},
          traceId: request.traceId
        });
      } else {
        response.destroy();
      }
    });
    file.stream.pipe(response);
  }));

  return router;
}

export function createJobRouter({ auth }) {
  const router = express.Router();
  router.get('/:jobId', auth.requireApiKey, asyncHandler(async (request, response) => {
    response.status(200).json(serviceFrom(request).getJob(request.params.jobId));
  }));
  return router;
}
