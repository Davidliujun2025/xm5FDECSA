import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';

import { AppError } from '../../domain/errors.js';

const COOKIE_NAME = 'rag_query_session';

function isSameOriginRequest(request, origin) {
  if (!origin) {
    return false;
  }
  const forwardedProto = request.get('X-Forwarded-Proto')?.split(',')[0].trim();
  const protocol = forwardedProto || request.protocol;
  return origin === `${protocol}://${request.get('Host')}`;
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

export function createAuthToolkit(config, { now = () => Date.now() } = {}) {
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

  function requireApiKey(request, response, next) {
    if (!safeEqual(request.get('X-API-Key'), config.apiKey)) {
      next(unauthorized());
      return;
    }
    request.auth = { type: 'api-key', scopes: ['admin', 'query'] };
    next();
  }

  function requireQueryAccess(request, response, next) {
    const suppliedApiKey = request.get('X-API-Key');
    if (suppliedApiKey !== undefined) {
      requireApiKey(request, response, next);
      return;
    }
    try {
      const token = parseCookies(request.get('Cookie'))[COOKIE_NAME];
      const origin = request.get('Origin');
      const session = verifyBrowserSession(token, origin, { sameOrigin: isSameOriginRequest(request, origin) });
      request.auth = { type: 'browser-session', scopes: ['query'], sessionId: session.sid };
      next();
    } catch (error) {
      next(error);
    }
  }

  return { issueBrowserSession, verifyBrowserSession, requireApiKey, requireQueryAccess };
}

export function createBrowserSessionRouter({ config, auth }) {
  const router = express.Router();
  const attempts = new Map();

  router.post('/browser-session', (request, response, next) => {
    const origin = request.get('Origin');
    if (!origin || (!config.corsOrigins.includes(origin) && !isSameOriginRequest(request, origin))) {
      next(new AppError({
        statusCode: 403,
        errorCode: 'RAG_ORIGIN_FORBIDDEN',
        message: '请求来源不在允许列表中'
      }));
      return;
    }

    const key = request.ip;
    const currentMinute = Math.floor(Date.now() / 60000);
    const entry = attempts.get(key);
    if (entry?.minute === currentMinute && entry.count >= 20) {
      next(new AppError({
        statusCode: 429,
        errorCode: 'RAG_BUSY',
        message: '请求过于频繁，请稍后重试'
      }));
      return;
    }
    attempts.set(key, { minute: currentMinute, count: entry?.minute === currentMinute ? entry.count + 1 : 1 });

    const token = auth.issueBrowserSession(origin);
    const secure = request.secure || request.get('X-Forwarded-Proto') === 'https';
    const attributes = [
      `${COOKIE_NAME}=${token}`,
      'Path=/',
      `Max-Age=${config.sessionTtlSeconds}`,
      'HttpOnly',
      'SameSite=Strict'
    ];
    if (secure) {
      attributes.push('Secure');
    }
    response.setHeader('Set-Cookie', attributes.join('; '));
    response.status(204).end();
  });

  return router;
}
