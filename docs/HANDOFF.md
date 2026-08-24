# 前后端研发交接

## 标准后端主流程

### Swagger UI

1. 启动已配置真实模型的 local 服务，确认 `GET /health/ready` 为 200，再打开 `http://127.0.0.1:3000/api/rag/v1/docs`。
2. 点击 **Authorize**，只在受控终端/Swagger 会话填写后端 `RAG_API_KEY`；不要复制到浏览器前端源码。
3. 调用 `POST /topics` 创建 DRAFT，记录 `topicId`；调用 `PATCH /topics/{topicId}` 并发送 `{"status":"ACTIVE"}`。
4. 调用 `POST /documents`，multipart 中选择一个脱敏文件并填写同一 `topicId`，记录 `documentId` 与 `jobId`。
5. 轮询 `GET /jobs/{jobId}`。`FAILED` 时记录稳定错误字段并停止；`SUCCEEDED` 后用 `GET /documents/{documentId}` 确认状态为 `READY`。
6. 在发布前调用 `POST /search`，确认 `results` 为空；随后由验收人员显式调用 `POST /documents/{documentId}/publish`，确认 `PUBLISHED`。
7. 再调用 `POST /search` 与 `POST /chat`，核对 `ANSWERED` 的 citation 指向该 `documentId`；最后调用 `GET /documents/{documentId}/file` 核对原文件。

### PowerShell

以下脚本适用于 PowerShell 7 与 Windows 自带的 `curl.exe`。样例文件必须为脱敏 TXT；写请求失败后重试时复用原 `Idempotency-Key`。

```powershell
$api = 'http://127.0.0.1:3000/api/rag/v1'
$samplePath = (Resolve-Path '.\sample.txt').Path
if (-not $env:RAG_API_KEY) { throw '请先在当前终端设置 RAG_API_KEY' }
$admin = @{ 'X-API-Key' = $env:RAG_API_KEY }

Invoke-RestMethod 'http://127.0.0.1:3000/health/ready'

$createHeaders = $admin.Clone()
$createHeaders['Idempotency-Key'] = 'handoff-topic-0001'
$topic = Invoke-RestMethod "$api/topics" -Method Post -Headers $createHeaders `
  -ContentType 'application/json' -Body (@{ name = '交接验收 Topic' } | ConvertTo-Json -Compress)
$topicId = $topic.topicId

$activateHeaders = $admin.Clone()
$activateHeaders['Idempotency-Key'] = 'handoff-activate-0001'
Invoke-RestMethod "$api/topics/$topicId" -Method Patch -Headers $activateHeaders `
  -ContentType 'application/json' -Body (@{ status = 'ACTIVE' } | ConvertTo-Json -Compress)

$uploadJson = & curl.exe --silent --show-error --fail-with-body -X POST `
  -H "X-API-Key: $env:RAG_API_KEY" -H 'Idempotency-Key: handoff-upload-0001' `
  -F "topicId=$topicId" -F "file=@$samplePath;type=text/plain" "$api/documents"
if ($LASTEXITCODE -ne 0) { throw '上传失败' }
$upload = $uploadJson | ConvertFrom-Json

do {
  Start-Sleep -Milliseconds 650
  $job = Invoke-RestMethod "$api/jobs/$($upload.jobId)" -Headers $admin
  if ($job.status -eq 'FAILED') { throw "$($job.errorCode): $($job.errorMessage), traceId=$($job.traceId)" }
} while ($job.status -in @('QUEUED', 'PROCESSING'))

$ready = Invoke-RestMethod "$api/documents/$($upload.documentId)" -Headers $admin
if ($ready.status -ne 'READY') { throw "期望 READY，实际为 $($ready.status)" }
$question = @{ topicId = $topicId; question = '请给出样例文件中的依据' } | ConvertTo-Json -Compress
$before = Invoke-RestMethod "$api/search" -Method Post -Headers $admin -ContentType 'application/json' -Body $question
if (@($before.results).Count -ne 0) { throw 'READY 文档不应可检索' }

$published = Invoke-RestMethod "$api/documents/$($upload.documentId)/publish" -Method Post -Headers $admin
if ($published.status -ne 'PUBLISHED') { throw '发布未完成' }
$search = Invoke-RestMethod "$api/search" -Method Post -Headers $admin -ContentType 'application/json' -Body $question
$chat = Invoke-RestMethod "$api/chat" -Method Post -Headers $admin -ContentType 'application/json' -Body $question
if (@($search.results).Count -eq 0 -or $chat.status -ne 'ANSWERED') { throw '发布后问答验收失败' }
if ($chat.citations[0].documentId -ne $upload.documentId) { throw 'citation 文档不一致' }
Invoke-WebRequest "$api/documents/$($upload.documentId)/file" -Headers $admin -OutFile '.\downloaded-sample.txt'
```

## 前端

启动后先 `POST /api/rag/v1/auth/browser-session`，所有 fetch 使用相对 `/api` 与 `credentials: 'include'`。开发代理由 `RAG_PROXY_TARGET` 控制，默认 `http://localhost:3000`；生产由 Express 同源托管。

| API／状态 | 页面行为 |
|---|---|
| 会话创建或 chat 请求中 | 禁用发送，保留 `isTyping` 动画 |
| `ANSWERED` | 展示 answer、引用编号、文件名、位置、excerpt 和原文链接 |
| `NO_RELIABLE_EVIDENCE` | 原样展示固定拒答，不生成本地答案 |
| `BLOCKED` | 原样展示安全阻断，不重试为模型回答 |
| 401/403 | 提示会话失效或来源无权限，下次发送重建会话 |
| 429 | 提示繁忙，用户稍后重试 |
| 503／网络错误 | 提示服务或模型暂不可用，不展示企业事实 |

前端不得出现 API Key、模型 Key、会话签名密钥、`conversationId` 或 demo 业务答案。citation 原文链接使用相对 `/api/rag/v1/documents/{documentId}/file`。

## 浏览器验收适配层（Mock acceptance）

`/acceptance/upload` 页面与 `/api/acceptance` 接口是**验收适配层**：仅由 `npm run acceptance` 的
acceptance profile 注册，内部只调用既有 Topic/Document/Job/发布/文件读取服务，不复制任何领域
逻辑。公开稳定契约始终是 `/api/rag/v1` 的 16 个端点（OpenAPI 3.1），浏览器验收不替代后端
契约验收。

边界（全部由后端强制，前端不承担安全职责）：

- 仅监听 `127.0.0.1`；写请求必须同源 Origin + 有效 HttpOnly 会话（`rag_query_session`），
  缺 Cookie、错 Origin、非 loopback 一律失败；浏览器不接触长期 `X-API-Key`。
- `/api/acceptance` 不写入公开 OpenAPI；在 local、team 或普通 production 模式一律 404。
- Topic 隔离：跨 Topic 的 documentId/jobId 返回 404；发布只影响当前验收 Topic，不读取或
  下载其他 Topic 文档。
- 页面状态与后端一致：selected → uploaded → processing → ready → published；
  `FAILED` 展示稳定 `errorCode`、`message` 与 `traceId`，可重新选择文件。Job 轮询上限 120 秒，
  组件卸载后停止更新。
- 无自动发布：上传成功停留在 `READY`，只有用户点击「发布到测试知识库」才进入 `PUBLISHED`，
  发布前文档检索不到。

## 独立后端

从安全环境变量读取 `RAG_API_KEY`，调用 `/api/rag/v1` 并显式提供 `topicId`。标准流程：创建/启用 Topic → 单文件上传 → 轮询 job → 发布 → search/chat → citation 对应 document/file。上传超时建议 10 秒，但解析通过 job 异步观察；chat 超时 30 秒。

401 不重试；400/403/404/409/413/422 修正请求或状态后再调用；429、网络错误和明确 503 可指数退避有限重试。创建与修改重试必须复用 `Idempotency-Key`。调用方必须把 `NO_RELIABLE_EVIDENCE` 和 `BLOCKED` 当业务状态，不得改写成模型答案。

OpenAPI 可导入 API 客户端生成器，但生成代码不得把长期 Key 编入浏览器 bundle。
