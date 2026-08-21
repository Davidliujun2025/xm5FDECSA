# Windows 可移植运行基线

MVP 不使用 Docker、PostgreSQL/pgvector 或公司服务器。所有合格 Windows 主机都从同一个源码／发布包安装 Node.js 24 依赖，并把配置与数据留在仓库之外或 Git ignored 路径。

## local profile

1. 执行 `npm ci`。
2. 复制根目录 `.env.example` 为 `.env`，生成高强度 `RAG_API_KEY` 与独立 `FRONTEND_SESSION_SECRET`。
3. 执行 `.\scripts\start-local.ps1`。
4. 确认 `/health/live` 与 `/health/ready` 均为 200。

local profile 强制 `127.0.0.1`，不能被其他电脑访问。

## team profile

除上述密钥外，必须明确配置：

- `RAG_HOST=0.0.0.0` 或服务主机的私有 IPv4
- 具体的 `CORS_ORIGINS`，不得使用 `*`
- `FRONTEND_DEFAULT_TOPIC_ID`
- 仅含 RFC1918／回环私有 IPv4 的 `TEAM_ALLOWED_CIDRS`

执行 `.\scripts\start-team.ps1`。脚本只校验配置，不静默创建防火墙规则；维护者须把 Windows 入站规则限制到专用网络与指定网段。禁止端口转发、公网 IP 和未经批准的 tunnel。

## 数据与迁移

`DATA_DIR` 默认为发布目录下的 `./data`，包含 `knowledge.db`、`original/`、`temp/`、`logs/` 与 `backups/`。同一目录不能由两个实例或两台电脑共享写入。迁移主机时必须停服后备份／恢复，不能复制正在写入的数据库。

`.env`、`data/`、SQLite、日志、业务原文、npm 缓存和 `node_modules` 不进入 Git 或应用发布包。
