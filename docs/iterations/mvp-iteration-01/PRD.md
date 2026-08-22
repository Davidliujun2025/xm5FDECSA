# 华夏智诚可移植知识库 — MVP Iteration 01 PRD

| 字段 | 内容 |
|---|---|
| 迭代名称 | GitHub 协作交付与端到端验收 |
| 文档状态 | Draft for implementation |
| 版本 | 1.0 |
| 日期 | 2026-08-22 |
| 产品负责人 | 华夏智诚项目负责人 |
| 代码仓库 | Davidliujun2025/xm5FDECSA，沿用当前可见性，本轮不调整 visibility |
| 交付分支 | codex/acceptance-handoff |
| 目标平台 | Windows 10/11 x64，Node.js 24.x，npm 11.x |
| 关联文档 | README.md、docs/API.md、docs/ARCHITECTURE.md、docs/DEPLOYMENT.md、docs/HANDOFF.md |

本 PRD 是本轮 MVP 迭代的唯一需求基线。若实现、测试、文档或验收规则与本 PRD 冲突，以本 PRD 为准并在合并前同步更新相关文档。

## 1. Executive Summary

### Problem Statement

当前应用的 Topic、文档上传、解析、发布、检索和带引用问答主链路已实现并通过本机自动化验证，但尚未形成可供团队直接拉取和重复验收的交付形态：应用位于嵌套 Git 仓库中，工作区存在大量未提交变更；浏览器上传页未由正式启动路径挂载；README、模型配置、默认 Topic 初始化和 GitHub Actions 仍不能支持同伴从干净克隆完成全流程。

### Proposed Solution

在一次迭代内完成现有 GitHub 过渡仓库的协作交付、受限的浏览器上传验收模式、确定性 Mock 模型、本机一键引导、真实模型人工验收、Windows CI、交接文档和分支保护。Mock 仅服务于本地与 CI 的可重复工程验收；真实模型用于最终人工问答验收。Topic 激活与文档发布继续保持显式人工门禁。

### Success Criteria

- **KPI-01 可安装性**：有仓库权限的同伴从干净克隆到 Mock 验收页面可用不超过 15 分钟，除 Node.js 24.x 与 npm 11.x 外不要求 Docker、RAGFlow 或独立数据库。
- **KPI-02 浏览器端到端**：在 Mock 验收模式下，至少 1 份支持格式文档完成“选择文件 → 上传受理 → 解析建索引 → READY → 人工发布 → PUBLISHED → 前端问答 → 引用原文”全链路。
- **KPI-03 自动化质量**：Windows GitHub Actions 使用 Node.js 24 执行 npm ci 与 npm run verify，测试、前端构建、安全扫描和禁止跟踪文件检查全部通过。
- **KPI-04 AI 质量**：60 题确定性黄金集继续满足 Recall@5 ≥ 80%、citation 正确率 ≥ 95%、有依据回答率 ≥ 85%、无依据拒答率 ≥ 95%、安全阻断率 ≥ 95%。
- **KPI-05 真实模型验收**：最终人工题集中的有依据问题均返回可核验引用，无依据问题全部拒答，攻击问题全部阻断或安全拒答；不得出现伪造、跨 Topic 或未发布文档引用。
- **KPI-06 交付安全**：Git 跟踪文件中不存在 .env、模型/API 密钥、SQLite、data、日志、真实企业文档或构建产物。
- **KPI-07 协作交付**：通过 codex/acceptance-handoff 分支和 Draft PR 交付；CI 与代码审查通过后可合并 main，第二台 Windows 不是本轮合并门禁。

## 2. User Experience & Functionality

### User Personas

- **维护者**：整理仓库、配置 CI、控制分支、准备发布候选并处理验收缺陷。
- **同伴验收人员**：从 GitHub 拉取代码，在本机使用 Mock 完成上传、发布、问答和引用核对，不接触长期 API Key。
- **业务验收人员**：使用批准的真实模型和已批准测试资料，验证回答质量、拒答、安全阻断和引用可追溯性。
- **后端调用方**：使用 X-API-Key、Swagger 或脚本执行 Topic、上传、任务轮询、发布、检索与问答接口验收。

### User Stories

#### US-01 从过渡仓库完成本机启动

As a 同伴验收人员, I want to clone the collaboration repository and run one documented acceptance command so that I can start testing without reconstructing hidden local steps.

Acceptance Criteria:

- 应用仓库是当前包含 package.json、backend、frontend 的内层独立仓库，不把外层规划仓库、业务输出目录或嵌套 .git 作为交付内容。
- 仓库提供锁定依赖的 package-lock.json、空值 .env.example、明确的 Node/npm 版本和可复制命令。
- npm run acceptance 或等价单一入口完成前端构建、Mock 验收环境校验、验收 Topic 创建或复用和回环地址启动。
- 启动失败时返回明确、可操作且不含密钥的错误；端口占用、缺少依赖、数据目录锁和损坏配置均不得静默失败。
- 验收入口只监听 127.0.0.1，不得自动修改 Windows 防火墙或开放公网访问。

#### US-02 通过浏览器上传验收文档

As a 同伴验收人员, I want to upload a supported document from /acceptance/upload so that I can validate the ingestion lifecycle without placing a long-lived API key in the browser.

Acceptance Criteria:

- 页面展示明确的 MOCK / LOCAL ACCEPTANCE 标识、验收 Topic、支持格式、30MB 上限和“不得上传真实企业资料”提示。
- 支持 PDF、DOCX、XLSX、PPTX、MD、TXT；拒绝空文件、超限文件、旧版 DOC/XLS/PPT、图片、ZIP、MIME/文件头不匹配和损坏文件。
- 页面展示五阶段状态：选择文件、上传受理、解析建索引、等待发布、完成发布。
- 浏览器只使用 HttpOnly 查询会话，不发送或持久化 RAG_API_KEY、MODEL_API_KEY 或会话签名密钥。
- 上传后异步轮询 Job；成功时文档必须停留在 READY，失败时展示稳定 errorCode、可读消息和 traceId。
- 同一 Topic 内相同 SHA-256 文件重复上传必须返回冲突，不能生成重复 chunk。

#### US-03 人工发布并完成前端问答

As a 同伴验收人员, I want to explicitly publish a READY document and ask a question so that I can verify that only approved content is searchable.

Acceptance Criteria:

- 浏览器必须由用户点击“发布到测试知识库”才能执行 READY → PUBLISHED，不得自动发布。
- 发布操作只能影响当前验收 Topic，不能读取、发布或下载其他 Topic 的文档。
- 发布成功后可从页面进入问答页；问答默认绑定同一验收 Topic。
- 有可靠证据时展示回答、citation 编号、文件名、工作表/单元格、页码、段落、幻灯片或行号位置、excerpt 和原文链接。
- 无可靠证据时返回固定拒答；安全攻击输入返回 BLOCKED 或安全拒答；前端不得生成本地兜底答案。
- 原文下载内容与上传原件 SHA-256 一致，中文文件名正确。

#### US-04 通过后端接口验收上传

As a 后端调用方, I want to use Swagger or PowerShell to exercise the canonical API so that browser acceptance does not replace the supported backend contract.

Acceptance Criteria:

- Swagger UI 位于 /api/rag/v1/docs，OpenAPI 位于 /api/rag/v1/openapi.json。
- 标准流程保持为：创建 DRAFT Topic → 显式激活 → 单文件上传 → 轮询 Job → READY → 显式发布 → search/chat → citation/file。
- 管理写接口使用 X-API-Key；需要幂等的创建、修改和上传请求使用 Idempotency-Key。
- 浏览器验收专用 /api/acceptance 不得写入公开 OpenAPI，也不得在 local、team 或普通 production 模式意外启用。

#### US-05 使用真实模型完成人工验收

As a 业务验收人员, I want to run a documented real-model acceptance flow so that the final sign-off covers semantic quality rather than only deterministic mocks.

Acceptance Criteria:

- 真实模型地址、API Key、Embedding 模型 ID 和 Chat 模型 ID 只存在于本机 .env 或批准的 CI Secret，不进入 Git、日志、截图或验收报告。
- 真实模型验收使用独立 DATA_DIR 和经批准的非敏感测试资料。
- 最终人工题集固定为 10 题：6 个有依据问题、2 个无依据问题、2 个提示注入或越权问题。
- 6 个有依据问题的事实性主张必须由当前候选 citation 支撑；2 个无依据问题必须拒答；2 个攻击问题必须阻断或安全拒答。
- 验收报告记录模型 ID、应用版本、测试时间、状态、citation documentId 和结论，不记录密钥或企业正文。

#### US-06 通过 GitHub 安全协作

As a 维护者, I want to deliver changes through a protected feature branch and Draft PR so that collaborators can review and test without destabilizing main.

Acceptance Criteria:

- 仓库是本轮过渡性协作载体，沿用当前 Public/Private 可见性；本轮不得修改 visibility，也不得把可见性作为合并门禁。
- 通过项目负责人账号和现有仓库权限完成分支推送、同伴拉取和 PR 审查。
- 本轮使用 codex/acceptance-handoff，不得从外层仓库推送，也不得在未审查状态下直接推送 main。
- 禁止使用未经检查的 git add . 或 git add -A；删除、重命名和新增文件必须逐项确认。
- Draft PR 必须包含范围、启动步骤、Mock 验收结果、真实模型验收结果或待办、风险、回滚方式和禁止提交文件检查结果。
- 合并门禁为 Windows CI、代码审查、Mock 端到端、文档和安全扫描；第二台 Windows 或干净 VM 验收不作为本轮合并条件。

### Non-Goals

- 不实现自动创建或自动批准业务 Topic；验收 Topic 仅由受限引导脚本创建或复用。
- 不实现文档自动发布、批量发布或绕过 READY → PUBLISHED 门禁。
- 不支持 DOC、XLS、PPT、HTML、ZIP、图片、音视频、OCR 或扫描 PDF 识别。
- 不实现公网部署、生产 SLA、高可用、多进程共享 SQLite、网络共享数据目录或多租户权限系统。
- 不把 Mock 模型作为质量结论、生产降级方案或真实业务回答来源。
- 不在本轮实现自动分类 Topic、历史会话、多轮记忆、模型训练或业务内容治理平台。
- 不要求第二台 Windows 主机作为合并门禁；跨主机验证保留为后续增强。
- 不调整 GitHub 仓库可见性，也不在本轮完成长期仓库迁移或治理。

## 3. AI System Requirements

### Tool Requirements

- **Mock Embedding/Chat**：确定性、无网络、无训练知识补全，只允许由 acceptance 启动入口注入；不得通过普通生产环境变量开启。
- **Real Embedding/Chat**：OpenAI-compatible HTTP API；必须同时配置 MODEL_BASE_URL、MODEL_API_KEY、EMBEDDING_MODEL，Chat 还需 CHAT_MODEL。
- **Parser Worker**：单个 worker thread 解析 PDF、DOCX、XLSX、PPTX、MD、TXT，并保留可验证位置。
- **SQLite**：保存 Topic、Document、Job、Chunk、Embedding 和幂等记录；同一 DATA_DIR 仅允许一个活动进程。
- **Browser Session**：同源 HttpOnly 短期会话；浏览器不得获得长期 API Key。
- **Evaluation Tools**：60 题黄金集、六格式矩阵、性能基线、安全扫描、发布包和备份恢复测试。

### Model Mode Requirements

| 模式 | 模型 | 数据目录 | 网络 | 用途 | 是否可签署 AI 质量 |
|---|---|---|---|---|---|
| acceptance | 确定性 Mock | ./data/acceptance 或临时目录 | 禁止外部模型调用 | 本地/CI 工程验收 | 否 |
| local | 真实模型 | 操作者指定 | 仅批准模型地址 | 最终人工验收 | 是 |
| team | 真实模型 | 服务主机本地目录 | 仅批准模型地址和私网客户端 | 后续受控团队使用 | 不属于本轮合并门禁 |

- Mock 与真实模型的向量空间、模型 ID 和数据目录不得混用。
- Mock 页面、日志和报告必须清晰标注 TEST_ACCEPTANCE_ONLY 或等价状态。
- 普通 local/team 运行时不得回退到 Mock；真实模型缺失或失败时必须返回明确错误。

### Grounding and Safety Requirements

- 检索只允许读取 ACTIVE Topic 中当前 Embedding 模型下的 PUBLISHED 文档。
- 模型只能使用本次检索候选回答，不得调用工具、联网或用训练知识补全企业事实。
- Chat 输出必须经过 JSON Schema、citation 集合、Topic、文档发布状态和当前向量模型复核。
- 任一事实性 claim 无合法 citation、引用跨 Topic、文档已停用或 citation 伪造时，整题拒答。
- Prompt injection、索要系统提示、越权访问、要求忽略证据边界等输入必须阻断或安全拒答。

### Evaluation Strategy

#### Automated Mock Evaluation

- 运行 npm run verify，覆盖语法、全部测试、前端构建、安全扫描和禁止跟踪文件检查。
- 运行固定 60 题黄金集，门槛采用 KPI-04。
- 六种格式每种至少包含 3 个成功样例，以及空内容、损坏和边界失败样例。
- 验证 Mock 浏览器流程：上传、Job、READY、人工发布、PUBLISHED、问答、citation、原文。
- 验证 Mock 入口在非 acceptance 模式为 404，且远程地址、错误 Origin、无 Cookie 和跨 Topic 请求全部失败。

#### Manual Real-Model Evaluation

- 使用固定 10 题人工题集和已批准测试资料。
- 记录每题状态、回答是否被证据支持、citation 是否可打开、原文位置是否正确。
- 全部 10 题满足 US-05 才可标记真实模型验收通过。
- 模型供应商、数据处理协议和费用控制由项目负责人批准；PR 中不得附带密钥或完整业务文本。

## 4. Technical Specifications

### Architecture Overview

    Browser /acceptance/upload
      -> same-origin HttpOnly session
      -> /api/acceptance，acceptance profile only
      -> existing Topic / Document / Job services
      -> parser worker
      -> Mock Embedding
      -> SQLite + local original files
      -> manual publish
      -> frontend / + /api/chat
      -> retrieval + Mock Chat + verified citations

    Backend acceptance
      -> Swagger / PowerShell
      -> /api/rag/v1
      -> X-API-Key + Idempotency-Key
      -> same production services and storage

浏览器验收路由只能作为现有生产服务的受限适配层，不得复制 Topic、上传、Job、发布、检索或文件读取领域逻辑。

### Integration Points

- **前端与后端**：同源生产页面通过 HttpOnly 会话调用 /api/chat；acceptance 页面调用受限 /api/acceptance。
- **后端与模型**：Embedding/Chat 客户端调用批准的 OpenAI-compatible API；acceptance 启动入口改为注入确定性 Mock。
- **后端与存储**：服务通过 repository 访问 SQLite，通过 LocalFileStore 保存和读取原文件。
- **解析与索引**：Document Job 调用单 parser worker，成功后事务写入 chunks 与 embeddings。
- **GitHub**：功能分支通过 Draft PR 接入 main；Windows Actions 是 required check，真实模型凭据不进入 CI。
- **运维与交接**：README、DEPLOYMENT、HANDOFF、Swagger 和验收报告共同提供启动、上传、问答、恢复和证据流程。

### Repository and Branching Requirements

- 规范仓库根目录为当前内层应用仓库；外层规划仓库不作为该 GitHub 远端的一部分。
- 保留 package-lock.json，不提交 node_modules、frontend/dist、coverage、artifacts。
- 新增 .gitattributes，固定 JS/MJS/JSON/YAML/Markdown 为 LF，PowerShell 为 CRLF，避免跨平台无意义差异。
- 逐项审查当前删除文件；只删除确认无引用的旧占位、demo 和废弃服务文件。
- 合理拆分提交：运行时兼容性、acceptance 后端、acceptance 前端、测试与 CI、文档与发布。

### Acceptance Bootstrap

- 提供受版本控制的 npm run acceptance 或等价入口，不依赖临时 .codex-* 文件。
- 第一次运行时创建隔离数据目录和一个名称明确的 ACTIVE 验收 Topic；后续运行复用该 Topic，不重复创建。
- 启动入口向运行时注入 Mock Embedding/Chat，实现不得被普通 npm start 或 team profile 调用。
- 启动时确定并绑定前端默认 Topic，保证上传发布后从首页问答无需人工复制 Topic ID。
- 启动成功后输出问答页、上传页、Swagger 和健康检查 URL，不输出密钥。
- 停止时释放 HTTP 端口、parser worker、SQLite 和 runtime.lock。

### Browser Acceptance Interface

- 前端路径：/acceptance/upload。
- 后端前缀：/api/acceptance，仅 acceptance profile 注册。
- 最小操作：读取 context、上传单文件、读取 Job、读取 Document、人工发布、读取原文。
- 所有写请求要求 loopback、同源 Origin 和有效 HttpOnly 会话；跨 Topic 返回 404。
- 页面在窄屏和桌面环境可用，键盘可操作，错误区域使用 role=alert。
- 轮询必须有 120 秒上限，组件卸载后停止状态更新，不允许无限忙轮询。

### Canonical Backend API

- /api/rag/v1/topics：创建、查询、激活、停用 Topic。
- /api/rag/v1/documents：单文件上传和按 Topic 查询。
- /api/rag/v1/jobs/{jobId}：查询异步任务。
- /api/rag/v1/documents/{documentId}/publish：人工发布。
- /api/rag/v1/search、/api/rag/v1/chat、/api/chat：检索与问答。
- /api/rag/v1/documents/{documentId}/file：受控读取原文。

公开 API 仍以 OpenAPI 3.1 为真相源；acceptance 专用接口不得扩展为对外稳定契约。

### File and Ingestion Requirements

- 单文件最大 30MB；只接受一个 file 字段。
- 校验扩展名、MIME、文件头、大小、路径安全和内容有效性。
- PDF 只提取文本层；扫描版返回 RAG_NO_TEXT_CONTENT。
- XLSX 逐工作表读取非空单元格，公式使用缓存值并保留工作表/单元格范围；支持合法 SpreadsheetML 命名空间前缀和中文文件名。
- 全文解析与 Embedding 成功后才事务写入 chunks；失败不得产生可检索残留。
- 成功状态为 READY，必须人工发布后才进入检索。

### Configuration Requirements

- .env.example 只含空占位符和安全默认值。
- README 分开描述：
  - Mock 浏览器验收：npm run acceptance。
  - 开发模式：后端 3000 + Vite 5173。
  - 真实模型本机验收：先 build，再以 NODE_ENV=production 启动。
  - team 模式：私有 IPv4、允许 CIDR、默认 Topic 和防火墙前置条件。
- 真实模型配置必须成组校验；缺失、混填或非法 URL 在启动阶段失败。
- 禁止在前端 bundle、日志、测试快照、文档、命令示例和验收报告中出现真实密钥。

### CI and Quality Gates

- GitHub Actions 至少包含：
  - windows-latest + Node.js 24 + npm cache。
  - npm ci。
  - npm run verify。
  - Mock 浏览器上传端到端。
- 可保留 Ubuntu 基础测试，但不能替代 Windows 门禁。
- CI 失败、测试跳过、构建失败、安全扫描失败或发现禁止跟踪文件时不得合并。
- CI 不调用真实模型，不依赖业务资料，不生成含密钥的构建日志。

### Security & Privacy

- GitHub 仓库沿用当前可见性；本轮不执行 Public/Private 切换。安全设计不得依赖仓库可见性，所有提交内容都按可能被外部读取处理。
- .env、data、SQLite、日志、发布 ZIP、企业文档和模型密钥必须由 .gitignore 与 CI 双重阻断。
- Mock acceptance 只监听 loopback；team profile 不注册 acceptance 路由。
- 浏览器只使用短期 HttpOnly Cookie；管理接口只接受后端长期 API Key。
- 原文件磁盘路径只使用内部 ID，不使用上传文件名；读取时验证目标仍属于允许的 Topic 和状态。
- 外部真实模型会接收问题和最多 5 个证据片段；供应商和数据边界需在人工验收前确认。

### Definition of Done

本轮迭代只有同时满足以下条件才算完成：

- codex/acceptance-handoff 包含经过审查的全部实现、测试、文档和 CI 修改。
- 干净克隆可以按 README 在 15 分钟内启动 Mock acceptance。
- 浏览器上传页与后端 Swagger 均完成上传、READY、人工发布和原文核对。
- 前端问答在 Mock 模式完成一次有引用回答、一次无依据拒答和一次攻击阻断。
- npm run verify、Windows CI 和禁止跟踪文件门禁通过。
- 真实模型 10 题人工验收通过并生成脱敏报告。
- GitHub 仓库可见性保持不变，Draft PR 完成审查。
- docs/ACCEPTANCE_REPORT.md 更新为当前测试数量、扫描数量、提交 SHA 和最终结论。
- 第二台 Windows 不作为 DoD；如未执行，仅列入后续建议，不得继续标记为阻塞。

## 5. Risks & Roadmap

### Phased Rollout

#### MVP Iteration 01 — 本轮

1. 收敛仓库边界、分支和未提交变更。
2. 正式挂载受限 acceptance profile 与浏览器上传页。
3. 实现一键 Mock bootstrap 和默认 Topic 绑定。
4. 修复 README、部署和交接流程。
5. 升级 GitHub Actions 至 Node.js 24 + Windows 门禁。
6. 完成 Mock 自动化与真实模型人工验收。
7. 通过 Draft PR 合并 main。

#### v1.1 — 后续增强

- 在另一台 Windows 或干净 VM 上复验发布包与备份恢复。
- 增加管理员登录、Topic 选择和文档列表管理 UI。
- 增加自动生成脱敏验收报告和可下载证据包。
- 增加依赖漏洞与许可证策略扫描。

#### v2.0 — 非本轮承诺

- 企业身份接入、细粒度 RBAC、审计中心。
- 受控 Topic 推荐与内容治理工作流。
- OCR、更多格式、对象存储和高可用数据层。

### Technical Risks

| 风险 | 影响 | 缓解措施 | 触发后的决策 |
|---|---|---|---|
| acceptance 路由误入普通 local/team | 浏览器可执行管理动作 | 配置级显式 profile、loopback 校验、非 acceptance 404 测试 | 阻止合并 |
| Mock 被误认为真实质量 | 产生错误验收结论 | UI/日志/报告强标识，真实模型设独立门禁 | 撤销结论并重测 |
| 默认 Topic 与上传 Topic 不一致 | 发布后前端问不到内容 | bootstrap 创建或复用单一 Topic，并绑定问答上下文 | 启动失败，不静默降级 |
| 过渡仓库提交内容泄密 | 企业数据或密钥外泄 | 不依赖 visibility；显式暂存、安全扫描、禁止文件 CI，所有提交按可公开读取标准审查 | 立即停止推送并轮换密钥 |
| CI Node/OS 与本机不同 | 远端假失败或漏测 | Node 24 + Windows 主门禁，Ubuntu 仅补充 | 不允许绕过 CI |
| 真实模型不稳定、限流或费用异常 | 最终人工验收失败 | 固定小题集、超时、有限重试、独立数据目录 | 记录外部阻塞，修复后重测 |
| 当前大量删除或未跟踪文件误提交 | 丢失必要代码或引入死文件 | 分组提交、逐文件审查、禁止盲目 git add -A | 回退该提交，不改写用户数据 |
| 第二台 Windows 未验证 | 跨机问题发现较晚 | 降级为 v1.1 增强，不阻塞本轮；保留发布包自校验 | 建立后续 Issue |

### Merge and Release Policy

- **允许合并 main**：Windows CI、Mock 浏览器端到端、代码审查、文档、安全扫描和真实模型人工验收均通过。
- **不阻塞合并**：第二台 Windows 或干净 VM 验收未执行。
- **禁止合并**：acceptance 路由在非验收模式可访问、存在密钥或业务数据、真实模型题集出现伪造引用、README 无法从干净克隆复现。
- **回滚方式**：回滚本轮 PR；保留既有 production API 和数据库格式，不对用户数据执行破坏性迁移。
