import net from 'node:net';

import { parseIpv4Cidr, ipv4ToNumber } from '../config.js';
import { AppError } from '../domain/errors.js';

function normalizeRemoteAddress(value = '') {
  if (value === '::1') {
    return '127.0.0.1';
  }
  if (value.startsWith('::ffff:')) {
    return value.slice(7);
  }
  return value;
}

export function createNetworkAccessMiddleware(config) {
  if (config.profile !== 'team') {
    return (request, response, next) => next();
  }

  const ranges = config.teamAllowedCidrs.map(parseIpv4Cidr);
  return (request, response, next) => {
    const address = normalizeRemoteAddress(request.socket.remoteAddress);
    const numeric = net.isIP(address) === 4 ? ipv4ToNumber(address) : null;
    if (numeric !== null && ranges.some((range) => numeric >= range.start && numeric <= range.end)) {
      next();
      return;
    }
    next(new AppError({
      statusCode: 403,
      errorCode: 'RAG_NETWORK_FORBIDDEN',
      message: '请求来源不在团队网络允许范围内'
    }));
  };
}
