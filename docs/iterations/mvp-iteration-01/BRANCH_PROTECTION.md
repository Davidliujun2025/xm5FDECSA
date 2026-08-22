# T6.5 GitHub 分支保护配置说明

状态：待执行。分支保护必须在 GitHub 远端配置，而本轮约束为「不执行一切推送到远端仓库的
操作」，因此本项由项目负责人在推送 `codex/acceptance-handoff` 并创建 Draft PR 之后，在
GitHub 网页端完成，所需开关如下。

## 配置位置

仓库 `Davidliujun2025/xm5FDECSA` → Settings → Rules → Rulesets（或 Branches → Branch
protection rules）→ 新建规则，Branch name pattern 填 `main`。

## 必需开关

| 设置 | 值 |
|---|---|
| Require a pull request before merging | 开启，要求至少 1 次批准 |
| Require status checks to pass before merging | 开启，添加 required check：`Windows Node 24 gate` |
| Restrict who can push to matching branches | 开启，仅项目负责人 |
| Allow force pushes / deletions | 关闭 |

- `Windows Node 24 gate` 是 `.github/workflows/test.yml` 中 windows-latest Job 的 `name`，
  与 required check 名称必须完全一致。
- 不添加任何第二台 Windows 相关 check；第二台 Windows 验收不阻塞本轮合并（v1.1 建议）。
- Draft PR 必须先转为 Ready 才能满足上述规则合并；Ubuntu Job 仅作补充，不是 required check。

## 验收方式

- main 无法直接推送（需要 PR）。
- 未通过 Windows CI 或没有 1 次代码审查的 PR 无法合并。
- 完成设置后在本 TODO 勾选 T6.5 并记录设置时间。
