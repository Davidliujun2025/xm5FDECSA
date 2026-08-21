export const API_KEY = 'api_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6';
export const SESSION_SECRET = 'session_Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4';

export function foundationEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    APP_VERSION: '0.1.0-test',
    RUN_PROFILE: 'local',
    RAG_HOST: '127.0.0.1',
    RAG_PORT: '3000',
    RAG_API_KEY: API_KEY,
    FRONTEND_SESSION_SECRET: SESSION_SECRET,
    FRONTEND_SESSION_TTL_SECONDS: '3600',
    CORS_ORIGINS: 'http://localhost:5173',
    DATA_DIR: './data',
    MAX_CONCURRENT_REQUESTS: '3',
    ...overrides
  };
}
