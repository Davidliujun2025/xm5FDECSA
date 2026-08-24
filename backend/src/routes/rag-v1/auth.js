import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';

import { AppError } from '../../domain/errors.js';

const COOKIE_NAME = 'rag_query_session';
const SESSION_ATTEMPTS_PER_MINUTE = 20;
const MAX_RATE_LIMIT_KEYS = 4096;

function isSameOriginRequest(request, origin) {
  return Boolean(origin) && origin === `${request.protocol}://${request.get('Host')}`;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left || '', 'utf8');
  const rightBuffer = Buffer.from(right || '', 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((entry) => {
    const separator = entry.indexOf('=');
    if (separator < 0) {
      return [entry.trim(), ''];
    }
    return [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()];
  }).filter(([name]) => name));
}

function sign(encodedPayload, secret) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function unauthorized(message = '鉴权失败') {
  return new AppError({
    statusCode: 401,
    errorCode: 'RAG_UNAUTHORIZED',
    message
  });
}

function forbiddenOrigin() {
  return new AppError({
    statusCode: 403,
    errorCode: 'RAG_ORIGIN_FORBIDDEN',
    message: '请求来源不在允许列表中'
  });
}

export function createAuthToolkit(config, { now = () => Date.now() } = {}) {
  const attempts = new Map();

  function issueBrowserSession(origin) {
    const issuedAt = Math.floor(now() / 1000);
    const payload = Buffer.from(JSON.stringify({
      v: 1,
      sid: randomUUID(),
      scope: 'query',
      origin,
      iat: issuedAt,
      exp: issuedAt + config.sessionTtlSeconds
    })).toString('base64url');
    return `${payload}.${sign(payload, config.sessionSecret)}`;
  }

  function verifyBrowserSession(token, origin, { sameOrigin = false } = {}) {
    const [payload, signature, extra] = (token || '').split('.');
    if (!payload || !signature || extra || !safeEqual(signature, sign(payload, config.sessionSecret))) {
      throw unauthorized('浏览器查询会话无效或已过期');
    }
    let session;
    try {
      session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw unauthorized('浏览器查询会话无效或已过期');
    }
    const currentTime = Math.floor(now() / 1000);
    if (session.v !== 1 || session.scope !== 'query' || !session.exp || session.exp <= currentTime || session.iat > currentTime + 30) {
      throw unauthorized('浏览器查询会话无效或已过期');
    }
    if (origin && (session.origin !== origin || (!sameOrigin && !config.corsOrigins.includes(origin)))) {
      throw unauthorized('浏览器查询会话无效或已过期');
    }
    return session;
  }

  function assertAllowedOrigin(request) {
    const origin = request.get('Origin');
    if (!origin || (!config.corsOrigins.includes(origin) && !isSameOriginRequest(request, origin))) {
      throw forbiddenOrigin();
    }
    return origin;
  }

  function consumeSessionAttempt(request) {
    const currentMinute = Math.floor(now() / 60000);
    for (const [key, entry] of attempts) {
      if (entry.minute !== currentMinute) {
        attempts.delete(key);
      }
    }

    const key = request.socket.remoteAddress || 'unknown';
    const entry = attempts.get(key);
    if (entry?.minute === currentMinute && entry.count >= SESSION_ATTEMPTS_PER_MINUTE) {
      throw new AppError({
        statusCode: 429,
        errorCode: 'RAG_BUSY',
        message: '请求过于频繁，请稍后重试'
      });
    }
    if (!entry && attempts.size >= MAX_RATE_LIMIT_KEYS) {
      throw new AppError({
        statusCode: 429,
        errorCode: 'RAG_BUSY',
        message: '请求过于频繁，请稍后重试'
      });
    }
    attempts.set(key, { minute: currentMinute, count: entry?.minute === currentMinute ? entry.count + 1 : 1 });
  }

  function establishBrowserSession(request, response) {
    const origin = assertAllowedOrigin(request);
    consumeSessionAttempt(request);
    const token = issueBrowserSession(origin);
    const session = verifyBrowserSession(token, origin, { sameOrigin: isSameOriginRequest(request, origin) });
    const attributes = [
      `${COOKIE_NAME}=${token}`,
      'Path=/',
      `Max-Age=${config.sessionTtlSeconds}`,
      'HttpOnly',
      'SameSite=Strict'
    ];
    if (request.secure) {
      attributes.push('Secure');
    }
    response.setHeader('Set-Cookie', attributes.join('; '));
    request.auth = { type: 'browser-session', scopes: ['query'], sessionId: session.sid };
    return session;
  }

  function requireApiKey(request, response, next) {
    if (!safeEqual(request.get('X-API-Key'), config.apiKey)) {
      next(unauthorized());
      return;
    }
    request.auth = { type: 'api-key', scopes: ['admin', 'query'] };
    next();
  }

  function authenticateBrowserSession(request) {
    const token = parseCookies(request.get('Cookie'))[COOKIE_NAME];
    const origin = request.get('Origin');
    const session = verifyBrowserSession(token, origin, { sameOrigin: isSameOriginRequest(request, origin) });
    request.auth = { type: 'browser-session', scopes: ['query'], sessionId: session.sid };
  }

  function requireQueryAccess(request, response, next) {
    const suppliedApiKey = request.get('X-API-Key');
    if (suppliedApiKey !== undefined) {
      requireApiKey(request, response, next);
      return;
    }
    try {
      authenticateBrowserSession(request);
      next();
    } catch (error) {
      next(error);
    }
  }

  function requireFrontendQueryAccess(request, response, next) {
    if (request.get('X-API-Key') !== undefined) {
      requireApiKey(request, response, next);
      return;
    }
    try {
      const token = parseCookies(request.get('Cookie'))[COOKIE_NAME];
      if (token) {
        authenticateBrowserSession(request);
      } else {
        establishBrowserSession(request, response);
      }
      next();
    } catch (error) {
      next(error);
    }
  }

  return {
    issueBrowserSession,
    verifyBrowserSession,
    establishBrowserSession,
    requireApiKey,
    requireQueryAccess,
    requireFrontendQueryAccess
  };
}

export function createBrowserSessionRouter({ auth }) {
  const router = express.Router();
  router.post('/browser-session', (request, response, next) => {
    try {
      auth.establishBrowserSession(request, response);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  return router;
}
