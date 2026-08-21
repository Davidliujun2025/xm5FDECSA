# 可移植 MVP 架构基线

发布模式只运行一个 Node.js 24/Express 进程。该进程提供 API、健康检查、OpenAPI，并在后续任务中托管 React 构建产物和串行后台摄取任务。每个 `DATA_DIR` 由 `runtime.lock` 保证同一时刻只有一个活动实例。

依赖方向固定为：

```text
transport -> application -> domain
adapters  -> application -> domain
```

SQLite WAL 是业务与任务状态的持久真相源；原文件位于 `DATA_DIR/original`。后续 embedding 随 chunk 存入 SQLite，并在单进程内使用 `Float32Array` 检索。当前 `database/pgvector.sql` 与 `docker/` 仅保留为历史文件，不属于启动、测试或发布路径。

启动顺序为：校验配置、创建数据目录、获取实例锁、打开 SQLite、启用 WAL/foreign keys/busy timeout、执行只向前 migration，最后把 readiness 从 503 原子切换为 200。启动失败时不返回半初始化业务状态。

安全边界包括：local 只监听 `127.0.0.1`；team 只允许私有 IPv4 监听与明确网段；后端长期 API Key 不进入浏览器；浏览器仅获得短期 HttpOnly 查询会话；CORS 禁止通配符；错误与日志不记录密钥、正文或内部路径。
