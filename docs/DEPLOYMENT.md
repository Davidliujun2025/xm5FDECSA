# Windows 发布、部署与迁移

## 生成发布包

在 Node.js 24.x、npm 11.x 和 Windows PowerShell 环境执行：

```powershell
npm ci
.\scripts\package-release.ps1
```

脚本先运行完整验证和前端构建，再生成 `artifacts/huaxia-rag-mvp-<version>.zip`。ZIP 包含运行源码、migration、前端 dist、示例、文档、启动与备份脚本；不含 `node_modules`、npm 缓存、`.env`、业务数据、SQLite、日志或电脑特定路径。`release-manifest.json` 记录每个文件的 SHA-256。

目标 Windows 电脑解压后执行 `npm ci --omit=dev --ignore-scripts`，复制 `.env.example` 为 `.env`，填写强随机密钥与模型配置。安装与首次启动目标为 30 分钟内完成。

## Mock 验收与生产边界

- `npm run acceptance` 是**验收专用入口**：确定性 Mock 模型（`TEST_ACCEPTANCE_ONLY`）只服务本机与
  CI 的流程验收，**不可用于生产**，也不得作为 AI 质量结论或生产降级方案。
- 普通 local/team 生产运行时不会回退到 Mock；真实模型缺失或配置混填时在启动阶段以
  `RAG_CONFIG_INVALID` 失败，绝不静默降级。
- 数据目录严格隔离：Mock 验收 `data/acceptance`、真实模型人工验收 `data/real-acceptance`
  （或指定的其他独立目录）、生产 `DATA_DIR` 三者不得混用；真实模型验收入口会拒绝复用
  包含 Mock Topic 或 Mock 向量的目录。
- 真实模型四件套（`MODEL_BASE_URL`、`MODEL_API_KEY`、`EMBEDDING_MODEL`、`CHAT_MODEL`）
  必须全部为空或全部提供，成组校验；数据边界、超时、401/429 与费用风险见
  `docs/iterations/mvp-iteration-01/REAL_MODEL_CONFIGURATION.md`。
- 真实模型人工验收流程与脱敏证据记录见
  `docs/iterations/mvp-iteration-01/MANUAL_ACCEPTANCE.md`。

## 回滚

- 回滚方式为回滚本轮 PR；生产 API 契约与数据库格式保持不变，不对用户数据执行破坏性迁移。
- 发布前用 `.\scripts\backup-data.ps1` 生成停服备份，异常时在停止服务后按下一节在新目录恢复，
  不覆盖当前数据。

## local 与 team

local 执行 `.\scripts\start-local.ps1`，只监听 `127.0.0.1`。team 还必须配置 `RAG_HOST`（私有 IPv4 或 `0.0.0.0`）、明确的 `CORS_ORIGINS`、有效 `FRONTEND_DEFAULT_TOPIC_ID` 和私有 `TEAM_ALLOWED_CIDRS`，再运行 `start-team.ps1`。维护者必须用 Windows 防火墙把入站范围限制到批准网段；禁止路由器端口转发、公网 IP 或临时公网 tunnel。

生产启动设置 `NODE_ENV=production` 后，同一 Express 进程托管 `frontend/dist`；浏览器同源建立短期会话，不使用长期 API Key。

## 停服备份与新目录恢复

必须先停止服务并确认 `runtime.lock` 已释放：

```powershell
.\scripts\backup-data.ps1 -DataDir .\data -OutputPath ..\approved-backups\rag-backup.zip
.\scripts\restore-data.ps1 -BackupPath ..\approved-backups\rag-backup.zip -TargetDataDir ..\rag-restored-data
```

备份前执行 SQLite checkpoint、quick_check 和 foreign_key_check；ZIP 仅含数据库、原文和校验 manifest。恢复拒绝路径穿越、未知格式、缺文件、哈希错误和已存在目标目录，并在新目录再次校验 SQLite。恢复后把目标主机 `.env` 的 `DATA_DIR` 指向新目录；不要复制正在运行的 WAL，也不要覆盖当前数据或真实企业资料。

## v1.1 建议：第二台电脑验收（不阻塞本轮合并）

第二台 Windows 或干净 VM 验收**不是本轮合并门禁**，已移入 v1.1 增强计划。具备条件时在与打包机
不同的 Windows 电脑或干净 VM 执行：

1. 记录 ZIP SHA-256、主机标识、Node/npm 版本和开始时间。
2. 解压同一个 ZIP，按 manifest 抽查文件，安装 production 依赖。
3. 使用该主机自己的 `.env` 和新 `DATA_DIR` 启动，验证 live、ready 与前端首页。
4. 恢复第一台电脑生成的停服备份。
5. 使用 API Key 验证 Topic、文档状态、search、chat citation 与 file；使用浏览器同源会话验证 `/api/chat`。
6. 记录结束时间、命令、HTTP 状态、traceId 和验收人；不要把密钥、企业正文或 `.env` 写入报告。

`test-portable-release.ps1 -InstallDependencies` 是在当前主机的两个隔离目录做同包预演，可作为
跨主机验收的补充证据，但跨主机签字仍按 v1.1 计划单独执行。

## 已知边界

当前活动服务主机必须在线，无 7×24 生产 SLA；外部模型会接收问题和最多 5 个脱敏证据片段，供应商选择和数据处理协议由部署方负责；无 OCR、自动 Topic、历史会话或公网发布；单库最多 50,000 chunks；同一 `DATA_DIR` 不支持多进程或网络共享写入。
