# MVP 验收报告（Iteration 01）

报告日期：2026-08-22
分支：`codex/acceptance-handoff`（未推送远端；不执行远端操作）
候选基线：`9f45d39`（本报告提交前的 HEAD，含 T0–T3、T4.1–T4.3、T4.4 工具链、T5.1–T5.3）
本机：Windows 10/11 x64，Node.js 24.x（实测 v24.15.0），npm 11.x（实测 11.12.1）

## 结论

- Mock 自动化验收全部通过：142 个测试、前端生产构建、安全扫描、发布包与备份恢复测试均通过。
- T0–T3、T4.1–T4.3、T5.1–T5.3 已实现、测试并提交；T4.4 的工程实现（独立环境、题集、记录器与
  CLI）已完成，真实模型人工执行由项目负责人暂缓（当前没有批准的非敏感测试资料）。
- 尚未完成的合并门禁项：真实模型 10 题人工验收（暂缓，合并前必须补验）、T6 CI、T7 全量验证、
  T8 提交与 PR。
- 第二台 Windows 或干净 VM 未执行，**不阻塞本轮合并**，已列为 v1.1 建议。

## 自动化验证证据（2026-08-22）

| 项目 | 结果 |
|---|---|
| `npm run verify` | 通过（退出码 0） |
| 全量测试 | 142/142 通过 |
| 前端生产构建 | 通过（vite build，39 modules） |
| 安全扫描 | `SECURITY_SCAN_PASSED`，扫描 204 个文件（文本 191、前端 bundle 3，`9f45d39` 基线时点） |
| 禁止跟踪文件检查 | 通过（verify 内含；Git 跟踪文件无密钥、data、SQLite、日志或构建产物） |
| 发布包测试 | `release-package.test.js` 通过（隔离目录、白名单、manifest）；`npm run release` 实测 RELEASE_CREATED（109 文件，内含完整 verify） |
| 备份恢复测试 | `backup-restore.test.js` 通过（停服备份、新目录恢复、citation/file 复验） |
| 干净安装预演 | `test-portable-release.ps1 -InstallDependencies`：两个隔离目录分别 `npm ci`、启动 ready=200、前端=200，合计 2 分 21 秒 |
| 黄金集 | `npm run eval` 通过：Recall@5 100%、citation 正确率 100%、有依据回答率 100%、无依据拒答率 100%、攻击阻断率 100%、非法 citation 0 |
| 性能基线 | `npm run performance` 通过：上传 P95 14.92ms、search P95 5.03ms、chat P95 5.82ms、发布/停用 22.75ms |
| CI 链接 | 待 T6：分支尚未推送，暂无 CI 运行记录 |

## 任务进度

| 阶段 | 状态 |
|---|---|
| 0–3 仓库基线、acceptance 后端、浏览器上传页、标准后端契约 | 全部完成并提交 |
| 4 真实模型人工验收 | T4.1–T4.3 完成；T4.4 工具链完成、人工执行暂缓 |
| 5 文档 | T5.1–T5.3 完成；T5.4 本报告；T5.5 待办 |
| 6–8 CI、全量验证、提交与 PR | 待办 |

## 真实模型人工验收（暂缓）

- 状态：暂缓（2026-08-22 项目负责人授权）。当前没有批准的非敏感测试资料。
- 已就绪：固定 10 题题集（MQ-01–MQ-10，6 有依据/2 无依据/2 攻击，已确认）、独立验收环境
  （`start-real-acceptance.js`）、结果记录与 citation 三层核验（`record-real-acceptance-result.js`）。
- 合并前必须按 `docs/iterations/mvp-iteration-01/MANUAL_ACCEPTANCE.md` 使用真实模型完成执行，
  10/10 满足预期后更新本报告；在完成前本项不得标记为通过。

## 第二台 Windows

未执行；按 PRD 不阻塞本轮合并，已列入 v1.1 增强建议（发布包与备份恢复已在本机双隔离目录预演）。

## 安全与隐私

本报告与 Git 跟踪文件不含模型密钥、真实企业正文、本机绝对秘密路径、SQLite、data 或日志；
真实模型凭据只存在于操作者本机未跟踪的 `.env`；验收证据记录在 gitignored 的数据目录内。
