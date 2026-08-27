import net from 'node:net';

export function normalizeClientIp(value = '') {
  const address = String(value).trim();
  if (address === '::1') {
    return '127.0.0.1';
  }
  if (address.startsWith('::ffff:') && net.isIP(address.slice(7)) === 4) {
    return address.slice(7);
  }
  return net.isIP(address) ? address.toLowerCase() : 'unknown';
}

export function clientIpFromRequest(request, { trustLoopbackProxy = false } = {}) {
  const socketIp = normalizeClientIp(request.socket?.remoteAddress);
  if (!trustLoopbackProxy || socketIp !== '127.0.0.1') {
    return socketIp;
  }

  const forwardedIp = request.get?.('X-Real-IP');
  return normalizeClientIp(forwardedIp);
}
