import { ParsingError } from '../domain/ingestion.js';

export const PARSER_MESSAGE = Object.freeze({
  REQUEST: 'parser.request',
  STARTED: 'parser.started',
  COMPLETED: 'parser.completed',
  FAILED: 'parser.failed'
});

export function createParserRequest(requestId, payload, options = {}) {
  return {
    type: PARSER_MESSAGE.REQUEST,
    requestId,
    payload,
    options
  };
}

export function serializeParserFailure(error) {
  const safe = error instanceof ParsingError
    ? error
    : new ParsingError();
  return {
    statusCode: safe.statusCode,
    errorCode: safe.errorCode,
    message: safe.message,
    details: safe.details
  };
}

export function restoreParserFailure(failure = {}) {
  return new ParsingError({
    statusCode: failure.statusCode,
    errorCode: failure.errorCode,
    message: failure.message,
    details: failure.details
  });
}
