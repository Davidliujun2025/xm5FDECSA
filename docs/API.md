# API 契约

完整机器可读契约由 `GET /api/rag/v1/openapi.json` 提供。服务不包含 Swagger UI 或其他新增前端页面。

## 鉴权边界

- `/health/live`、`/health/ready` 和 OpenAPI JSON 无需鉴权。
- `/api/rag/v1/*` 的业务接口必须携带 `X-API-Key`。
- `POST /api/rag/v1/auth/browser-session` 仅为允许的 Origin 签发短期 HttpOnly 查询 Cookie。
- 冻结页面使用 `POST /api/chat`。首次同源请求可自动签发 Cookie；该 Cookie 不能访问 Topic、文档、检索或版本化 Chat 接口。
- `RUN_PROFILE=team` 时，所有请求还必须来自 `TEAM_ALLOWED_CIDRS`，服务不信任客户端提供的转发地址头。

## 接口列表

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/health/live` | 进程存活 |
| GET | `/health/ready` | 数据库与后台服务就绪 |
| GET/POST | `/api/rag/v1/topics` | 查询或创建 Topic |
| PATCH | `/api/rag/v1/topics/{topicId}` | 编辑、启用或停用 Topic |
| GET/POST | `/api/rag/v1/documents` | 按 Topic 查询或上传文档 |
| GET | `/api/rag/v1/documents/{documentId}` | 查询文档与任务状态 |
| GET | `/api/rag/v1/documents/{documentId}/file` | 读取受控原文件 |
| POST | `/api/rag/v1/documents/{documentId}/publish` | 发布 READY 文档 |
| POST | `/api/rag/v1/documents/{documentId}/disable` | 停用 PUBLISHED 文档 |
| GET | `/api/rag/v1/jobs/{jobId}` | 查询索引任务 |
| POST | `/api/rag/v1/search` | 在 ACTIVE Topic 的已发布文档中检索 |
| POST | `/api/rag/v1/chat` | 基于证据进行严格问答 |
| POST | `/api/chat` | 冻结前端兼容入口 |

写入 Topic 和上传文档时必须提供 `Idempotency-Key`。支持的文件格式为 PDF、DOCX、XLSX、PPTX、MD 和 TXT，单文件上限默认 30 MB。

## Chat 请求与响应

版本化请求：

```json
{
  "topicId": "topic_00000000000000000000000000000000",
  "question": "请根据知识库给出答案"
}
```

冻结前端请求；`conversationId` 可选并由兼容层忽略：

```json
{
  "message": "请根据知识库给出答案",
  "conversationId": "optional-existing-value"
}
```

成功响应具有 `ANSWERED`、`NO_RELIABLE_EVIDENCE` 或 `BLOCKED` 三种状态，并始终带 `topicId`、`answer`、`citations` 和 `traceId`。所有错误响应统一包含 `errorCode`、`message`、`details` 和 `traceId`。
