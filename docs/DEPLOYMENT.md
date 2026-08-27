# 部署与运行

## 发布前

```powershell
npm ci
npm run verify
npm run build
```

`npm run verify` 会执行测试、构建、启动冒烟和安全扫描，并拒绝提交 `.env`、数据库、日志、构建产物和疑似密钥。

## 必填配置

所有环境都必须设置高强度的 `RAG_API_KEY` 与 `FRONTEND_SESSION_SECRET`。内置 FAQ 无需模型配置；上传文档的索引与模型问答需要同时设置 `MODEL_BASE_URL`、`MODEL_API_KEY`、`EMBEDDING_MODEL` 和 `CHAT_MODEL`。

FAQ 的 DeepSeek 意图识别独立使用 `DEEPSEEK_BASE_URL`、`DEEPSEEK_API_KEY` 和 `DEEPSEEK_CHAT_MODEL`。DeepSeek 官方 API 不作为文档 Embedding 服务；密钥只保存在未跟踪的 `.env` 中。

生产环境建议设置：

```dotenv
NODE_ENV=production
RUN_PROFILE=local
RAG_HOST=127.0.0.1
FRONTEND_DIST_DIR=./frontend/dist
DATA_DIR=./data
```

反向代理与应用部署在同一台机器时可保留 local profile，由代理负责 TLS。应用未启用 Express `trust proxy`，不会根据客户端伪造的 `X-Forwarded-For` 或 `X-Forwarded-Proto` 放宽访问。

团队局域网直连时使用 `RUN_PROFILE=team`，并显式配置：

- `RAG_HOST`：私有 IPv4 或 `0.0.0.0`
- `CORS_ORIGINS`：允许的完整 Origin 列表
- `TEAM_ALLOWED_CIDRS`：规范化的私有 IPv4 CIDR 列表
- `FRONTEND_DEFAULT_TOPIC_ID`：前端使用的 Topic 标识

启动命令：

```powershell
npm start
```

就绪探针使用 `GET /health/ready`，存活探针使用 `GET /health/live`。进程使用数据目录运行锁，禁止两个实例同时写入同一 `DATA_DIR`。

## 数据保护

- 停止服务后运行 `scripts/backup-data.ps1` 创建一致性备份。
- 使用 `scripts/restore-data.ps1` 恢复到新的空数据目录。
- 原文件、SQLite、日志和备份均视为敏感运行数据，不得提交 Git。
- 可用 TablePlus 直接打开 `DATA_DIR/knowledge.db`（连接类型 SQLite），查看 `faq_entry`、`chat_session` 和 `chat_message`；服务运行时只读查看，修改前先停止服务并备份。
- 发布前至少保留一次可恢复备份，并通过健康检查和一条真实检索请求完成冒烟测试。
