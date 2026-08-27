import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clientIpFromRequest } from '../../backend/src/utils/client-ip.js';

function request({ remoteAddress, realIp }) {
  return {
    socket: { remoteAddress },
    get(name) {
      return name === 'X-Real-IP' ? realIp : undefined;
    }
  };
}

test('uses X-Real-IP only from an explicitly trusted loopback proxy', () => {
  assert.equal(clientIpFromRequest(request({
    remoteAddress: '127.0.0.1',
    realIp: '203.0.113.8',
    trustLoopbackProxy: true
  }), { trustLoopbackProxy: true }), '203.0.113.8');

  assert.equal(clientIpFromRequest(request({
    remoteAddress: '198.51.100.4',
    realIp: '203.0.113.8',
    trustLoopbackProxy: true
  }), { trustLoopbackProxy: true }), '198.51.100.4');

  assert.equal(clientIpFromRequest(request({
    remoteAddress: '127.0.0.1',
    realIp: '203.0.113.8',
    trustLoopbackProxy: false
  }), { trustLoopbackProxy: false }), '127.0.0.1');
});

test('rejects an invalid X-Real-IP value instead of trusting a chain', () => {
  assert.equal(clientIpFromRequest(request({
    remoteAddress: '::1',
    realIp: '203.0.113.8, 198.51.100.4',
    trustLoopbackProxy: true
  }), { trustLoopbackProxy: true }), 'unknown');
});
