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
      },
      '/api/rag/v1/topics': {
        get: {
          operationId: 'listTopics',
          summary: '查询 Topic',
          security: [{ BackendApiKey: [] }, { BrowserSession: [] }],
          responses: {
            200: {
              description: 'Topic 数组；浏览器会话只返回 ACTIVE Topic',
              content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Topic' } } } }
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            503: { $ref: '#/components/responses/ServiceUnavailable' }
          }
        },
        post: {
          operationId: 'createTopic',
          summary: '创建 DRAFT Topic',
          security: [{ BackendApiKey: [] }],
          parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTopicRequest' } } }
          },
          responses: {
            201: {
              description: 'Topic 已创建或幂等重放',
              headers: { 'Idempotency-Replayed': { schema: { type: 'string', enum: ['true', 'false'] } } },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Topic' } } }
            },
            400: { $ref: '#/components/responses/InvalidRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            409: { $ref: '#/components/responses/Conflict' },
            503: { $ref: '#/components/responses/ServiceUnavailable' }
          }
        }
      },
      '/api/rag/v1/topics/{topicId}': {
        patch: {
          operationId: 'updateTopic',
          summary: '编辑、启用或停用 Topic',
          security: [{ BackendApiKey: [] }],
          parameters: [
            {
              name: 'topicId',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^topic_[0-9a-f]{32}$' }
            },
            { $ref: '#/components/parameters/IdempotencyKey' }
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateTopicRequest' } } }
          },
          responses: {
            200: {
              description: 'Topic 已更新或幂等重放',
              headers: { 'Idempotency-Replayed': { schema: { type: 'string', enum: ['true', 'false'] } } },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Topic' } } }
            },
            400: { $ref: '#/components/responses/InvalidRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: {
              description: 'Topic 不存在',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
            },
            409: { $ref: '#/components/responses/Conflict' },
            503: { $ref: '#/components/responses/ServiceUnavailable' }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        BackendApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        BrowserSession: { type: 'apiKey', in: 'cookie', name: COOKIE_NAME }
      },
      parameters: {
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' }
        }
      },
      responses: {
        InvalidRequest: {
          description: '请求或 Idempotency-Key 非法',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
        },
        Unauthorized: {
          description: '鉴权失败',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
        },
        Conflict: {
          description: '重名、容量、状态或幂等冲突',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
        },
        ServiceUnavailable: {
          description: '初始化中或 SQLite 暂时繁忙',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
        }
      },
      schemas: {
        Topic: {
          type: 'object',
          additionalProperties: false,
          required: ['topicId', 'name', 'description', 'status', 'createdAt', 'updatedAt'],
          properties: {
            topicId: { type: 'string', pattern: '^topic_[0-9a-f]{32}$' },
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 1000 },
            status: { enum: ['DRAFT', 'ACTIVE', 'DISABLED'] },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' }
          }
        },
        CreateTopicRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 1000 }
          }
        },
        UpdateTopicRequest: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 1000 },
            status: { enum: ['DRAFT', 'ACTIVE', 'DISABLED'] }
          }
        },
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
