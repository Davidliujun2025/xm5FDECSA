export class AppError extends Error {
  constructor({ statusCode = 500, errorCode = 'RAG_INTERNAL_ERROR', message = '服务暂时不可用', details = {}, cause } = {}) {
    super(message, { cause });
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}

function publicError(error) {
  if (error instanceof AppError) {
    return error;
  }
  if (error?.type === 'entity.parse.failed') {
    return new AppError({
      statusCode: 400,
      errorCode: 'RAG_INVALID_REQUEST',
      message: '请求 JSON 格式非法'
    });
  }
  if (error?.type === 'entity.too.large') {
    return new AppError({
      statusCode: 413,
      errorCode: 'RAG_REQUEST_TOO_LARGE',
      message: '请求体超过允许大小'
    });
  }
  return new AppError();
}

export function notFoundMiddleware(request, response, next) {
  next(new AppError({
    statusCode: 404,
    errorCode: 'RAG_ROUTE_NOT_FOUND',
    message: '请求的接口不存在'
  }));
}

export function errorMiddleware(logger) {
  return (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    const safe = publicError(error);
    logger?.[safe.statusCode >= 500 ? 'error' : 'warn']({
      operation: 'http.error',
      traceId: request.traceId,
      errorCode: safe.errorCode,
      statusCode: safe.statusCode
    }, safe.message);
    response.status(safe.statusCode).json({
      errorCode: safe.errorCode,
      message: safe.message,
      details: safe.details,
      traceId: request.traceId
    });
  };
}
