# 可移植 MVP 架构

发布模式只有一个 Node.js 24/Express 应用进程和最多一个 parser worker thread。Express 同时提供 React 静态文件、健康检查、OpenAPI、管理 API、查询 API、串行摄取任务和进程内向量检索；没有 Docker、RAGFlow、PostgreSQL、独立数据库、消息队列或第二服务进程。

```text
React / backend caller
        │ HttpOnly query session / X-API-Key
        ▼
Express routes -> services -> domain
        │              │
        │              ├─ OpenAI-compatible Embedding / Chat
        │              └─ one parser worker thread
        ▼
SQLite WAL + DATA_DIR/original
```

SQLite 是 Topic、文档、任务、chunk 和 embedding 的唯一状态真相源。`DATA_DIR/runtime.lock` 禁止同一目录被两个活动实例使用；原文件路径只由内部 ID 生成。任务逐个处理，整份文档解析和 embedding 成功后才事务写入 chunks；READY 与 PUBLISHED 严格分离。

检索只读取 ACTIVE Topic、PUBLISHED 文档和当前 embedding 模型，缓存版本随发布集变化失效，并在响应前复核。问答最多使用 5 个当前候选，将证据标记为不可信数据，禁止工具、联网和训练知识补全；模型 claims 经 Schema、候选集合和最终数据库状态复核后才组成公共答案。

安全边界：local 只监听回环；team 只允许私有网络和明确 CORS；浏览器不持有长期 Key；会话使用 HttpOnly、SameSite=Strict 和 Origin 绑定；错误及结构化日志不记录正文、凭据、路径或供应商响应。

容量边界：20 Topics、500 文档、5GB 原文、50,000 chunks、单文件 30MB、最多 3 个查询并发、单个后台解析任务。无 OCR、自动 Topic、对话历史、反馈、RBAC、公开互联网或生产 SLA。
