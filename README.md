# 华夏智诚知识库核心

这是华夏智诚知识库问答服务。前端通过 `POST /api/chat` 调用按 IP 隔离的 FAQ 会话，支持单条命中直接回答、多条命中候选选择、9-1 冷兜底和 9-3 转人工。

核心能力包括：

- Topic 创建、启用、停用和幂等写入
- PDF、DOCX、XLSX、PPTX、Markdown、TXT 上传与安全解析
- SQLite 持久化、原文件保存、后台串行索引和故障恢复
- 按客户端实际 IP 隔离的 15 分钟聊天会话与完整消息历史
- PMP、ACP、PBA、FDE 共 120 条结构化 FAQ，启动时同步到 SQLite
- 最近一轮问答上下文、FAQ 候选问题选择和所有前端可见问答落库
- 可选 DeepSeek 意图识别；模型不可用时自动回退本地识别，不影响标准 FAQ 答案
- Embedding 检索、证据阈值、严格引用校验和失败关闭式问答
- OpenAPI 3.1 JSON、稳定错误码、健康检查、备份与恢复
- API Key 管理边界、短期浏览器查询会话和团队 CIDR 限制

## 环境要求

- Node.js 24.x
- npm 11.x
- FAQ 问答无需外部模型；文档检索能力需要 OpenAI 兼容的 Embedding 与 Chat 接口

## 安装与本地启动

```powershell
npm ci
Copy-Item .env.example .env
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
```

将两次生成的不同随机值分别写入 `.env` 的 `RAG_API_KEY` 和 `FRONTEND_SESSION_SECRET`。FAQ 问答可直接启动；若还要启用上传文档的索引和模型问答，再填写：

```dotenv
MODEL_BASE_URL=https://your-model-provider.example/v1
MODEL_API_KEY=<model-api-key>
EMBEDDING_MODEL=<embedding-model-id>
CHAT_MODEL=<chat-model-id>
```

如需使用 DeepSeek 识别 FAQ 意图，独立配置（不需要填写 `EMBEDDING_MODEL`）：

```dotenv
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=<deepseek-api-key>
DEEPSEEK_CHAT_MODEL=deepseek-v4-flash
```

启动后端：

```powershell
npm start
```

服务默认监听 `http://127.0.0.1:3000`。未配置模型时，内置 FAQ 问答仍可正常使用；文档索引、检索和版本化模型问答会返回明确的模型不可用状态。

若要同时查看前端：

```powershell
.\scripts\dev.ps1
```

执行过 `npm run build` 后，开发和生产环境的后端都会从 `frontend/dist` 提供页面。local profile 未配置 `FRONTEND_DEFAULT_TOPIC_ID` 时会使用内置 FAQ Topic；team profile 仍要求显式设置该值。

## API 与验收

- OpenAPI JSON：`GET /api/rag/v1/openapi.json`
- 后端接口：`/api/rag/v1/*`，使用 `X-API-Key`
- 前端入口：`POST /api/chat`，首次允许的同源请求自动取得 HttpOnly 会话；聊天上下文按实际 socket IP 隔离并持久化
- 完整命令示例：[examples/curl.md](examples/curl.md)

一键验收：

```powershell
npm run verify
```

该命令执行语法检查、后端与前端测试、前端构建、启动冒烟测试和安全扫描。

更多说明见 [docs/API.md](docs/API.md)、[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 和 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
