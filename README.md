# 华夏智诚可移植知识库

本仓库使用 Node.js 24、Express、React/Vite 和内置 `node:sqlite`。MVP 运行时是单个 Node/Express
进程；SQLite 与原文件位于可配置的本地 `DATA_DIR`。Docker、PostgreSQL/pgvector、RAGFlow 和独立
Worker 不在启动或验证主路径中。目标平台为 Windows 10/11 x64。

## 环境要求

- Windows 10/11 x64
- Node.js 24.x 与 npm 11.x
- 服务只允许 local 回环或受控 team 局域网运行，不得公开到互联网
- 同一 `DATA_DIR` 只允许一个运行中的进程

## 路径一：Mock 浏览器验收（同伴从干净克隆开始）

不确定模型配置时先走这条路径。只需要一条命令，无需 Docker、数据库或任何模型 Key：

```powershell
npm ci
npm run acceptance
```

`npm run acceptance` 会自动构建前端、创建或复用隔离目录 `data/acceptance` 中的
「本机 Mock 验收 Topic」并显式激活、注入确定性 Mock 模型（`TEST_ACCEPTANCE_ONLY`，无网络、
无训练知识），然后在 `127.0.0.1:3000` 输出以下入口：

- 问答页：`http://127.0.0.1:3000/`
- 上传页：`http://127.0.0.1:3000/acceptance/upload`（页面明确标注 MOCK / LOCAL ACCEPTANCE）
- 健康检查：`http://127.0.0.1:3000/health/ready`
- Swagger：`http://127.0.0.1:3000/api/rag/v1/docs`

验收流程：上传页选择 PDF/DOCX/XLSX/PPTX/MD/TXT 单文件（≤30MB，不得上传真实企业资料）→
等待 Job 完成进入 READY → 点击「发布到测试知识库」→ 从问答页提问并核对引用与原文。
没有测试文件时可使用仓库自带的脱敏样例 `examples/sample-documents/acceptance-sample.md`。
上传后不会自动发布；Mock 只用于流程验收，不作为 AI 质量结论。端口被占用时设置
`ACCEPTANCE_PORT` 换端口。

## 路径二：开发模式（后端 3000 + Vite 5173）

```powershell
npm ci
Copy-Item .env.example .env
# 在 .env 中填写至少 32 字节的随机 RAG_API_KEY 与 FRONTEND_SESSION_SECRET
.\scripts\dev.ps1
```

后端 `node --watch` 监听 `127.0.0.1:3000`，Vite 前端位于 `http://localhost:5173`
（默认 CORS Origin 已包含）。模型四件套留空即可启动不含 AI 服务的接口模式：
search/chat 不可用，也不会回退到 Mock。

## 路径三：真实模型本机验收（production）

production 启动顺序固定为：`npm ci` → 配置 `.env` → `npm run build` → 启动：

```powershell
npm ci
Copy-Item .env.example .env
# .env 中填写完整四件套（全部为空或全部提供，缺一不可）：
#   MODEL_BASE_URL（无凭据的 http/https 地址）、MODEL_API_KEY、
#   EMBEDDING_MODEL、CHAT_MODEL
# 并指定独立的 DATA_DIR（不要复用 data/acceptance）
npm run build
$env:NODE_ENV = 'production'
.\scripts\start-local.ps1
```

配置规则、数据边界、超时、401/429 与费用风险见
`docs/iterations/mvp-iteration-01/REAL_MODEL_CONFIGURATION.md`。缺失或混填配置会在启动
写入数据前以 `RAG_CONFIG_INVALID` 失败，不会回退到 Mock。

执行固定 10 题人工验收时，建议使用专用入口，它会强制独立数据目录、拒绝复用 Mock 数据，
并自动生成脱敏证据文件：

```powershell
node .\scripts\start-real-acceptance.js --data-dir .\data\real-acceptance
```

随后按 `docs/iterations/mvp-iteration-01/MANUAL_ACCEPTANCE.md` 显式创建/激活 Topic、
上传批准的非敏感资料、人工发布、逐题问答，并运行
`node .\scripts\record-real-acceptance-result.js --data-dir .\data\real-acceptance --results .\manual-results.json`
核验归档。

### 前端问答的 Topic 绑定

前端问答页只对绑定的 Topic 提问：

- Mock 验收由 acceptance bootstrap 自动创建/复用验收 Topic 并绑定，无需手工设置。
- 真实模型与 team 模式必须在 `.env` 中把 `FRONTEND_DEFAULT_TOPIC_ID` 设置为一个已
  `ACTIVE` 的 Topic ID；未设置时问答页没有默认 Topic，需要显式配置后才能从前端提问。

## 路径四：本地 Swagger 与标准后端验收

服务启动后打开 `http://127.0.0.1:3000/api/rag/v1/docs`，使用 `RAG_API_KEY` 授权，
依次执行：创建 Topic（DRAFT）→ 显式激活 → 单文件上传 → 轮询 Job → READY → 人工发布 →
search/chat → 原文读取。写接口使用 `X-API-Key`，创建/修改/上传请求携带 `Idempotency-Key`。

PowerShell 调用方式见 [docs/HANDOFF.md](docs/HANDOFF.md)。浏览器不得复制后端 Key；
浏览器问答只使用同源 HttpOnly 会话。`/api/acceptance` 只在 acceptance 模式注册，
其他模式返回 404，也不会出现在公开 OpenAPI 中。

## 路径五：team 局域网模式

team profile 必须显式配置：`RAG_HOST`（私有 IPv4 或 `0.0.0.0`）、明确的 `CORS_ORIGINS`、
`FRONTEND_DEFAULT_TOPIC_ID` 以及仅含私有 IPv4 网段的 `TEAM_ALLOWED_CIDRS`，然后执行：

```powershell
.\scripts\start-team.ps1
```

启动脚本不会修改 Windows 防火墙。服务主机维护者必须把入站规则限制在专用网络与
`TEAM_ALLOWED_CIDRS`，并确保没有路由器端口转发、公网 IP 或临时公网 tunnel。

## 验证、评测与发布

```powershell
npm run verify        # 全部测试 + 前端 build + 安全扫描 + 禁止跟踪文件检查
npm run eval          # 60 题确定性黄金集
npm run performance   # 性能基线
.\scripts\package-release.ps1   # 生成 artifacts/ 发布 ZIP 与 manifest
```

`data/`、`.env`、SQLite、日志、构建产物、发布包和企业资料均不得提交 Git。详细契约与边界见
[docs/API.md](docs/API.md)、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 与 [docs/HANDOFF.md](docs/HANDOFF.md)。
