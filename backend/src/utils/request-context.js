import { randomUUID } from 'node:crypto';

const TRACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

export function requestContextMiddleware(logger) {
  return (request, response, next) => {
    const requestedTraceId = request.get('X-Trace-Id');
    request.traceId = TRACE_ID_PATTERN.test(requestedTraceId || '') ? requestedTraceId : `trace_${randomUUID()}`;
    response.setHeader('X-Trace-Id', request.traceId);
    const startedAt = performance.now();
    response.once('finish', () => {
      logger.info({
        operation: 'http.request',
        traceId: request.traceId,
        method: request.method,
        route: request.route?.path || request.path,
        statusCode: response.statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100
      }, 'request complete');
    });
    next();
  };
}
