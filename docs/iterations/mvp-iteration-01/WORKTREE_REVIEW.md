# MVP Iteration 01 工作区逐项审查

审查基线：`7002bc2`（`codex/acceptance-handoff`）
审查日期：2026-08-22
审查范围：内层应用仓库 `git status --short` 中的全部 60 个状态项

## 结论

- 18 个已跟踪修改：全部保留，按后续 TODO 对应任务拆分提交。
- 12 个已跟踪删除：全部确认删除；没有仍被工作树引用的文件。
- 30 个未跟踪文件：全部保留，按后续 TODO 对应任务拆分提交。
- 没有重命名候选；没有 `.env`、数据库、日志、发布 ZIP、构建产物或企业资料进入内层仓库状态。
- 外层 `../outputs/` 中的企业工作簿不属于应用仓库，明确暂不提交。
- `docs/ACCEPTANCE_REPORT.md`、`README.md` 和 `scripts/test-portable-release.ps1` 含有与本轮新 PRD 不一致的旧验收描述；文件保留，但必须分别在 T5.1、T5.3/T5.4、T7.3 中修正后才能作为最终证据。

## 已跟踪修改

| 文件 | 结论 | 归属与理由 |
|---|---|---|
| `.gitignore` | 保留 | T0.4：补充 `artifacts/` 生成物忽略规则。 |
| `README.md` | 保留 | T5.1：首次启动、评测与发布说明；当前 production 顺序仍需按 PRD 修正。 |
| `backend/src/adapters/local-files.js` | 保留 | T3.2/T3.3：中文 multipart 文件名无损恢复。 |
| `backend/src/adapters/parsers/xlsx.js` | 保留 | T3.2：兼容合法 SpreadsheetML 前缀与 `tableParts`。 |
| `backend/src/app.js` | 保留 | T1.4：为受限 acceptance 路由注入 `fileStore`。 |
| `backend/src/routes/rag-v1/openapi.js` | 保留 | T3.1：补齐稳定错误码枚举。 |
| `backend/src/utils/logger.js` | 保留 | T0.5/T6.4：支持可测试日志 destination 与脱敏验证。 |
| `docs/API.md` | 保留 | T5.2：16 个公开操作、状态和错误契约。 |
| `docs/ARCHITECTURE.md` | 保留 | T5.2：单进程、worker、SQLite、模型和安全边界。 |
| `docs/DEPLOYMENT.md` | 保留 | T5.3：发布、备份与恢复说明；第二台 Windows 描述仍需降为非阻塞建议。 |
| `frontend/src/components/MessageList.jsx` | 保留 | T2.5：统一 citation 位置与 excerpt 展示。 |
| `frontend/src/index.jsx` | 保留 | T2.1：挂载 `/acceptance/upload` 页面。 |
| `package.json` | 保留 | T0.5/T7：增加评测、性能、安全扫描、验证和发布入口；T1.1 后续增加 acceptance 入口。 |
| `scripts/verify.ps1` | 保留 | T0.5/T7.1：扩展语法、安全扫描与构建门禁。 |
| `tests/helpers/parser-fixtures.js` | 保留 | T3.2：可配置 XLSX 与合法前缀 fixture。 |
| `tests/integration/document-api.test.js` | 保留 | T3.2/T3.3：中文文件名及原文响应回归。 |
| `tests/unit/frontend-chat.test.js` | 保留 | T2.5/T2.6：citation 紧凑展示与内部位置隐藏。 |
| `tests/unit/parsers.test.js` | 保留 | T3.2：SpreadsheetML 前缀解析回归。 |

## 已跟踪删除

| 文件 | 结论 | 删除依据 |
|---|---|---|
| `backend/.env.example` | 确认删除 | 过时的 PostgreSQL/LLM 模板；根 `.env.example` 是当前完整且安全的唯一模板。 |
| `backend/src/services/llm.service.js` | 确认删除 | HEAD 中为空文件，无引用；模型适配已位于 `adapters/models/`。 |
| `backend/src/services/rag.service.js` | 确认删除 | HEAD 中为空文件，无引用；检索与回答已有独立 service。 |
| `backend/src/utils/validator.js` | 确认删除 | HEAD 中为空文件，无引用；校验由 domain/schema/config 承担。 |
| `database/seeds/demo_data.sql` | 确认删除 | HEAD 中为空文件，无引用；本轮禁止 demo 业务数据。 |
| `frontend/demo.html` | 确认删除 | 与 `frontend/index.html` 重复且不是 Vite 正式入口。 |
| `frontend/src/components/WelcomeMessage.jsx` | 确认删除 | 无引用，并包含不应作为知识回答兜底的静态业务文案。 |
| `scripts/import-docs.js` | 确认删除 | HEAD 中为空文件，无引用；本轮使用正式上传契约。 |
| `scripts/start-dev.sh` | 确认删除 | HEAD 中为空文件，无引用；目标平台使用 npm/PowerShell。 |
| `tests/integration/api.test.js` | 确认删除 | HEAD 中为空文件，无测试内容。 |
| `tests/unit/rag.service.test.js` | 确认删除 | HEAD 中为空文件，对应旧占位 service。 |
| `tests/unit/validator.test.js` | 确认删除 | HEAD 中为空文件，对应旧占位 validator。 |

## 未跟踪文件

| 文件 | 结论 | 归属与理由 |
|---|---|---|
| `backend/src/routes/local-acceptance.js` | 保留 | T1.4/T1.5：受 loopback、Origin、Cookie 和 Topic 限制的验收适配层。 |
| `docs/ACCEPTANCE_REPORT.md` | 保留 | T5.4：历史自动化证据；测试数、SHA 和第二台 Windows 结论必须更新。 |
| `docs/HANDOFF.md` | 保留 | T5.2：前后端调用与错误状态交接。 |
| `evals/baseline-results.json` | 保留 | T7.2：确定性黄金集基线证据。 |
| `evals/golden-set.json` | 保留 | T7.2：60 题合成黄金集。 |
| `evals/performance-baseline.json` | 保留 | T7.2：性能门槛与本机基线。 |
| `evals/run-golden-set.js` | 保留 | T7.2：离线质量评测入口。 |
| `evals/run-performance.js` | 保留 | T7.2：性能与发布可见性评测入口。 |
| `examples/backend-client.mjs` | 保留 | T3.1/T5.2：Node 后端标准调用示例，Key 仅来自环境变量。 |
| `examples/backend-client.py` | 保留 | T3.1/T5.2：Python 后端调用示例。 |
| `examples/browser-client.js` | 保留 | T2.5/T5.2：仅使用 HttpOnly 会话，不包含长期 Key。 |
| `examples/curl.md` | 保留 | T3.1/T5.2：PowerShell/curl 标准调用流程。 |
| `frontend/src/api/acceptance-client.js` | 保留 | T2：同源 Cookie acceptance 客户端，不发送长期 Key。 |
| `frontend/src/components/UploadAcceptance.jsx` | 保留 | T2：上传预检、五阶段、轮询和人工发布页面。 |
| `frontend/src/components/citation-format.js` | 保留 | T2.5：citation 位置与 excerpt 格式化。 |
| `frontend/src/styles/acceptance.css` | 保留 | T2.1/T2.6：验收页桌面、窄屏、焦点和状态样式。 |
| `scripts/backup-data.ps1` | 保留 | T7.4：停服数据备份与哈希清单。 |
| `scripts/check-data-dir.js` | 保留 | T7.4：SQLite、schema 和实例锁校验。 |
| `scripts/package-release.ps1` | 保留 | T7.4：发布包白名单与 manifest。 |
| `scripts/restore-data.ps1` | 保留 | T7.4：隔离目录恢复与校验。 |
| `scripts/security-scan.js` | 保留 | T0.5/T6.4：禁止路径、凭据、浏览器密钥和发布文本扫描。 |
| `scripts/test-portable-release.ps1` | 保留 | T7.3：双隔离目录演练；第二台 Windows 的旧阻塞文案需修正。 |
| `tests/contract/full-openapi.test.js` | 保留 | T3.1：16 个公开操作与错误枚举契约。 |
| `tests/integration/backup-restore.test.js` | 保留 | T7.4：新 DATA_DIR 恢复与 citation/file 复验。 |
| `tests/integration/format-matrix.test.js` | 保留 | T3.2：六格式成功/损坏/空内容矩阵。 |
| `tests/integration/golden-set.test.js` | 保留 | T7.2：黄金集门槛测试。 |
| `tests/integration/local-acceptance-upload.test.js` | 保留 | T1/T2：上传、READY、人工发布与原文验收主流程。 |
| `tests/integration/performance-acceptance.test.js` | 保留 | T7.2：性能门槛测试。 |
| `tests/integration/public-api-e2e.test.js` | 保留 | T3.1：真实 production DI 的 16 操作 E2E。 |
| `tests/integration/release-package.test.js` | 保留 | T7.3/T7.4：发布包隔离与禁止内容验证。 |
| `tests/unit/acceptance-ui.test.js` | 保留 | T2：Cookie、无 Key、五阶段与人工发布静态/行为测试。 |
| `tests/unit/logger.test.js` | 保留 | T0.5/T6.4：结构化日志敏感字段脱敏测试。 |

## PR 提交边界

- 后续提交必须按 TODO 任务逐项显式 `git add -- <paths>`，禁止 `git add .` 或 `git add -A`。
- 当前删除项只在对应实现提交中显式暂存，并在 staged diff 中再次确认。
- `../outputs/`、外层规划仓库、运行数据和本机验收产物永不进入应用仓库提交。
