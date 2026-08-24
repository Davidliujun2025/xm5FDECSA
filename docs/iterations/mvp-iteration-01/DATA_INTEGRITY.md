# T3.3 状态与数据完整性验收

## 变更边界

- 目标：验证上传、异步摄取和索引提交在成功、处理中与失败状态下保持原子性和 Topic 隔离。
- 允许范围：文档 API、摄取生命周期和 SQLite 约束的自动化回归测试，以及本验收记录。
- 保护逻辑：不修改公开 API、人工发布门禁、六格式解析行为、容量策略或真实模型配置。

## 自动化证据

| 状态 | 验收结果 |
|---|---|
| 主流程 | 六格式上传记录的 SHA-256 与源字节一致；原文件下载回读 SHA-256 一致；成功索引 ordinal 从 0 连续递增 |
| 加载中 | Job 为 `PROCESSING / EMBEDDING` 时，该文档的 chunk 数保持为 0，不暴露部分索引 |
| 为空 | 解析失败、模型失败与 chunk 容量失败后，该文档 chunk 数均为 0 |
| 接口报错 | 同 Topic 同 SHA-256 返回 `RAG_DUPLICATE_DOCUMENT`，幂等冲突继续返回 `RAG_IDEMPOTENCY_CONFLICT` |

数据库完整性额外验证：

- `UNIQUE(document_id, ordinal)` 拒绝重复 ordinal，失败语句不留下新增 chunk。
- 复合外键 `(document_id, topic_id)` 拒绝跨 Topic chunk。
- `PRAGMA foreign_key_check` 无结果，`PRAGMA integrity_check` 返回 `ok`。
- 解析失败会清除文档已有的部分 chunk，并将 Job 与 Document 同步置为 `FAILED`。
- 模型 401、429 耗尽、非法输出、维度不一致和超时均不会留下部分索引；可重试 429 仅在最终成功后一次性提交。

## 执行命令

```powershell
node --test tests/integration/document-api.test.js tests/integration/ingestion-lifecycle.test.js
npm run verify
```
