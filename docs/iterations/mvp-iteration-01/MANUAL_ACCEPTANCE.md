# T4.2 真实模型人工验收环境准备手册

适用范围：真实模型人工验收（PRD US-05）。Mock 验收请使用 `npm run acceptance`，本手册不适用于 Mock。
配置规则与风险边界见同目录 `REAL_MODEL_CONFIGURATION.md`。

## 前提

- 项目负责人已批准模型供应商、数据处理协议、额度和费用预算。
- 测试资料为批准的非敏感资料，不包含真实企业正文。
- 本机 `.env` 完整配置四件套（全部为空或全部提供，缺一不可）：

```dotenv
MODEL_BASE_URL=
MODEL_API_KEY=
EMBEDDING_MODEL=
CHAT_MODEL=
```

## 数据目录隔离（强制）

- 真实模型验收使用独立 `DATA_DIR`，默认 `./data/real-acceptance`，可用 `--data-dir` 指定其他独立目录。
- 禁止复用 Mock 验收目录 `./data/acceptance`；启动入口会拒绝该目录。
- 如果目标目录已存在包含 Mock 验收 Topic 或 Mock 向量的 `knowledge.db`，启动会以 `RAG_REAL_ACCEPTANCE_MOCK_DATA_CONFLICT` 拒绝，必须改用新目录。
- Mock 与真实模型的模型 ID、向量空间和数据目录不得混用。

## 启动

```powershell
node .\scripts\start-real-acceptance.js --data-dir .\data\real-acceptance
```

成功输出问答页、Swagger、健康检查 URL、模型 ID、数据目录和证据文件路径；不输出任何密钥。
失败输出稳定错误码：缺配置 `RAG_REAL_ACCEPTANCE_MODEL_MISSING`、混填 `RAG_CONFIG_INVALID`、目录冲突 `RAG_REAL_ACCEPTANCE_DATA_DIR_CONFLICT` / `RAG_REAL_ACCEPTANCE_MOCK_DATA_CONFLICT`、端口占用 `RAG_REAL_ACCEPTANCE_PORT_IN_USE`。

## 显式 Topic 与文档流程（全部人工门禁，不自动审批、不自动发布）

用 Swagger（`/api/rag/v1/docs`）或 PowerShell 按顺序执行：

1. 创建 Topic：`POST /api/rag/v1/topics`，名称明确标记为真实模型验收用途，初始状态 `DRAFT`。
2. 显式激活：`PATCH /api/rag/v1/topics/{topicId}` 将状态改为 `ACTIVE`。
3. 单文件上传：`POST /api/rag/v1/documents`（`topicId` + 一个 `file` 字段，≤30MB，支持 PDF/DOCX/XLSX/PPTX/MD/TXT）。
4. 轮询 Job：`GET /api/rag/v1/jobs/{jobId}` 直到 `SUCCEEDED`，文档状态为 `READY`。
5. 人工发布：`POST /api/rag/v1/documents/{documentId}/publish`，状态进入 `PUBLISHED` 后才可检索。
6. 用 `GET /api/rag/v1/documents/{documentId}/file` 核对原文与上传文件 SHA-256 一致。

管理写接口使用 `X-API-Key`；创建、修改、上传请求携带 `Idempotency-Key`。

## 证据记录（不泄密）

启动成功后自动在数据目录内写入 `acceptance-evidence.json`，只允许以下字段：

- 应用版本、模型种类（`TEST_REAL_ACCEPTANCE_MANUAL`）、Embedding/Chat 模型 ID、模型地址主机名；
- 数据目录、启动时间、状态；
- Topic（ID/名称/状态）与文档列表（documentId/状态/发布时间）；
- 结论与完成时间。

绝不允许写入：`MODEL_API_KEY`、`RAG_API_KEY`、会话密钥、任何 key/secret/token/password/credential 字段、企业正文、文档原文或完整模型 URL 凭据。证据记录器会对字段白名单和凭据字段名双重校验，非法字段抛 `RAG_EVIDENCE_INVALID`。
数据目录默认在 `.gitignore` 范围内；如指定外部目录，确认该目录同样不会进入 Git。

## 状态验收

| 状态 | 验证方式 |
|---|---|
| 主流程 | 四件套完整、全新独立目录 → 启动 ready=200，检索与问答服务注册，证据文件含模型 ID/数据目录且不含任何密钥 |
| 加载中 | 初始化完成前 `/health/ready` 为 503，完成后为 200 |
| 为空 | 四件套全空 → `RAG_REAL_ACCEPTANCE_MODEL_MISSING`，不创建数据库、不回退 Mock |
| 接口报错 | 混填/缺项 → `RAG_CONFIG_INVALID`；复用 Mock 目录或 Mock 数据库 → 冲突错误；`/api/acceptance` 在本模式返回 404；证据字段违规 → `RAG_EVIDENCE_INVALID` |

## 后续任务衔接

- 固定 10 题人工题集（6 有依据 / 2 无依据 / 2 攻击）由 T4.3 提供，模板见 `MANUAL_QUESTION_SET.md`（已确认）。
- 题集执行与记录由 T4.4 完成：执行人逐题提问并把结果写入结果文件，再运行记录器核验并归档。

## T4.4 执行与记录

执行人按 `MANUAL_QUESTION_SET.md` 逐题调用问答接口（Swagger 或 PowerShell），然后填写结果文件
（可直接复制 `examples/manual-results.example.json` 修改占位）：

```json
{
  "topicId": "<验收 Topic ID>",
  "conclusion": "<脱敏结论，不含密钥与企业正文>",
  "items": [
    { "id": "MQ-01", "status": "ANSWERED", "citations": [{ "documentId": "<doc_...>", "location": "<页码/段落>" }], "note": "<可选>" },
    { "id": "MQ-07", "status": "NO_RELIABLE_EVIDENCE", "citations": [] }
  ]
}
```

状态取值必须使用接口实际返回：有依据 `ANSWERED`、无依据 `NO_RELIABLE_EVIDENCE`、攻击 `BLOCKED`（或安全拒答 `NO_RELIABLE_EVIDENCE`）。
10 题必须齐全且顺序与题集一致。运行记录器：

```powershell
node .\scripts\record-real-acceptance-result.js --data-dir .\data\real-acceptance --results .\manual-results.json
```

记录器自动完成以下核验，任一不满足即拒绝记录并返回 `RAG_ACCEPTANCE_RESULT_INVALID`：

- 题集已经项目负责人确认，结果恰好覆盖 10 题；
- 每题的 status 符合其类型预期；
- 每条 citation 的 documentId 存在、属于当前验收 Topic、状态为 `PUBLISHED`、向量空间与当前 Embedding 模型一致（拒绝伪造、跨 Topic、未发布、Mock 混用）；
- note 与结论不含密钥形态文本（`sk-`、api_key、token、password 等）；
- 全部 10 题满足预期才写 `ACCEPTANCE_PASSED`，否则写 `ACCEPTANCE_FAILED` 且命令行退出码为 1。

记录后证据文件包含题目逐项判定、Topic、文档状态、模型 ID、数据目录与结论；执行结果摘入 `docs/ACCEPTANCE_REPORT.md`（T5.4）。
