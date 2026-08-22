# curl.exe 调用示例

仅后端进程或受控终端设置 `RAG_API_KEY`。浏览器不得复制以下管理调用方式。

```powershell
$base = 'http://127.0.0.1:3000'
$headers = @('-H', "X-API-Key: $env:RAG_API_KEY")

curl.exe @headers "$base/health/ready"
curl.exe @headers "$base/api/rag/v1/topics"

curl.exe -X POST @headers -H 'Content-Type: application/json' -H 'Idempotency-Key: curl-topic-0001' `
  --data '{"name":"联调 Topic"}' "$base/api/rag/v1/topics"

curl.exe -X POST @headers -H 'Idempotency-Key: curl-upload-0001' `
  -F 'topicId=topic_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' -F 'file=@.\sample.txt;type=text/plain' `
  "$base/api/rag/v1/documents"

curl.exe @headers "$base/api/rag/v1/jobs/job_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
curl.exe -X POST @headers "$base/api/rag/v1/documents/doc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/publish"

curl.exe -X POST @headers -H 'Content-Type: application/json' `
  --data '{"topicId":"topic_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","question":"请给出知识库依据"}' `
  "$base/api/rag/v1/search"

curl.exe -X POST @headers -H 'Content-Type: application/json' `
  --data '{"topicId":"topic_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","question":"请回答并给出引用"}' `
  "$base/api/rag/v1/chat"
```

后端调用超时建议：管理查询 5 秒、上传和 search 10 秒、chat 30 秒。只对网络错误、429 和明确 503 做有限重试；写接口重试必须复用相同的 `Idempotency-Key`。
