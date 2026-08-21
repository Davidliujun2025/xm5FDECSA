import pino from 'pino';

export function createLogger(config = {}) {
  return pino({
    level: config.nodeEnv === 'test' ? 'silent' : (process.env.LOG_LEVEL || 'info'),
    base: {
      appVersion: config.appVersion || '0.1.0'
    },
    redact: {
      paths: [
        'apiKey',
        'modelApiKey',
        'sessionSecret',
        '*.apiKey',
        '*.modelApiKey',
        '*.sessionSecret',
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'headers.authorization',
        'headers["x-api-key"]'
      ],
      censor: '[REDACTED]'
    }
  });
}
