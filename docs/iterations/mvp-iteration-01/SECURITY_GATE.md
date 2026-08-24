# 禁止跟踪文件门禁

`npm run security-scan` 与 `npm run verify` 对已跟踪文件和未忽略候选文件执行双重检查。

门禁拒绝以下内容：

- `.env` 及其变体（仅 `.env.example` 允许空占位符）；
- `node_modules`、`dist`、`coverage`、`artifacts`、`data`、日志目录和 npm 缓存；
- SQLite、日志和发布 ZIP；
- PDF、DOC、DOCX、XLS、XLSX、PPT、PPTX 原始文档；
- 私钥以及 OpenAI、GitHub、AWS、Google、Slack 常见凭据形态；
- 浏览器源码中的长期 API Key 名称或 Authorization 头；
- 发布文本中的本机绝对路径、固定私网地址、当前用户名和未完成标记。

测试 fixture 必须是运行时生成或明确标注的合成/脱敏文本，不得从企业原文复制。六格式 fixture 由测试代码在临时目录和内存中生成，不把原始 Office/PDF 文件写入 Git。

`tests/unit/security-scan.test.js` 在独立临时 Git 仓库中验证：安全文件通过；强制跟踪发布 ZIP 和测试秘密时失败；移除临时文件后恢复通过。临时仓库在测试结束时删除，不进入当前工作区。
