import { randomUUID } from 'node:crypto';
import express from 'express';

import { AppError } from '../domain/errors.js';

const SUPPORTED_FORMATS = Object.freeze(['PDF', 'DOCX', 'XLSX', 'PPTX', 'MD', 'TXT']);

function isLoopback(address = '') {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function expectedOrigin(request) {
  const forwardedProto = request.get('X-Forwarded-Proto')?.split(',')[0].trim();
  return `${forwardedProto || request.protocol}://${request.get('Host')}`;
}

function requireLocalSameOrigin(request, response, next) {
  const origin = request.get('Origin');
  const isReadOnly = request.method === 'GET' || request.method === 'HEAD';
  if (!isLoopback(request.socket.remoteAddress)
    || (origin && origin !== expectedOrigin(request))
    || (!isReadOnly && !origin)) {
    next(new AppError({
      statusCode: 403,
      errorCode: 'RAG_ORIGIN_FORBIDDEN',
      message: '本机验收接口只允许同源浏览器访问'
    }));
    return;
  }
  next();
}

function serviceFrom(request, name) {
  const service = request.app.locals[name];
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

function notFound() {
  return new AppError({
    statusCode: 404,
    errorCode: 'RAG_DOCUMENT_NOT_FOUND',
    message: '文档不存在或不属于当前验收 Topic'
  });
}

function scopedDocument(request, context, documentId) {
  const service = serviceFrom(request, 'documentService');
  const document = service.getDocument(documentId);
  if (document.raw.topicId !== context.topicId) {
    throw notFound();
  }
  return { service, document };
}

function asyncHandler(action) {
  return (request, response, next) => Promise.resolve(action(request, response)).catch(next);
}

function requireAcceptanceContext(context) {
  return (request, response, next) => {
    if (!context.topicId || context.topicStatus !== 'ACTIVE') {
      next(new AppError({
        statusCode: 503,
        errorCode: 'RAG_NOT_READY',
        message: '验收 Topic 尚未准备完成',
        details: { status: 'INITIALIZING' }
      }));
      return;
    }
    next();
  };
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

export function createLocalAcceptanceRouter({ auth, fileStore, context }) {
  if (!auth || !fileStore || !context) {
    throw new TypeError('createLocalAcceptanceRouter requires auth, fileStore and context');
  }

  const router = express.Router();
  const receiveSingleFile = fileStore.singleUploadMiddleware();
  router.use(requireLocalSameOrigin, auth.requireQueryAccess, requireAcceptanceContext(context));

  router.get('/context', (request, response) => {
    response.status(200).json({
      mode: 'LOCAL_UPLOAD_ACCEPTANCE',
      topicId: context.topicId,
      topicName: context.topicName,
      topicStatus: context.topicStatus,
      supportedFormats: SUPPORTED_FORMATS,
      maxFileBytes: fileStore.maxFileBytes
    });
  });

  router.post('/documents', (request, response, next) => {
    receiveSingleFile(request, response, (uploadError) => {
      if (uploadError) {
        next(mapUploadError(uploadError));
        return;
      }
      Promise.resolve(serviceFrom(request, 'documentService').uploadDocument({
        topicId: context.topicId,
        file: request.file,
        idempotencyKey: `acceptance-upload-${randomUUID()}`
      })).then((result) => {
        response.status(result.statusCode).json(result.value);
      }).catch(next);
    });
  });

  router.get('/jobs/:jobId', (request, response, next) => {
    try {
      const service = serviceFrom(request, 'documentService');
      const job = service.getJob(request.params.jobId);
      scopedDocument(request, context, job.documentId);
      response.status(200).json(job);
    } catch (error) {
      next(error);
    }
  });

  router.get('/documents/:documentId', (request, response, next) => {
    try {
      response.status(200).json(scopedDocument(request, context, request.params.documentId).document.response);
    } catch (error) {
      next(error);
    }
  });

  router.post('/documents/:documentId/publish', asyncHandler(async (request, response) => {
    const { service } = scopedDocument(request, context, request.params.documentId);
    response.status(200).json(service.publishDocument(request.params.documentId));
  }));

  router.get('/documents/:documentId/file', asyncHandler(async (request, response) => {
    const { service } = scopedDocument(request, context, request.params.documentId);
    const file = await service.openDocumentFile(request.params.documentId);
    response.status(200);
    response.setHeader('Content-Type', file.mime);
    response.setHeader('Content-Length', String(file.size));
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    file.stream.once('error', () => response.destroy());
    file.stream.pipe(response);
  }));

  return router;
}
