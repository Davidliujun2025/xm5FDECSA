# 华夏智诚知识库核心

这是从 Git 基线 `8642444` 隔离出的知识库后端交付分支。`frontend/` 被视为冻结资产：页面效果和前端代码均不修改，现有页面继续通过 `POST /api/chat` 调用后端。

核心能力包括：

- Topic 创建、启用、停用和幂等写入
- PDF、DOCX、XLSX、PPTX、Markdown、TXT 上传与安全解析
- SQLite 持久化、原文件保存、后台串行索引和故障恢复
- Embedding 检索、证据阈值、严格引用校验和失败关闭式问答
- OpenAPI 3.1 JSON、稳定错误码、健康检查、备份与恢复
- API Key 管理边界、短期浏览器查询会话和团队 CIDR 限制

## 环境要求

- Node.js 24.x
- npm 11.x
- OpenAI 兼容的 Embedding 与 Chat 接口；四项模型配置必须同时提供

## 安装与本地启动

```powershell
npm ci
Copy-Item .env.example .env
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
```

将两次生成的不同随机值分别写入 `.env` 的 `RAG_API_KEY` 和 `FRONTEND_SESSION_SECRET`。完整的文档索引、检索和问答还必须填写：

```dotenv
MODEL_BASE_URL=https://your-model-provider.example/v1
MODEL_API_KEY=<model-api-key>
EMBEDDING_MODEL=<embedding-model-id>
CHAT_MODEL=<chat-model-id>
```

启动后端：

```powershell
npm start
```

服务默认监听 `http://127.0.0.1:3000`。未配置模型时进程仍可启动并提供健康检查、Topic 和文档管理接口，但索引、检索和问答返回明确的模型不可用状态，不会降级为 Mock 答案。

若要同时查看冻结前端：

```powershell
.\scripts\dev.ps1
```

生产模式先执行 `npm run build`，后端会从 `frontend/dist` 提供冻结页面。前端兼容入口需要把一个已启用 Topic 的 ID 配置为 `FRONTEND_DEFAULT_TOPIC_ID`。

## API 与验收

- OpenAPI JSON：`GET /api/rag/v1/openapi.json`
- 后端接口：`/api/rag/v1/*`，使用 `X-API-Key`
- 冻结前端入口：`POST /api/chat`，首次允许的同源请求自动取得 HttpOnly 会话
- 完整命令示例：[examples/curl.md](examples/curl.md)

一键验收：

```powershell
npm run verify
```

该命令执行语法检查、后端与前端测试、前端构建、安全扫描，并确认 `frontend/` 相对 `8642444` 零差异。

更多说明见 [docs/API.md](docs/API.md)、[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 和 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
