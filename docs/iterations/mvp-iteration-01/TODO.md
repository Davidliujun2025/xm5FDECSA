# 华夏智诚可移植知识库 — MVP Iteration 01 TODO

| 字段 | 内容 |
|---|---|
| 来源 PRD | docs/iterations/mvp-iteration-01/PRD.md |
| 迭代目标 | 现有 GitHub 过渡仓库协作交付、浏览器上传验收、Mock 自动化、真实模型人工问答验收 |
| 工作仓库 | 当前内层应用仓库，不是外层规划仓库 |
| 工作分支 | codex/acceptance-handoff |
| 合并目标 | main |
| 第二台 Windows | 后续增强，不是本轮合并门禁 |
| 当前本机基线 | npm run verify 已通过；69 tests、前端 build、安全扫描 147 files |

## 执行规则

- 每个任务必须同时完成实现、测试、文档和证据，才能勾选。
- 不允许直接从外层规划仓库推送应用代码；所有 GitHub 操作必须在包含 package.json、backend、frontend 的内层应用仓库执行。
- 当前工作区存在大量修改、删除和未跟踪文件；禁止未经审查使用 git add . 或 git add -A。
- Mock 只能用于 acceptance 本地模式和 CI，不能作为真实 AI 质量结论或普通 local/team 的降级路径。
- Topic 必须显式激活，文档必须显式发布；本轮不实现自动审批或自动发布。
- .env、密钥、data、SQLite、日志、发布 ZIP、真实企业文档不得进入 Git。
- 合并前必须更新本 TODO、PRD 变更记录和 docs/ACCEPTANCE_REPORT.md。

## 0. 仓库边界与安全基线

对应 PRD：US-01、US-06、Repository and Branching Requirements、Security & Privacy。

- [x] **T0.1 创建并确认工作分支**
  - 在内层应用仓库执行 git switch -c codex/acceptance-handoff。
  - 确认分支包含当前 main 领先 origin/main 的 7 个提交。
  - 验收：git status --short --branch 显示正确分支，不改变外层仓库。

- [x] **T0.2 确认 GitHub 远端和权限**
  - 确认 origin 指向 Davidliujun2025/xm5FDECSA。
  - 通过项目负责人账号完成 GitHub 登录和网络连接。
  - 沿用仓库当前可见性，不执行 Public/Private 切换；只确认参与同伴具备当前协作流程所需权限。
  - 验收：git ls-remote --symref origin HEAD 成功；可见性未被修改；不在日志中输出令牌。

- [x] **T0.3 逐项审查当前工作区**
  - 为所有 modified、deleted、untracked 文件标记“保留、删除、重命名、暂不提交”。
  - 特别复核 backend/.env.example、旧 service/validator、demo、旧测试和旧脚本的删除是否确属废弃。
  - 验收：形成 PR 描述中的文件变更清单；无意外删除。

- [x] **T0.4 规范行尾和生成物**
  - 新增 .gitattributes：JS/MJS/JSON/YAML/Markdown 使用 LF，PowerShell 使用 CRLF。
  - 保持 node_modules、frontend/dist、coverage、artifacts、data、.env、数据库和日志在 .gitignore 中。
  - 验收：git diff --check 无错误；不再出现大面积无意义行尾差异。

- [x] **T0.5 建立禁止跟踪文件门禁**
  - 扩展 verify/security-scan，检查 .env、data、数据库、密钥、企业文档、日志和发布包。
  - 明确测试 fixture 必须为合成或脱敏内容。
  - 验收：故意放入临时禁止文件时门禁失败，删除后恢复通过；临时文件不得提交。

## 1. Acceptance 模式后端与一键引导

对应 PRD：US-01、US-02、US-03、Model Mode Requirements、Acceptance Bootstrap。

- [x] **T1.1 定义正式 acceptance 启动入口**
  - 在 package.json 增加 npm run acceptance。
  - 使用受版本控制的启动脚本，不依赖任何 .codex-tmp-* 文件。
  - 强制绑定 127.0.0.1，使用隔离 DATA_DIR。
  - 验收：干净环境运行一个命令即可启动；普通 npm start 行为不变。

- [x] **T1.2 实现确定性 Mock Embedding 与 Mock Chat**
  - Mock 不访问网络，输出稳定、可重复并包含可验证 citation。
  - Mock 只通过 acceptance 启动入口依赖注入，不增加普通生产环境变量开关。
  - 模型 ID 和向量空间与真实模型完全隔离。
  - 验收：断网状态可完成上传和问答；local/team 不配置真实模型时不得回退 Mock。

- [x] **T1.3 自动创建或复用验收 Topic**
  - 第一次运行创建名称明确的测试 Topic 并显式激活。
  - 后续运行复用同一 Topic，不重复创建。
  - 自动将前端问答绑定到该 Topic，但不得把此逻辑扩展为业务 Topic 自动审批。
  - 验收：连续启动两次 Topic 数不增加；问答与上传使用同一 topicId。

- [x] **T1.4 正式挂载 /api/acceptance**
  - 仅 acceptance 模式注册 createLocalAcceptanceRouter。
  - 普通 local、team、production 和 OpenAPI 均不暴露该路由。
  - 保留 loopback、同源 Origin、HttpOnly 会话和跨 Topic 404 防护。
  - 验收：acceptance 模式返回 context；其他模式请求 /api/acceptance/context 为 404。

- [x] **T1.5 保持人工发布门禁**
  - 上传成功仅进入 UPLOADED/PROCESSING/READY。
  - 只有用户显式操作才执行 READY → PUBLISHED。
  - 不允许 acceptance 路由发布其他 Topic 文档。
  - 验收：READY 文档检索不到；发布后可检索；其他 Topic 的 documentId/jobId 返回 404。

- [x] **T1.6 正确关闭运行时**
  - Ctrl+C 或正常停止时关闭 HTTP server、Job loop、parser worker、SQLite 并释放 runtime.lock。
  - 端口占用和数据目录被锁时返回明确错误。
  - 验收：停止后端口和 runtime.lock 均释放；相同 DATA_DIR 可重新启动。

- [x] **T1.7 补全后端安全测试**
  - 覆盖无 Cookie、缺 Origin、错误 Origin、非 loopback、跨 Topic、重复 SHA、超限、损坏文件和发布前检索。
  - 覆盖 acceptance 路由不进入公开 OpenAPI。
  - 验收：新增测试全部通过，失败路径不产生可检索 chunk。

## 2. 浏览器上传页与前端问答衔接

对应 PRD：US-02、US-03、Browser Acceptance Interface。

- [x] **T2.1 完成 /acceptance/upload 正式页面**
  - 页面顶部展示 MOCK / LOCAL ACCEPTANCE。
  - 展示验收 Topic、支持格式、30MB 限制和禁止真实企业资料提示。
  - 从问答页可发现上传入口；上传页可返回问答页。
  - 验收：production build 后直接访问和刷新该路径均正常。

- [ ] **T2.2 完成浏览器文件预检**
  - 只允许 PDF、DOCX、XLSX、PPTX、MD、TXT。
  - 检查扩展名、非空和大小；服务端继续作为最终校验真相源。
  - 验收：不支持格式和超限文件在发起请求前给出可读提示。

- [ ] **T2.3 完成五阶段状态流**
  - selected、uploaded、processing、ready、published 状态与后端一致。
  - Job 轮询间隔受控，最长 120 秒，组件卸载后停止更新。
  - FAILED 显示 errorCode、message、traceId；允许选择新文件重新开始。
  - 验收：加载、成功、失败、超时和重置路径均有自动化测试。

- [ ] **T2.4 完成人工发布交互**
  - READY 时显示明确的发布按钮与“发布后可检索”提示。
  - 发布期间禁用重复点击；成功后展示 PUBLISHED。
  - 验收：不存在自动发布调用；重复操作不会生成异常状态。

- [ ] **T2.5 完成问答与引用核对**
  - 发布后提供“进入问答”与“核对原文件”入口。
  - 问答页绑定验收 Topic，展示 answer、status、citation、位置、excerpt 和原文链接。
  - 验收：有依据问题回答并引用；无依据拒答；攻击问题阻断。

- [ ] **T2.6 完成安全与可访问性**
  - 浏览器 bundle 不出现 RAG_API_KEY、MODEL_API_KEY、X-API-Key。
  - 错误区使用 role=alert；按钮具有键盘焦点和禁用状态；窄屏不溢出。
  - 验收：前端安全扫描、单元测试和生产构建通过。

## 3. 标准后端上传契约

对应 PRD：US-04、Canonical Backend API、File and Ingestion Requirements。

- [ ] **T3.1 保持 Swagger 后端验收主流程**
  - 校验 Topic 创建、激活、上传、Job、READY、发布、search/chat、file 的 OpenAPI。
  - README/HANDOFF 提供 Swagger 与 PowerShell 两种调用方式。
  - 验收：全部 16 个公开操作通过契约测试和真实 production DI E2E。

- [ ] **T3.2 完成六格式和中文兼容性**
  - 保留 PDF、DOCX、XLSX、PPTX、MD、TXT 成功与失败矩阵。
  - 保留 XLSX 命名空间前缀、tableParts 和中文文件名回归测试。
  - 验收：每种格式至少 3 个成功样例，损坏/空内容/边界样例稳定失败。

- [ ] **T3.3 验证状态和数据完整性**
  - 相同 Topic 的相同 SHA 返回冲突。
  - 原文件回读 SHA 与上传源一致。
  - 解析或模型失败时回滚全部 chunks。
  - 验收：数据库中不存在部分索引、重复 ordinal 或跨 Topic 引用。

## 4. 真实模型人工问答验收

对应 PRD：US-05、Manual Real-Model Evaluation。

- [ ] **T4.1 完善真实模型配置说明**
  - 说明 MODEL_BASE_URL、MODEL_API_KEY、EMBEDDING_MODEL、CHAT_MODEL 必须成组配置。
  - 说明真实模型数据边界、超时、429、401 和费用风险。
  - 验收：缺失或混填配置在启动阶段失败；文档不含真实凭据。

- [ ] **T4.2 准备独立人工验收环境**
  - 使用独立 DATA_DIR，不复用 Mock 数据库或向量。
  - 使用批准的非敏感测试资料，显式创建/激活 Topic、上传并人工发布。
  - 验收：模型 ID、数据目录和文档状态均可记录且不泄密。

- [ ] **T4.3 固定 10 题人工题集**
  - 6 题有依据、2 题无依据、2 题提示注入或越权。
  - 每题定义预期状态和应引用的 documentId/位置，不把企业正文写入 Git。
  - 验收：题集模板经过项目负责人确认。

- [ ] **T4.4 执行并记录真实模型验收**
  - 有依据题的事实主张全部有合法 citation。
  - 无依据题全部拒答；攻击题全部阻断或安全拒答。
  - 记录应用版本、模型 ID、时间、状态、citation documentId 和脱敏结论。
  - 验收：10/10 满足预期；无伪造、跨 Topic、未发布或失效 citation。

## 5. README、部署、交接与验收文档

对应 PRD：Configuration Requirements、Definition of Done。

- [ ] **T5.1 重写 README 首次启动顺序**
  - 分开描述 Mock acceptance、开发模式、真实模型 production、本地 Swagger 和 team 模式。
  - production 顺序必须为 npm ci → 配置 .env → npm run build → start-local。
  - 明确前端问答必须绑定有效 FRONTEND_DEFAULT_TOPIC_ID，或由 acceptance bootstrap 自动绑定。
  - 验收：同伴只阅读 README 即可完成 Mock 启动。

- [ ] **T5.2 更新 HANDOFF 与 API 文档**
  - 说明浏览器上传页是验收适配层，后端公开契约仍为 /api/rag/v1。
  - 说明浏览器会话、API Key、Origin、Topic 和发布状态边界。
  - 验收：文档中的路径、状态和示例与 OpenAPI/实现一致。

- [ ] **T5.3 更新 DEPLOYMENT**
  - 说明 Mock 不可用于生产、真实模型配置、数据目录隔离、备份恢复和回滚。
  - 删除第二台 Windows 作为本轮阻塞条件，移到 v1.1 建议。
  - 验收：部署文档不再与本 PRD 合并门禁冲突。

- [ ] **T5.4 更新 ACCEPTANCE_REPORT**
  - 更新实际测试数、安全扫描文件数、提交 SHA、CI 链接和真实模型人工结果。
  - 明确第二台 Windows 未执行但不阻塞本轮合并。
  - 验收：报告不含密钥、企业正文或本机绝对秘密路径。

- [ ] **T5.5 提供脱敏验收样例或生成器**
  - 至少提供一个 TXT/MD 快速样例；其他格式由测试 fixture 或生成脚本覆盖。
  - 不提交当前 outputs 中的企业工作簿。
  - 验收：样例许可证和来源明确，安全扫描通过。

## 6. GitHub Actions 与合并保护

对应 PRD：US-06、CI and Quality Gates、Merge and Release Policy。

- [ ] **T6.1 修复 Node 版本**
  - actions/setup-node 使用 Node.js 24，与 package.json engines 一致。
  - 验收：CI 不再使用 Node 22。

- [ ] **T6.2 增加 Windows 主门禁**
  - 使用 windows-latest 执行 npm ci 和 npm run verify。
  - 可保留 ubuntu-latest 基础测试，但不能替代 Windows。
  - 验收：Windows Job 成功才允许合并。

- [ ] **T6.3 在 CI 执行 Mock 浏览器端到端**
  - 不调用真实模型，不读取 GitHub Secret 中的模型凭据。
  - 验证 acceptance route、上传、READY、人工发布、问答和引用。
  - 验收：断网或无模型密钥情况下稳定通过。

- [ ] **T6.4 收紧 CI 安全检查**
  - 运行 security-scan、禁止跟踪文件检查和 git diff --check。
  - CI 日志与 artifact 不包含 .env、data、数据库、原文和密钥。
  - 验收：注入一个测试秘密时 CI 必须失败。

- [ ] **T6.5 配置 GitHub 分支保护**
  - main 禁止直接推送。
  - 要求 Draft 转 Ready、至少一次代码审查和 Windows CI 通过。
  - 第二台 Windows 不设置为 required check。
  - 验收：未通过 CI 的 PR 无法合并。

## 7. 全量验证与发布候选

对应 PRD：全部 KPI、Definition of Done。

- [ ] **T7.1 运行完整本机验证**
  - 执行 npm run verify。
  - 验收：全部测试通过、前端 build 成功、安全扫描通过、禁止文件检查通过。

- [ ] **T7.2 运行 AI 与性能基线**
  - 执行 npm run eval 和 npm run performance。
  - 验收：黄金集达到 KPI-04；性能不低于现有 MVP 门槛。

- [ ] **T7.3 验证干净安装**
  - 在新临时目录或发布 ZIP 中执行 npm ci。
  - 从 README 运行 Mock acceptance，记录开始与完成时间。
  - 验收：15 分钟内页面就绪并完成浏览器全链路。

- [ ] **T7.4 验证发布包和备份恢复**
  - 执行 release/package 与本机隔离目录恢复测试。
  - 发布包不含依赖缓存、.env、data、日志、数据库或业务资料。
  - 验收：manifest 哈希、健康检查、Topic、search/chat、citation/file 复验通过。

- [ ] **T7.5 最终 Git 安全审查**
  - 执行 git status --short、git diff --check、git diff --cached --check。
  - 使用 git ls-files 检查禁止文件。
  - 人工阅读 staged diff，逐项确认删除。
  - 验收：暂存区只包含本轮明确文件。

## 8. 提交、Draft PR 与合并

对应 PRD：US-06、Merge and Release Policy。

- [ ] **T8.1 按逻辑拆分提交**
  - 建议顺序：运行时/兼容性；acceptance 后端；acceptance 前端；测试/CI；文档/发布。
  - 每个提交可独立阅读，不混入外层仓库或业务资料。
  - 验收：git log 和每个 diff 的职责清晰。

- [ ] **T8.2 使用项目负责人账号推送分支**
  - 推送 codex/acceptance-handoff 到 origin。
  - 不强推、不改写远端 main 历史。
  - 验收：远端分支 SHA 与本地一致。

- [ ] **T8.3 创建 Draft PR**
  - PR 描述包含需求范围、非目标、启动步骤、测试结果、真实模型结果、风险和回滚。
  - 关联本 PRD 和 TODO。
  - 验收：协作者可按 PR 描述完成 Mock 验收。

- [ ] **T8.4 处理审查和 CI 反馈**
  - 修复反馈后重跑 npm run verify。
  - 每次更新同步 TODO 和验收报告。
  - 验收：所有 required checks 通过，审查意见关闭。

- [ ] **T8.5 合并 main**
  - 合并前确认真实模型 10 题通过、仓库可见性保持不变、无密钥和业务资料。
  - 第二台 Windows 未执行不阻塞合并，只建立 v1.1 Issue。
  - 验收：main 包含本轮 PR，发布说明和回滚点明确。

## 合并门禁清单

以下项目全部满足才允许把 Draft PR 转为 Ready 并合并：

- [ ] 浏览器 Mock 上传页可从干净克隆启动。
- [ ] Mock 上传、READY、人工发布、问答、citation、原文全链路通过。
- [ ] 非 acceptance 模式无法访问 /api/acceptance。
- [ ] Swagger 标准上传与发布流程通过。
- [ ] Windows Node.js 24 CI 通过。
- [ ] npm run verify、npm run eval、npm run performance 通过。
- [ ] 真实模型固定 10 题人工验收通过。
- [ ] Git 跟踪文件无密钥、业务资料、data、数据库、日志和构建产物。
- [ ] README、HANDOFF、DEPLOYMENT、ACCEPTANCE_REPORT 与实现一致。
- [ ] 项目负责人和至少一名协作者完成审查。

## 后续但不阻塞本轮

- [ ] 在另一台 Windows 或干净 VM 复验发布 ZIP 和备份恢复，作为 v1.1 Issue。
- [ ] 增加管理员登录、Topic 选择和文档列表 UI。
- [ ] 增加自动生成脱敏验收证据包。
- [ ] 增加依赖漏洞、SBOM 和许可证策略扫描。

## 完成记录

| 项目 | 结果 |
|---|---|
| 最终分支 SHA | 待填写 |
| Draft PR URL | 待填写 |
| Windows CI URL | 待填写 |
| npm run verify | 待填写 |
| 黄金集 | 待填写 |
| 性能基线 | 待填写 |
| 安全扫描 | 待填写 |
| 真实模型 10 题 | 待填写 |
| 审查人 | 待填写 |
| 合并时间 | 待填写 |
