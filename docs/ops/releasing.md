# GitHub 交付 / Checked delivery

GitHub Release 仅由稳定主/次版本标签 `vX.Y.0`（X≥1，Y≥0）各创建一次，标签由人创建（策略 `stable-major-minor-tag-only`）。当前 **0.12.1** 对齐 Microsoft 文档写作标准并升级工作台视觉交互、数据微图与过渡动效，属于交互与文档补丁更新，不触发市场或 GitHub Release。

已批准产品更新按真实行为与契约判级升版：修复/交互/性能为 `patch`（不提交市场）；新增能力或 `0.x` 契约调整升 `minor`。大更新在完整检查、PI 官方包（于 PI-Desktop 执行 `PluginPack`）及 `main` 双 OS CI 通过后可核对版本并提交一次市场；未知写入不重试，不覆盖待审/已用版本，不自动安装、发 npm 或建标签。

## 开发与源码交付

1. 先读 `STATE.json`/`README.md` 并查 `status`/`git_status`；小任务在单一协调 worktree 直接实现，写入委派按 [Git协作](../guides/git.md) 分配独立 worktree。
2. 按影响同步维护 `docs/`（见 [文档维护](../guides/documentation.md)），并按 [开发范围](development.md#检查命令) 运行检查；公共/包/依赖改动跑一次 `npm run check -- --full`。
3. 审查 `git_diff` → `git_commit` → `git_verify`；提交或无变化合并不机械重跑测试，冲突解决或新增改动补测受影响部分。纯记录更新走 `records` 快路，不升版。
4. Antigravity 与 CLI 环境可直接完成全部源码、文档生成、全量测试与 `mcp-skills` 打包校验；涉及 `plugin/` 内容更新时，PI-Desktop `.piplug` 在 PI-Desktop 内由官方 `PluginCheck`/`PluginPack` 更新后再执行双目标发布校验。

## 更新级别与版本核对

- 每次产品更新同步修改 `package.json`、`package-lock.json` 与构建生成的 `plugin/manifest.json`。
- 提交遵循 `fix:`/`perf:`/`feat:`/`refactor!:` 语义前缀，可用只读工具核对：

```powershell
npm run update:plan -- --base BASE_FULL_SHA --head HEAD_FULL_SHA --check
npm run release:auto -- --plan
npm run release:auto
```

`release:auto` 仅做本地/CI 干净工作区、远端 URL、历史秘密扫描与标签资格核对，绝不执行 `git push`、建标签或网络发布。

## Action 合约

- `.github/workflows/test.yml` 在 `main` push / PR 按变更范围自动运行检查（记录/文档跑 Linux，公共改动跑 Linux＋Windows 完整单元与 Chromium 浏览器回归），不耦合 `.piplug` 重打包。
- `.github/workflows/release.yml` 仅监听合格 `vX.Y.0`（X≥1）标签 push：双系统运行 `npm run check -- --full --ci` 后执行 `npm run build:distributions`（同时要求 `mcp-skills` tgz 与已提交的官方 `.piplug` 校验通过），最终 `release` job 以最小 `contents:write` 权限单次创建 Release 并上传四项资产与 `SHA256SUMS`。
- 若目标 Release 已完整存在且哈希一致则只读跳过；部分存在或请求结果未知立即停止并保留构建日志，绝不覆盖、删除或自动重试。

## 保留的安全门禁

- 仅允许 `Tonkic/pi-agent-governance` 正常远端 URL，完整 40 位 SHA 且已跟踪工作区干净（仅豁免本机已忽略的 `.pi/` 与 `changes/archive/redesign-governance-panel/`）。
- 全历史秘密路径（`.secrets`、`.remote-local`）与凭据扫描保持启用；唯一历史测试夹具例外仍限定为 blob `d2c45515b924a1f69d92ef00b771e77b7318bbfe` 的两条合成令牌，实际环境变量令牌始终最高优先拦截。
- Windows 下生成产物（`plugin/runtime/`、`plugin/docs/`、`plugin/main.js`、`plugin/manifest.json`、`plugin/README.md`）仅在规范化内容与 HEAD/index 完全一致时刷新 stat。
