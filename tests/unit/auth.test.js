import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadConfig } from '../../backend/src/config.js';
import { createAuthToolkit } from '../../backend/src/routes/rag-v1/auth.js';
import { foundationEnv } from '../helpers/foundation.js';

test('browser query session is origin-bound, signed and expires', () => {
  let clock = Date.parse('2026-08-21T00:00:00Z');
  const config = loadConfig(foundationEnv({ FRONTEND_SESSION_TTL_SECONDS: '60' }));
  const auth = createAuthToolkit(config, { now: () => clock });
  const token = auth.issueBrowserSession('http://localhost:5173');

  const session = auth.verifyBrowserSession(token, 'http://localhost:5173');
  assert.equal(session.scope, 'query');
  assert.throws(
    () => auth.verifyBrowserSession(token, 'http://localhost:4173'),
    (error) => error.errorCode === 'RAG_UNAUTHORIZED'
  );
  assert.throws(
    () => auth.verifyBrowserSession(`${token}broken`, 'http://localhost:5173'),
    (error) => error.errorCode === 'RAG_UNAUTHORIZED'
  );

  clock += 61_000;
  assert.throws(
    () => auth.verifyBrowserSession(token, 'http://localhost:5173'),
    (error) => error.errorCode === 'RAG_UNAUTHORIZED'
  );
});
