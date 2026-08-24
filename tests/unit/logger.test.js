import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLogger } from '../../backend/src/utils/logger.js';

test('structured logs retain operational fields and redact every configured secret field', () => {
  const lines = [];
  const logger = createLogger({ nodeEnv: 'production', appVersion: 'test-version' }, {
    write(line) {
      lines.push(JSON.parse(line));
    }
  });
  logger.info({
    operation: 'acceptance.logging',
    traceId: 'trace_logging_test',
    statusCode: 200,
    apiKey: 'api-secret-value',
    modelApiKey: 'model-secret-value',
    sessionSecret: 'session-secret-value',
    headers: { authorization: 'Bearer model-secret-value', 'x-api-key': 'api-secret-value' }
  }, 'structured acceptance event');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].operation, 'acceptance.logging');
  assert.equal(lines[0].traceId, 'trace_logging_test');
  assert.equal(lines[0].statusCode, 200);
  assert.equal(lines[0].appVersion, 'test-version');
  assert.equal(JSON.stringify(lines[0]).includes('api-secret-value'), false);
  assert.equal(JSON.stringify(lines[0]).includes('model-secret-value'), false);
  assert.equal(JSON.stringify(lines[0]).includes('session-secret-value'), false);
  assert.equal(lines[0].apiKey, '[REDACTED]');
});
