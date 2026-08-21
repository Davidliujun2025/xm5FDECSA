# API 基线

公开版本路径为 `/api/rag/v1`。OpenAPI 3.1 文档由运行时代码生成：

- JSON：`GET /api/rag/v1/openapi.json`
- Swagger UI：`GET /api/rag/v1/docs`

## 健康检查

- `GET /health/live`：进程存活即返回 200，不探测外部模型。
- `GET /health/ready`：配置、数据目录、实例锁、SQLite 和 migration 完成后返回 200；初始化期间返回 503 `RAG_NOT_READY`。

## 后端 API Key

后续管理接口只接受请求头 `X-API-Key`。Key 至少 32 字节、通过安全渠道分发、使用常量时间比较，禁止写入浏览器、日志和仓库。

## 浏览器查询会话

允许的 Origin 调用 `POST /api/rag/v1/auth/browser-session` 后获得短期 Cookie。Cookie 为 HMAC 签名、Origin 绑定、`HttpOnly`、`SameSite=Strict`，默认 1 小时且最大 4 小时；HTTPS 请求同时设置 `Secure`。该会话只用于后续 query 类接口，不能调用管理接口。

## 错误结构

所有错误固定为：

```json
{
  "errorCode": "RAG_UNAUTHORIZED",
  "message": "鉴权失败",
  "details": {},
  "traceId": "trace_xxx"
}
```

响应不会包含栈、内部路径、API Key 或模型密钥。Topic、文档、search 和 chat 契约将在对应开发任务完成时加入同一 OpenAPI 文档。
