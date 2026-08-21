export function createOpenApiDocument(config) {
  return {
    openapi: '3.1.0',
    info: {
      title: '华夏智诚 FDE 可移植知识库 API',
      version: config.appVersion,
      description: 'Node.js 24、Express 与 SQLite 单进程可移植 API。'
    },
    servers: [{ url: '/' }],
    paths: {
      '/health/live': {
        get: {
          operationId: 'getLiveness',
          responses: { 200: { description: '进程存活' } }
        }
      },
      '/health/ready': {
        get: {
          operationId: 'getReadiness',
          responses: {
            200: { description: '服务已就绪' },
            503: { description: '服务初始化中', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
          }
        }
      },
      '/api/rag/v1/auth/browser-session': {
        post: {
          operationId: 'createBrowserSession',
          description: '为允许的 Origin 设置短期 HttpOnly 查询会话。',
          responses: {
            204: { description: '会话已建立', headers: { 'Set-Cookie': { schema: { type: 'string' } } } },
            403: { description: 'Origin 不允许', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        BackendApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        BrowserSession: { type: 'apiKey', in: 'cookie', name: COOKIE_NAME }
      },
      schemas: {
        Error: {
          type: 'object',
          additionalProperties: false,
          required: ['errorCode', 'message', 'details', 'traceId'],
          properties: {
            errorCode: { type: 'string' },
            message: { type: 'string' },
            details: { type: 'object' },
            traceId: { type: 'string' }
          }
        }
      }
    }
  };
}

const COOKIE_NAME = 'rag_query_session';
