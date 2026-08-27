# API 契约

完整机器可读契约由 `GET /api/rag/v1/openapi.json` 提供。服务不包含 Swagger UI 或其他新增前端页面。

## 鉴权边界

- `/health/live`、`/health/ready` 和 OpenAPI JSON 无需鉴权。
- `/api/rag/v1/*` 的业务接口必须携带 `X-API-Key`。
- `POST /api/rag/v1/auth/browser-session` 仅为允许的 Origin 签发短期 HttpOnly 查询 Cookie。
- 页面使用 `POST /api/chat`。首次同源请求可自动签发 Cookie；该 Cookie 不能访问 Topic、文档、检索或版本化 Chat 接口。
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
| POST | `/api/chat` | IP 会话与结构化 FAQ 前端入口 |

写入 Topic 和上传文档时必须提供 `Idempotency-Key`。支持的文件格式为 PDF、DOCX、XLSX、PPTX、MD 和 TXT，单文件上限默认 30 MB。

## Chat 请求与响应

版本化请求：

```json
{
  "topicId": "topic_00000000000000000000000000000000",
  "question": "请根据知识库给出答案"
}
```

前端请求；`conversationId` 和候选选择的 `selectedFaqId` 均可选。服务端只会复用“实际 socket IP + 默认 Topic”一致且 15 分钟内活跃的会话，不能用它读取其他 IP 的历史：

```json
{
  "message": "请根据知识库给出答案",
  "conversationId": "optional-existing-value",
  "selectedFaqId": "faq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

`/api/chat` 响应还包含 `conversationId`、`intent`、`branch`、`needTransferHuman`、`contextUsed`、`responseType` 和 `intentProvider`。`intentProvider=DEEPSEEK` 表示本轮使用 DeepSeek 完成上下文问题改写与业务相关性识别；API 异常时为 `LOCAL`。多条 FAQ 同时命中时，`responseType=CANDIDATES` 且返回 `candidates`；前端把用户选择的 `faqId` 作为 `selectedFaqId` 再次提交。业务分支为：`9-1` 无效或无关问题、`9-2` 命中知识库、`9-3` 与知识库相关但没有可靠结果。所有错误响应统一包含 `errorCode`、`message`、`details` 和 `traceId`。

FAQ 保存在 `DATA_DIR/knowledge.db` 的 `faq_entry` 表；会话历史保存在 `chat_session` 与 `chat_message` 表。每个成功问答轮次都会分别保存一条 `USER` 问题和一条 `ASSISTANT` 回答，候选列表也会保存在助手消息的 `metadata` 中。15 分钟超时只结束会话，不删除旧消息。意图识别只使用最近一个完整问答轮次，数据库始终保留全部历史。服务不信任 `X-Forwarded-For`；若部署在反向代理后，需要确保后端能看到真实客户端 socket IP，否则同一代理出口会被视为同一访客。
