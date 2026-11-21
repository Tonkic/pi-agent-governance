# MCP 与可移植 Skill

Antigravity、PI-Desktop、Codex、Claude Code 与 Pi 共用 [同一个只读浏览器工作台](web-console.md)；本地 stdio MCP 和 PI 连接器复用同一治理核心及 `STATE.json`/看板/源码图/设计数据，不新增数据库。开发、模型调用与文档维护留在原宿主会话。

## 安装和启动

需要 Node.js 22+ 和 Git。从 GitHub Release 下载 `mcp-skills` 目标的 tgz，核对 `SHA256SUMS`，解压到可信工具目录后运行：

```powershell
npm ci --omit=dev --ignore-scripts
node build/mcp/server.js --workspace D:/projects/example
```

开发仓库先运行 `npm ci`、`npm run build`，再执行同一条 `node` 命令；不要把 `npm run build` 或带日志的包装脚本配成 stdio 入口。

固定模式 `--workspace` 必须是显式、已存在的绝对目录。Claude Code 可改用 `--host claude-code` 自动读取官方 `CLAUDE_PROJECT_DIR`；缺失、相对、文件或链接路径均拒绝，不回退 cwd/home。普通连接不开放 HTTP，只有显式确认的 `governance_ui` `open` 才启动自有 loopback 工作台；断开或信号退出时自动回收服务。

## 客户端配置

包中 `mcp/clients/` 提供示例。只需把 `node`、工具路径和项目路径改为本机绝对路径（保留客户端原有其它 MCP 服务）：

| 客户端 | 示例 | 合并位置 |
| --- | --- | --- |
| Antigravity | `antigravity.json` | `~/.gemini/config/mcp_config.json` 的 `mcpServers`（工作区 `AGENTS.md` 自动作为规则生效） |
| Codex | `codex.toml` | `~/.codex/config.toml` 的 `mcp_servers` |
| Claude Code | `claude-code.json` | 项目 `.mcp.json` 的 `mcpServers` |
| Pi | `pi.json` | `.pi/mcp.json` 或 `~/.pi/agent/mcp.json` 的 `mcpServers` |

### 复用项目和当前会话

- **Antigravity**：打开项目目录即自动加载根 `AGENTS.md` 规则；合并 `antigravity.json` 指定 `--workspace` 后即可直接调用 `governance` 与 `governance_ui`，也可将 `plugin/skills/architecture-copilot/` 放入技能目录按需加载。
- **Claude Code**：`CLAUDE_PROJECT_DIR` 绑定启动项目，切换项目/worktree 后需重建对应 MCP 连接，不猜首个 root。
- **Codex / Claude Hook**：可将 `codex-hooks.json` 合并到信任的 `~/.codex/hooks.json` 或 `.codex/hooks.json`，由 `context-hook.js` 从官方 stdin 读取 `session_id`/`cwd`，将有界只读状态注入原会话（输入限 64KiB/3 秒，遇未初始化子 worktree 立即拒绝，不读聊天记录、不动态重绑 MCP）。
- 在原会话直接调用治理工具和 Architecture Copilot Skill，复用宿主已有历史、模型与思考设置；不调用外部 CLI 子会话，也不扫描私有凭据目录。

接口依据：[Claude MCP](https://code.claude.com/docs/en/mcp)、[Claude Hooks](https://code.claude.com/docs/en/hooks)、[Codex Hooks](https://developers.openai.com/codex/hooks)。

## 工具与 Skill

- `tools/list` 返回 `governance`（完整治理、看板、源码图、设计草案与受管 Git schema）和 `governance_ui`（`open`/`close`/`status`，打开与关闭需 `confirmed: true`）。
- 写项目数据先取 `project_snapshot.revision`；写架构草案先取 `architecture_design_snapshot.revision` 与明确发起的 `draftId`。
- `resources/list` 与 `prompts/list`（`architecture-analysis`、`architecture-design`）提供固定只读的 Architecture Copilot 正文、来源、MIT 许可与参考资料；读取提示不调用模型、不授予写入权限。
- 源码现状图与设计草案严格分开；普通功能直接按 [文档开发](../guides/doc-driven.md) 实现与测试，不强制先做架构设计。

## 安全与排错

MCP 客户端负责呈现工具权限与确认；请勿向不可信 Agent 开放写入工具。参数不符返回协议错误，核心门禁拒绝时返回 `isError: true` 且不回显敏感路径。遇到拒绝先重读 `status` 与最新 snapshot，核对范围、锁与 `revision`，不盲目重试。构建与双宿主交付见 [交付](../ops/releasing.md)、[安装与发布](../ops/publishing.md)。
