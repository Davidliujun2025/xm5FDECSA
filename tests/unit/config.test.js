import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadConfig } from '../../backend/src/config.js';
import { foundationEnv } from '../helpers/foundation.js';

test('local profile is constrained to loopback and resolves portable paths', () => {
  const config = loadConfig(foundationEnv(), { appRoot: 'C:\\portable-app' });
  assert.equal(config.profile, 'local');
  assert.equal(config.host, '127.0.0.1');
  assert.match(config.dataDir, /portable-app[\\/]data$/);
  assert.deepEqual(config.corsOrigins, ['http://localhost:5173']);
  assert.equal(config.model.apiKey, null);
});

test('local profile rejects non-loopback listening', () => {
  assert.throws(
    () => loadConfig(foundationEnv({ RAG_HOST: '0.0.0.0' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID' && !error.message.includes('api_A1')
  );
});

test('configuration rejects missing or weak secrets and excessive session TTL', () => {
  assert.throws(
    () => loadConfig(foundationEnv({ RAG_API_KEY: '' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
  assert.throws(
    () => loadConfig(foundationEnv({ FRONTEND_SESSION_SECRET: 'change-me-change-me-change-me-change-me' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
  assert.throws(
    () => loadConfig(foundationEnv({ FRONTEND_SESSION_TTL_SECONDS: '14401' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
});

test('CORS rejects wildcards and URL paths', () => {
  assert.throws(
    () => loadConfig(foundationEnv({ CORS_ORIGINS: '*' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
  assert.throws(
    () => loadConfig(foundationEnv({ CORS_ORIGINS: 'https://example.test/path' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
});

test('real-model configuration is all-or-none and constrains timeouts and chunk settings', () => {
  assert.throws(
    () => loadConfig(foundationEnv({ MODEL_BASE_URL: 'https://models.example.test/v1' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
  assert.throws(
    () => loadConfig(foundationEnv({
      MODEL_BASE_URL: 'https://models.example.test/v1',
      MODEL_API_KEY: 'model-key',
      EMBEDDING_MODEL: 'embed-v1',
      CHAT_MODEL: 'chat-v1',
      MODEL_CONNECT_TIMEOUT_SECONDS: '10',
      MODEL_TOTAL_TIMEOUT_SECONDS: '5'
    })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
  assert.throws(
    () => loadConfig(foundationEnv({ CHUNK_TARGET_CHARS: '799' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
  assert.throws(
    () => loadConfig(foundationEnv({ RETRIEVAL_CANDIDATES: '11' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
  assert.throws(
    () => loadConfig(foundationEnv({ EVIDENCE_THRESHOLD: '1.1' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
  const config = loadConfig(foundationEnv({
    MODEL_BASE_URL: 'https://models.example.test/v1',
    MODEL_API_KEY: 'model-key',
    EMBEDDING_MODEL: 'embed-v1',
    CHAT_MODEL: 'chat-v1'
  }));
  assert.equal(config.model.embeddingConfigured, true);
  assert.equal(config.model.chatConfigured, true);
  assert.equal(config.maxTotalChunks, 50000);
  assert.equal(config.retrievalCandidates, 10);
  assert.equal(config.answerContextLimit, 5);
  assert.equal(config.evidenceThreshold, 0.45);
  assert.equal(config.relatedEvidenceThreshold, 0.25);
  assert.equal(config.chatSessionTimeoutMs, 15 * 60 * 1000);
  assert.equal(config.chatHistoryMessageLimit, 12);
  assert.deepEqual(config.chunk, { minChars: 800, targetChars: 1000, maxChars: 1200, overlapChars: 150 });
});

test('chat history configuration constrains timeout, history and related threshold', () => {
  assert.throws(
    () => loadConfig(foundationEnv({ CHAT_SESSION_TIMEOUT_MINUTES: '0' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
  assert.throws(
    () => loadConfig(foundationEnv({ CHAT_HISTORY_TURNS: '21' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
  assert.throws(
    () => loadConfig(foundationEnv({ RELATED_EVIDENCE_THRESHOLD: '0.5', EVIDENCE_THRESHOLD: '0.45' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID' && error.details.field === 'RELATED_EVIDENCE_THRESHOLD'
  );
});

test('Chat configuration validates model prerequisites, default Topic and refusal text', () => {
  assert.throws(
    () => loadConfig(foundationEnv({ CHAT_MODEL: 'chat-v1' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
  assert.throws(
    () => loadConfig(foundationEnv({ FRONTEND_DEFAULT_TOPIC_ID: 'topic_invalid' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID'
  );
  assert.throws(
    () => loadConfig(foundationEnv({ FIXED_REFUSAL_TEXT: '   ' })),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID' && error.details.field === 'FIXED_REFUSAL_TEXT'
  );
  const config = loadConfig(foundationEnv({
    FRONTEND_DEFAULT_TOPIC_ID: `topic_${'d'.repeat(32)}`,
    MODEL_BASE_URL: 'https://models.example.test/v1',
    MODEL_API_KEY: 'model-key',
    EMBEDDING_MODEL: 'embed-v1',
    CHAT_MODEL: 'chat-v1'
  }));
  assert.equal(config.model.chatConfigured, true);
  assert.equal(config.model.chatModel, 'chat-v1');
  assert.equal(config.fixedRefusalText, '知识库中未找到可靠依据，暂时无法回答该问题。');
});

test('team profile requires default topic, private binding and allowed CIDRs', () => {
  const base = foundationEnv({
    RUN_PROFILE: 'team',
    RAG_HOST: '0.0.0.0',
    CORS_ORIGINS: 'http://192.168.10.20:5173'
  });
  assert.throws(
    () => loadConfig(base),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID' && error.details.field === 'FRONTEND_DEFAULT_TOPIC_ID'
  );
  assert.throws(
    () => loadConfig({ ...base, RAG_HOST: '', FRONTEND_DEFAULT_TOPIC_ID: `topic_${'a'.repeat(32)}`, TEAM_ALLOWED_CIDRS: '10.0.0.0/8' }),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID' && error.details.field === 'RAG_HOST'
  );
  assert.throws(
    () => loadConfig({ ...base, CORS_ORIGINS: '', FRONTEND_DEFAULT_TOPIC_ID: `topic_${'a'.repeat(32)}`, TEAM_ALLOWED_CIDRS: '10.0.0.0/8' }),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID' && error.details.field === 'CORS_ORIGINS'
  );
  assert.throws(
    () => loadConfig({ ...base, FRONTEND_DEFAULT_TOPIC_ID: `topic_${'a'.repeat(32)}`, TEAM_ALLOWED_CIDRS: '8.8.8.0/24' }),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID' && error.details.field === 'TEAM_ALLOWED_CIDRS'
  );
  assert.throws(
    () => loadConfig({ ...base, FRONTEND_DEFAULT_TOPIC_ID: `topic_${'a'.repeat(32)}`, TEAM_ALLOWED_CIDRS: '192.168.10.1/24' }),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID' && error.details.field === 'TEAM_ALLOWED_CIDRS'
  );
  assert.throws(
    () => loadConfig({ ...base, FRONTEND_DEFAULT_TOPIC_ID: `topic_${'a'.repeat(32)}`, TEAM_ALLOWED_CIDRS: '192.168.0.0/8' }),
    (error) => error.errorCode === 'RAG_CONFIG_INVALID' && error.details.field === 'TEAM_ALLOWED_CIDRS'
  );

  const config = loadConfig({
    ...base,
    FRONTEND_DEFAULT_TOPIC_ID: `topic_${'a'.repeat(32)}`,
    TEAM_ALLOWED_CIDRS: '192.168.10.0/24,10.0.0.0/8'
  });
  assert.equal(config.profile, 'team');
  assert.deepEqual(config.teamAllowedCidrs, ['192.168.10.0/24', '10.0.0.0/8']);
});
