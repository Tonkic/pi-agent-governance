# 产物与安装 / Distributions

支持**通用 MCP＋Skills＋本地 Web 工作台包**（兼容 **Antigravity**、Codex、Claude Code、Pi）与 **PI-Desktop 官方 `.piplug` 安装包**。当前版本 **0.12.1** 对齐 Microsoft 文档写作风格，并全面升级前端按钮触感、数据微图可视化与无障碍动效；见 [交付规则](releasing.md)。

插件与通用包均内置本地只读浏览器服务和界面，日常使用无需克隆本源码仓库。GitHub 协作绑定与推送日志仅保存在忽略的 `.remote-local/`，不进入任何分发包；见 [权威协作](../guides/collaboration.md)。

## 构建目标

在干净、已构建且已审查的提交上执行：

```powershell
# 先完成对应范围检查；公共改动与版本交付跑一次完整检查
npm run check -- --full
# 在 Antigravity / 任意本地开发环境可单独构建并验证通用 MCP/Skills 包
npm run build:distributions -- mcp-skills
# 在已使用官方 PluginPack 更新 plugin/dist/*.piplug 后，可构建并核对全部双目标产物
npm run build:distributions
```

输出位于忽略的 `build/distributions/`，未知文件或符号链接立即阻塞。普通 `npm run build` 会清理 `build/`，请先跑完检查再生成分发包。

| 目标 | 输出与双宿主分工 |
| --- | --- |
| `mcp-skills` | `agent-governance-mcp-skills-VERSION.tgz`；由 `npm pack --ignore-scripts` 生成，供 Antigravity / CLI 宿主直接使用，不发 npm |
| `pi-desktop` | `io.github.tonkic.agent-governance-VERSION.piplug`；严格校验 `plugin/dist/` 中由 PI-Desktop 官方 `PluginPack` 生成的已提交包，禁止用脚本自制 |
| 两者共同输出 | `asset-manifest.json` 与 `SHA256SUMS`，绑定版本、完整来源 SHA、大小与 SHA256 |

通用包内置 `npm-shrinkwrap.json`（由根锁文件派生）、MCP/Web/协作入口、共享治理核心、规范 Skill（含许可与参考资料）、`mcp/clients/`（含 `antigravity.json`、`codex.toml`、`claude-code.json`、`pi.json`）及只读工作台静态资源；排除宿主私有数据与测试文件。

## 通用包安装（Antigravity / Codex / Claude Code / Pi）

1. 校验 `SHA256SUMS`，解压到可信目录（需 Node.js 22+ 与 Git），在 `package/` 下运行 `npm ci --omit=dev --ignore-scripts`。
2. 按 `mcp/clients/` 示例将 `node`、`build/mcp/server.js` 和项目绝对路径合并到宿主配置（Antigravity 合并至 `mcp_config.json`，并自动读取项目 `AGENTS.md`）。
3. 可选将 `plugin/skills/architecture-copilot/` 复制到宿主支持的技能目录。
4. 在原会话请求调用 `governance_ui`（`action: "open", confirmed: true`）打开只读浏览器工作台；详细配置见 [MCP与Skill](../start/mcp.md)。

## PI-Desktop 官方包检查

Community ID：`io.github.tonkic.agent-governance`；源码仓库：`Tonkic/pi-agent-governance`。

1. 在 Antigravity 或本地完成源码、生成文档（`plugin/docs/`）与 `npm run check -- --full` 检查（测试与日常 `Tests` CI 不依赖提前重打 `.piplug`）。
2. 需要交付或更新 PI-Desktop 插件时，在 PI-Desktop 内运行官方 **PluginCheck / PluginPack** 生成当前版本 `.piplug` 并提交至 `plugin/dist/`，不得用脚本伪造 ZIP。
3. `verifyPi` 与发布 CI 会逐文件比对 ZIP 条目、版本、`manifest.json` 权限与最新源码（仅容许 CRLF→LF 归一化），不一致立即拦截。

## 安装与更新边界

- PI-Desktop 用户在插件页手动安装/更新并确认权限（`ui.panel`/`ui.view` 仅用于轻量打开入口，`shell.openExternal` 仅打开本地私有工作台链接），不自动静默安装。旧 ID `pi.agent-governance` 升级前先备份 `STATE.json` 与 `.governance/` 并停用旧插件。
- `0.11.0+` 已从源码和清单彻底移除 `ssh2` 动态 `eval` 依赖；待在 PI-Desktop 用官方 `PluginPack` 生成当前版本包并同步 `main` CI 后，可按正常规则核对并提交一次市场。
