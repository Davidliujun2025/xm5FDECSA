# T3.2 六格式与中文兼容性验收

## 变更边界

- 目标：固定 PDF、DOCX、XLSX、PPTX、MD、TXT 的成功与失败行为，并兼容浏览器上传的 UTF-8 中文文件名。
- 允许范围：文件名规范化、XLSX 兼容层、合成 fixture、解析器与上传接口回归测试。
- 保护逻辑：不改变公开 API、Topic 激活、人工发布、SHA 去重和容量上限；损坏、空内容与超限输入继续 fail closed。

## 自动化矩阵

| 状态 | 覆盖 |
|---|---|
| 主流程 | 六种格式各 3 个独立合成样例，共 18 个；均产生可定位 block 与 chunk |
| 加载中 | 慢速 multipart 上传在完整原子提交前不可见；上传后保持 `UPLOADED + QUEUED` |
| 为空 | 空白 MD/TXT、无文本 PDF 固定返回 `RAG_NO_TEXT_CONTENT` |
| 接口报错 | 损坏 Office 包固定返回 `RAG_FILE_INVALID`；格式、MIME、请求头、容量与路径错误不留下可用记录 |

额外回归覆盖：

- 合法的 SpreadsheetML 主命名空间前缀可被解析。
- 工作簿包含 `tableParts` 时，普通单元格及表格数据单元格仍保留 sheet/cell 定位。
- 浏览器 multipart 的 UTF-8 中文文件名可无损恢复，详情接口及原文件下载均返回 `原始资料.txt`。
- 加密 PDF、扩展边界、格式与 MIME 不匹配继续返回稳定且不泄漏堆栈的错误。

## 执行命令

```powershell
node --test tests/integration/format-matrix.test.js tests/unit/parsers.test.js tests/integration/document-api.test.js
npm run verify
```

所有 fixture 均由测试代码即时合成，不包含真实企业资料或二进制样本文件。
