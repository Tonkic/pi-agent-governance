# MCP 与可移植 Skill

同一治理核心可通过本地 stdio MCP 使用，也可由 PI-Desktop 面板调用。STATE、看板、源码图、设计草案的数据格式不变；无需数据库或网络服务。

## 安装和启动

需要 Node.js 20+ 和 Git。从 GitHub Release 下载 `mcp-skills` 目标的 tgz，核对 SHA256SUMS，解压到可信工具目录。在解压后的 `package/` 中运行：

```powershell
npm ci --omit=dev --ignore-scripts
node build/mcp/server.js --workspace D:/projects/example
```

开发仓库先运行 `npm ci`、`npm run build`，再执行同一条 node 命令。不要把 `npm run build` 或带日志的包装脚本配置成 stdio 入口。

`--workspace` 必须是显式、已存在的绝对目录。不接受相对路径、额外参数、符号链接或自动切换项目。启动和查询不会自动初始化；用户明确授权后才调用 `governance` 的 `init` 动作。

服务在 stdin/stdout 上交换 MCP 消息；诊断仅写 stderr。单条输入缓冲上限1MiB，断开输入后退出。只连接可信本地客户端，不开放 HTTP 端口。

## 客户端配置

包中的 `mcp/clients/` 提供示例；把 node、server.js 和 workspace 三个路径改成实际绝对路径。Linux/macOS 可用 `/usr/bin/node`、`/opt/agent-governance/build/mcp/server.js`、`/home/me/project`，不要照搬 Windows 示例。

| 客户端 | 示例 | 合并位置 |
| --- | --- | --- |
| Codex | `codex.toml` | `~/.codex/config.toml` 的 `mcp_servers` |
| Claude Code | `claude-code.json` | 项目 `.mcp.json` 的 `mcpServers` |
| Pi | `pi.json` | `.pi/mcp.json` 或 `~/.pi/agent/mcp.json` 的 `mcpServers` |

保留既有配置，不覆盖其它服务。各客户端版本与信任/权限界面不同，按其官方说明启用；仓库不自动安装或配置客户端。这里提供配置示例，不声称已在各客户端完成端到端测试。

## 工具与 Skill

- `tools/list` 返回一个 `governance` 工具，参数为既有完整JSON schema；例如 `{"action":"status"}`。先读状态与项目README，只接续获批范围。
- 工具复用原核心的锁、来源指纹、修订、路径和Git范围检查。写项目数据先取 `project_snapshot.revision`；设计取 `architecture_design_snapshot.revision` 和明确启动的draftId。
- `resources/list` 列出固定的Architecture Copilot正文、来源、许可与参考资料。只读这些资源，不提供任意文件URI读取。
- `prompts/list` 提供 `architecture-analysis` 与 `architecture-design`，直接嵌入同一份Skill正文。取提示不运行Agent，不产生付费模型请求，也不授予写入权限。
- 如需客户端原生Skill发现，可手动把包中 `skills/architecture-copilot/` 完整目录放入该客户端支持的Skill目录；开发源在 `plugin/skills/architecture-copilot/`。保留LICENSE、SOURCE.md和references，不复制旧提示词作为第二来源。

源码分析与设计方案严格分开。MCP可在明确授权下创建/保存设计草案，但不提供基线确认、宿主模型选择、会话启动/中止或窗口接口；基线确认仍由PI面板人工进行。普通功能开发不强制架构设计或单独验收。

## 安全与排错

MCP客户端负责呈现写入权限与用户确认。Skill是方法指导，不是授权证明；测试与审批仍由调用方真实运行和陈述。不要向不可信Agent开放写入工具。

参数不符合schema时返回协议参数错误；核心拒绝操作时返回 `isError: true`，不回显可能含路径/敏感参数的Git错误。先重新查询状态和快照，检查工作区、范围、锁及最新revision；不要盲目重试写入。

这是可信仓库工具，不是恶意进程或并发文件替换的沙箱；不会拦截其它工具。多客户端写同项目时仍应串行处理明确的任务。不要把凭据放入工具参数、Skill或分发包。

构建和发布策略见 [交付](releasing.md)，扩展目标与官方PI包校验见 [安装与发布](publishing.md)。
