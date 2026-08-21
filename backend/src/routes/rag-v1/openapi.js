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
      },
      '/api/rag/v1/documents': {
        post: {
          operationId: 'uploadDocument',
          summary: '上传单个文档并创建 QUEUED 任务',
          security: [{ BackendApiKey: [] }],
          parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['topicId', 'file'],
                  properties: {
                    topicId: { type: 'string', pattern: '^topic_[0-9a-f]{32}$' },
                    file: { type: 'string', format: 'binary' }
                  }
                }
              }
            }
          },
          responses: {
            202: {
              description: '原文件已安全保存，文档为 UPLOADED，任务为 QUEUED',
              headers: { 'Idempotency-Replayed': { schema: { type: 'string', enum: ['true', 'false'] } } },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/UploadDocumentResponse' } } }
            },
            400: { $ref: '#/components/responses/InvalidRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            409: { $ref: '#/components/responses/Conflict' },
            413: { $ref: '#/components/responses/PayloadTooLarge' },
            422: { $ref: '#/components/responses/UnprocessableFile' },
            503: { $ref: '#/components/responses/ServiceUnavailable' }
          }
        },
        get: {
          operationId: 'listDocuments',
          summary: '按 Topic 查询文档',
          security: [{ BackendApiKey: [] }],
          parameters: [{
            name: 'topicId',
            in: 'query',
            required: true,
            schema: { type: 'string', pattern: '^topic_[0-9a-f]{32}$' }
          }],
          responses: {
            200: {
              description: '文档数组',
              content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Document' } } } }
            },
            400: { $ref: '#/components/responses/InvalidRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { $ref: '#/components/responses/NotFound' },
            503: { $ref: '#/components/responses/ServiceUnavailable' }
          }
        }
      },
      '/api/rag/v1/documents/{documentId}': {
        get: {
          operationId: 'getDocument',
          summary: '查询文档与任务状态',
          security: [{ BackendApiKey: [] }, { BrowserSession: [] }],
          parameters: [{ $ref: '#/components/parameters/DocumentId' }],
          responses: {
            200: { description: '文档详情', content: { 'application/json': { schema: { $ref: '#/components/schemas/Document' } } } },
            400: { $ref: '#/components/responses/InvalidRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { $ref: '#/components/responses/NotFound' },
            503: { $ref: '#/components/responses/ServiceUnavailable' }
          }
        }
      },
      '/api/rag/v1/documents/{documentId}/file': {
        get: {
          operationId: 'getDocumentFile',
          summary: '受控读取原文件',
          description: '浏览器查询会话不得读取尚未发布的文档。',
          security: [{ BackendApiKey: [] }, { BrowserSession: [] }],
          parameters: [{ $ref: '#/components/parameters/DocumentId' }],
          responses: {
            200: { description: '原文件二进制流', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
            400: { $ref: '#/components/responses/InvalidRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { $ref: '#/components/responses/NotFound' },
            503: { $ref: '#/components/responses/ServiceUnavailable' }
          }
        }
      },
      '/api/rag/v1/jobs/{jobId}': {
        get: {
          operationId: 'getJob',
          summary: '查询文档任务',
          security: [{ BackendApiKey: [] }],
          parameters: [{ $ref: '#/components/parameters/JobId' }],
          responses: {
            200: { description: '任务详情', content: { 'application/json': { schema: { $ref: '#/components/schemas/Job' } } } },
            400: { $ref: '#/components/responses/InvalidRequest' },
            401: { $ref: '#/components/responses/Unauthorized' },
            404: { $ref: '#/components/responses/NotFound' },
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
        },
        DocumentId: {
          name: 'documentId',
          in: 'path',
          required: true,
          schema: { type: 'string', pattern: '^doc_[0-9a-f]{32}$' }
        },
        JobId: {
          name: 'jobId',
          in: 'path',
          required: true,
          schema: { type: 'string', pattern: '^job_[0-9a-f]{32}$' }
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
        },
        NotFound: {
          description: '资源不存在或不可访问',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
        },
        PayloadTooLarge: {
          description: '单文件超过配置上限（最高 30MB）',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
        },
        UnprocessableFile: {
          description: '格式、MIME、文件头、编码或内容非法',
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
        UploadDocumentResponse: {
          type: 'object',
          additionalProperties: false,
          required: ['documentId', 'jobId', 'status', 'jobStatus'],
          properties: {
            documentId: { type: 'string', pattern: '^doc_[0-9a-f]{32}$' },
            jobId: { type: 'string', pattern: '^job_[0-9a-f]{32}$' },
            status: { const: 'UPLOADED' },
            jobStatus: { const: 'QUEUED' }
          }
        },
        Document: {
          type: 'object',
          additionalProperties: false,
          required: ['documentId', 'topicId', 'fileName', 'mime', 'sizeBytes', 'sha256', 'status', 'jobId', 'createdAt', 'updatedAt'],
          properties: {
            documentId: { type: 'string', pattern: '^doc_[0-9a-f]{32}$' },
            topicId: { type: 'string', pattern: '^topic_[0-9a-f]{32}$' },
            fileName: { type: 'string', minLength: 1, maxLength: 255 },
            mime: { type: 'string' },
            sizeBytes: { type: 'integer', minimum: 1 },
            sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
            status: { enum: ['UPLOADED', 'PROCESSING', 'READY', 'PUBLISHED', 'DISABLED', 'FAILED'] },
            jobId: { oneOf: [{ type: 'string', pattern: '^job_[0-9a-f]{32}$' }, { type: 'null' }] },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' }
          }
        },
        Job: {
          type: 'object',
          additionalProperties: false,
          required: ['jobId', 'documentId', 'type', 'status', 'stage', 'attemptCount', 'errorCode', 'errorMessage', 'createdAt', 'startedAt', 'finishedAt'],
          properties: {
            jobId: { type: 'string', pattern: '^job_[0-9a-f]{32}$' },
            documentId: { type: 'string', pattern: '^doc_[0-9a-f]{32}$' },
            type: { const: 'INGEST_DOCUMENT' },
            status: { enum: ['QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED'] },
            stage: { type: 'string' },
            attemptCount: { type: 'integer', minimum: 0 },
            errorCode: { type: ['string', 'null'] },
            errorMessage: { type: ['string', 'null'] },
            createdAt: { type: 'string' },
            startedAt: { type: ['string', 'null'] },
            finishedAt: { type: ['string', 'null'] }
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
