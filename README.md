# 华夏智诚可移植知识库 API

本仓库使用 Node.js 24、Express、React/Vite 和内置 `node:sqlite`。MVP 运行时是单个 Node/Express 进程；SQLite 与原文件位于可配置的本地 `DATA_DIR`。Docker、PostgreSQL/pgvector、RAGFlow 和独立 Worker 不在启动或验证主路径中。

## 环境要求

- Windows 10/11 x64
- Node.js 24.x 与 npm 11.x
- 服务只允许 local 回环或受控 team 局域网运行，不得公开到互联网

## 首次启动

```powershell
npm ci
Copy-Item .env.example .env
# 在 .env 中填写至少 32 字节的随机 RAG_API_KEY 与 FRONTEND_SESSION_SECRET
.\scripts\start-local.ps1
```

local profile 固定监听 `127.0.0.1:3000`。健康检查为 `/health/live` 和 `/health/ready`；OpenAPI 3.1 与 Swagger UI 分别位于 `/api/rag/v1/openapi.json`、`/api/rag/v1/docs`。

## 标准后端验收

- Swagger：打开 `http://127.0.0.1:3000/api/rag/v1/docs`，用后端 `RAG_API_KEY` 授权后，依次执行 Topic 创建/激活、文档上传、Job 轮询、READY 检查、人工发布、search/chat 与原文件读取。
- PowerShell：先设置仅当前终端可见的 `$env:RAG_API_KEY`，再按 [HANDOFF 标准后端主流程](docs/HANDOFF.md#标准后端主流程) 执行；脚本会验证发布前检索为空、发布后 citation 与原文件可读取。

浏览器不得复制后端 Key；浏览器验收只使用同源 HttpOnly 会话。Swagger 与 PowerShell 的主流程都调用公开 `/api/rag/v1`，不依赖 `/api/acceptance`。

team profile 还必须明确设置 `RAG_HOST`、`CORS_ORIGINS`、`FRONTEND_DEFAULT_TOPIC_ID` 和仅含私有 IPv4 网段的 `TEAM_ALLOWED_CIDRS`，再执行：

```powershell
.\scripts\start-team.ps1
```

启动脚本不会修改 Windows 防火墙。服务主机维护者必须把入站规则限制在专用网络与 `TEAM_ALLOWED_CIDRS`，并确保没有路由器端口转发或公网 tunnel。

## 开发与验证

```powershell
.\scripts\dev.ps1
.\scripts\verify.ps1
```

`data/`、`.env`、SQLite、日志、构建产物和企业资料均不得提交 Git。详细契约见 [docs/API.md](docs/API.md)、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 与 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。
