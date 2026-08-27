# 核心架构

系统是单 Node.js 进程、单 SQLite 数据目录的可移植知识库服务。浏览器使用 `/api/chat` FAQ 入口；管理端或其他后端通过版本化 API 工作。

## 数据流

1. API Key 调用方创建并启用 Topic。
2. 文档先原子写入 `DATA_DIR/original`，随后在 SQLite 中创建文档记录和 `QUEUED` 任务。
3. 单并发后台任务在隔离 Worker 中校验并解析文档，按 800–1200 字符生成带来源位置的重叠块。
4. Embedding 客户端批量生成向量；全部块与元数据在同一事务中落库，失败则不保留部分索引。
5. READY 文档必须显式发布。检索只读取 ACTIVE Topic 下的 PUBLISHED 文档。
6. Chat 先做输入阻断和余弦检索，再要求模型返回结构化引用；引用缺失、越界、模型异常或证据不足时整题拒答。
7. 启动时解析仓库内 PMP、ACP、PBA、FDE 四份 FAQ 素材，将 120 条问答事务性同步到 `faq_entry`。
8. 前端 Chat 按实际 socket IP 与 Topic 解析 15 分钟活跃会话；有历史时只把最近一个完整的“用户问题 + 助手回答”与当前问题交给 DeepSeek 意图识别，无历史时只使用当前问题。DeepSeek 负责业务相关性分类和独立问题改写，异常时回退本地规则。
9. FAQ 匹配单条时返回素材中的原始答案；多条时返回候选问题；相关但无合适问题时走 9-3；无效或无关问题走 9-1。
10. Chat 将每轮用户问题、前端展示的助手回答、候选列表、意图、`9-1/9-2/9-3` 分支和转人工标记持久化到 SQLite。客户端提供的 `conversationId` 只有在 IP 与 Topic 同时匹配时才可复用。

## 模块边界

- `routes/rag-v1`：请求校验、鉴权、OpenAPI 契约和 HTTP 映射
- `services`：Topic、文档生命周期、索引、检索和答案策略
- `adapters/sqlite`：迁移、事务、仓储、运行锁与恢复
- `adapters/models`：OpenAI 兼容模型客户端、超时与稳定错误映射
- `workers`：解析隔离和串行索引循环
- `domain`：错误、ID、文档状态与文本分块规则

SQLite 中保存 FAQ、Float32 向量、IP 会话和消息历史并进行有界检索，不依赖 PostgreSQL、pgvector、Docker 或云数据库。运行数据、原文件、日志和备份均在 `DATA_DIR`，不会进入 Git。IP 是需求指定的访客键；共享 NAT 或代理出口下的不同用户会被视为同一访客。

## 安全边界

版本化业务接口只接受常量时间比较的 API Key。前端不接触长期密钥，只获得绑定 Origin、带签名、短期有效的 HttpOnly Cookie。团队模式先按实际 socket 地址执行私有 IPv4 CIDR 校验，再进入 CORS 和业务路由。
