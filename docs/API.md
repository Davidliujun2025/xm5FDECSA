# API 与调用契约

运行时生成的 OpenAPI 3.1 是接口真相源：`GET /api/rag/v1/openapi.json`；Swagger UI 为 `GET /api/rag/v1/docs`。除 `/api/chat` 外，稳定业务接口使用 `/api/rag/v1`。

## 16 个公开端点

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| GET | `/health/live` | 无 | 进程存活 |
| GET | `/health/ready` | 无 | SQLite、migration 与依赖注入就绪 |
| POST | `/api/rag/v1/auth/browser-session` | 允许 Origin／同源 | 建立短期 HttpOnly 查询会话 |
| GET | `/api/rag/v1/topics` | API Key／查询会话 | 查询 Topic；浏览器仅见 ACTIVE |
| POST | `/api/rag/v1/topics` | API Key | 创建 DRAFT Topic |
| PATCH | `/api/rag/v1/topics/{topicId}` | API Key | 编辑、启用或停用 Topic |
| POST | `/api/rag/v1/documents` | API Key | 单文件上传并返回 QUEUED |
| GET | `/api/rag/v1/documents` | API Key | Topic 文档列表 |
| GET | `/api/rag/v1/documents/{documentId}` | API Key／查询会话 | 文档状态详情 |
| POST | `/api/rag/v1/documents/{documentId}/publish` | API Key | READY → PUBLISHED |
| POST | `/api/rag/v1/documents/{documentId}/disable` | API Key | PUBLISHED → DISABLED |
| GET | `/api/rag/v1/documents/{documentId}/file` | API Key／查询会话 | 受控读取原文；浏览器仅可读 PUBLISHED |
| GET | `/api/rag/v1/jobs/{jobId}` | API Key | 查询 QUEUED/PROCESSING/最终状态 |
| POST | `/api/rag/v1/search` | API Key／查询会话 | 显式 Topic 内检索 PUBLISHED 证据 |
| POST | `/api/rag/v1/chat` | API Key／查询会话 | 显式 Topic 严格问答 |
| POST | `/api/chat` | API Key／查询会话 | 绑定服务端默认 Topic 的前端兼容入口 |

创建与编辑操作使用 `Idempotency-Key`；上传只接受一个 `file`。后端长期凭据只放在 `X-API-Key`，浏览器只使用 `rag_query_session` HttpOnly Cookie。

## 验收专用接口（非公开契约）

浏览器上传页 `/acceptance/upload` 与后端前缀 `/api/acceptance` 是 Mock 验收适配层，只在
`npm run acceptance` 的 acceptance profile 注册：不写入公开 OpenAPI、不是稳定契约、在 local、
team 或普通 production 模式一律 404。它复用与 `/api/rag/v1` 相同的 Topic/Document/Job 状态机
（`UPLOADED`/`PROCESSING`/`READY`/`PUBLISHED`/`FAILED`），写请求要求 loopback、同源 Origin
与有效 HttpOnly 会话，Topic 严格隔离，且不提供任何自动发布。公开契约验收仍以本页 16 个
端点为唯一标准。

## 问答状态

- `ANSWERED`：`answer` 中每个 claim 都带 `[n]`，`citations[n-1]` 提供 document、位置和原文摘要。
- `NO_RELIABLE_EVIDENCE`：固定回答“知识库中未找到可靠依据，暂时无法回答该问题。”，citations 为空。
- `BLOCKED`：输入触发安全阻断，citations 为空，且不调用 Chat 模型。

模型输出 JSON、citation、本次候选、Topic、PUBLISHED 状态或当前 embedding 模型任一复核失败时，整题拒答；不返回流式或部分内容。

## 错误与超时

错误结构固定为 `{errorCode, message, details, traceId}`。OpenAPI 的 `Error.errorCode.enum` 列出稳定错误码，包括鉴权、请求、Topic、文档、格式、容量、任务、模型、并发和内部错误。供应商正文、栈、内部路径和密钥不进入响应。

调用方超时建议：管理查询 5 秒，上传与 search 10 秒，chat 30 秒。只对网络错误、429 和明确的 503 做有限重试；写请求必须复用原 `Idempotency-Key`。加载、空状态、错误处理及 Swagger/PowerShell 主流程见 [HANDOFF.md](HANDOFF.md)。
