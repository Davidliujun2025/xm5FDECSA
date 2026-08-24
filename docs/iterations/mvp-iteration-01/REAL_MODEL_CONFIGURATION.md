# T4.1 真实模型配置与风险边界

## 配置规则

真实模型使用 OpenAI-compatible HTTP API。以下四项必须全部为空或全部提供；开始填写后缺少任意一项都会以 `RAG_CONFIG_INVALID` 在服务监听端口前终止启动：

```dotenv
MODEL_BASE_URL=
MODEL_API_KEY=
EMBEDDING_MODEL=
CHAT_MODEL=
```

- 全部为空：仅启动不含 AI 服务的维护/接口模式；search/chat 不可用，普通 local/team 不会回退到 acceptance Mock。
- 全部提供：启用真实 Embedding、检索与 Chat。值只写入本机未跟踪的 `.env` 或批准的 Secret 存储，不写入命令、日志、截图、报告或 Git。
- `MODEL_BASE_URL` 必须是无用户名、密码、查询参数和片段的 `http`/`https` 地址；仅允许项目负责人批准的供应商地址。
- 模型 ID 必须与供应商实际开通的模型一致。Mock 与真实模型的 ID、向量空间和 `DATA_DIR` 不得混用。

根目录 `.env.example` 仅提供空占位符和安全默认值，不是可直接用于生产的凭据文件。

## 数据边界

- Embedding 请求会把解析后的文档 chunk 和每次查询文本发送给外部模型服务。
- Chat 请求会发送用户问题、系统约束以及最多 5 个已发布证据片段；不会把原文件自动整体发送给 Chat。
- 上传前必须确认供应商、处理地区、保留期、日志策略和数据处理协议，且只使用已批准的非敏感测试资料。
- 真实模型验收必须使用独立 `DATA_DIR`；不得复用 acceptance Mock 数据库、向量或模型 ID。

## 超时、401、429 与费用

- `MODEL_CONNECT_TIMEOUT_SECONDS` 范围为 1–60 秒，默认 5 秒。
- `MODEL_TOTAL_TIMEOUT_SECONDS` 范围为 1–300 秒，默认 30 秒，且不得小于连接超时。
- 401/403 映射为非重试的 `RAG_MODEL_UNAVAILABLE`：停止验收，检查本机凭据和模型权限，不在日志中打印供应商响应或 Key。
- 429 映射为 `RAG_MODEL_RATE_LIMITED`。Embedding Job 最多总计尝试 3 次，全部失败后不留下 chunk；Chat 请求向调用方返回稳定错误，不静默换用其他模型。
- 超时和 5xx 可能触发有限重试；不得通过取消超时或无限重试绕过供应商故障。
- 成本来自文档 chunk Embedding、查询 Embedding 和 Chat 请求。人工验收固定为批准的小样本与 10 题题集；执行前确认额度、单价和预算告警，发生异常费用立即停止。

## 状态验收

| 状态 | 自动化验证 |
|---|---|
| 主流程 | 四项完整时运行时进入 ready，Embedding/Chat 服务均注册且启动过程不访问网络 |
| 加载中 | 初始化完成前 `/health/ready` 返回 503，完成后返回 200 |
| 为空 | 四项全空可启动，但 AI 服务为空且无 Mock 回退 |
| 接口报错 | 任一项缺失、URL 非法、URL 含凭据或连接超时大于总超时均在启动写入数据前失败；401、429、超时保留稳定错误码 |

## 自动化命令

```powershell
node --test tests/integration/real-model-config.test.js tests/unit/config.test.js tests/unit/embedding-client.test.js tests/unit/chat-client.test.js
npm run verify
```
