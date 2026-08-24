# T1.1 Acceptance 启动入口

正式入口为：

```powershell
npm run acceptance
```

入口先执行前端生产构建，再通过后端导出的 `startServer` 启动单进程运行时。它强制监听 `127.0.0.1`，固定使用仓库忽略目录 `data/acceptance`，每次进程启动生成仅保存在内存中的 API/session 随机值，并清空调用环境中的真实模型配置。可使用 `ACCEPTANCE_PORT` 选择未占用回环端口；其他 `RAG_HOST`、`DATA_DIR`、`RUN_PROFILE` 或模型变量不能覆盖验收隔离边界。

T1.1 只建立构建、配置隔离、启动、关闭和错误传播入口。确定性 Mock、验收 Topic 和 `/api/acceptance` 分别由 T1.2、T1.3、T1.4 接入；普通 `npm start` 保持原有 local/team 真实运行路径，不能获得这些依赖。

自动化覆盖构建先于启动、空数据目录初始化、回环与目录强制、真实模型变量清空、非法端口、端口占用消息、依赖/未知错误脱敏以及普通 `npm start` 不变。
