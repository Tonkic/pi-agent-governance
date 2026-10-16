# MCP 与可移植 Skill

同一治理核心可通过本地 stdio MCP 使用，也可由 PI-Desktop 面板调用。STATE、看板、源码图、设计草案的数据格式不变；无需数据库或网络服务。

## 安装和启动

需要 Node.js 22+ 和 Git。从 GitHub Release 下载 `mcp-skills` 目标的 tgz，核对 SHA256SUMS，解压到可信工具目录。在解压后的 `package/` 中运行：

```powershell
npm ci --omit=dev --ignore-scripts
node build/mcp/server.js --workspace D:/projects/example
```

开发仓库先运行 `npm ci`、`npm run build`，再执行同一条 node 命令。不要把 `npm run build` 或带日志的包装脚本配置成 stdio 入口。

固定模式`--workspace`必须是显式、已存在的绝对目录。Claude Code可改用`--host claude-code`，由服务内部读取官方MCP子进程环境`CLAUDE_PROJECT_DIR`，无需再填项目路径；缺失、相对、文件或链接路径均拒绝，不回退cwd/home/工具目录。两种模式互斥，均不自动初始化或切换；明确授权后才调用`init`。

服务在 stdin/stdout 上交换 MCP 消息；诊断仅写 stderr。单条输入缓冲上限1MiB，断开输入后退出。只连接可信本地客户端，不开放 HTTP 端口。

## 客户端配置

包中`mcp/clients/`提供示例。只把node和工具安装路径改成实际绝对路径；Claude示例自动绑定宿主启动项目，Codex/Pi固定MCP示例还需指定workspace。Linux/macOS使用本机路径，不照搬Windows示例。

| 客户端 | 示例 | 合并位置 |
| --- | --- | --- |
| Codex | `codex.toml` | `~/.codex/config.toml` 的 `mcp_servers` |
| Claude Code | `claude-code.json` | 项目 `.mcp.json` 的 `mcpServers` |
| Pi | `pi.json` | `.pi/mcp.json` 或 `~/.pi/agent/mcp.json` 的 `mcpServers` |

保留既有配置，不覆盖其它服务。各客户端版本与信任/权限界面不同，按其官方说明启用；仓库不自动安装或配置客户端。这里提供配置示例，不声称已在各客户端完成端到端测试。

### 复用项目和当前会话

- Claude Code的`CLAUDE_PROJECT_DIR`是启动项目，不随会话中的cd自动改变。进入另一项目/worktree后重建对应MCP连接；不把roots中的第一项或额外授权目录当活动项目。旧版未提供该环境时明确失败，可人工配置固定模式。
- Codex可将`codex-hooks.json`的hooks合并到官方`~/.codex/hooks.json`或受信项目`.codex/hooks.json`，只替换helper安装路径，保留已有hooks并按宿主要求审阅信任。SessionStart/UserPromptSubmit从官方stdin读取session_id/cwd，将有界只读状态注入原会话；不读transcript_path，不持久化会话注册表、不初始化、不调用模型。helper也支持`--host claude-code`的同类Hook。
- Hook从cwd向上找最近STATE，遇未初始化的checkout/worktree立即拒绝，不串回父仓库；输入限64KiB/3秒，不接受缺失身份或链接。它是只读上下文提示，不是MCP动态重绑器或写入授权；普通MCP仍绑定启动项目。
- 在已加载的原会话继续调用治理工具/Architecture Copilot Skill，即使用宿主已有上下文与模型；不调用codex exec、claude -p或另开SDK聊天。Claude Skill不应设context:fork。这里不提供各CLI原生插件安装器或新上下文数据库。
- 首次加载/重载依客户端版本；Codex原生插件安装后官方要求新session，不静默代办。CLI/IDE/cloud/WSL/SSH能力不同，本地Hook不证明通用内嵌面板或远程localhost可达。当前验证为真实SDK/本地进程fixtures，非各客户端安装后端到端验收。

接口依据：[Claude MCP](https://code.claude.com/docs/en/mcp)、[Claude Hooks](https://code.claude.com/docs/en/hooks)、[Codex Hooks](https://developers.openai.com/codex/hooks)。不扫描`~/.codex`/`~/.claude`私有会话或凭据。

## 工具与 Skill

- `tools/list` 返回一个 `governance` 工具，参数为既有完整JSON schema；例如 `{"action":"status"}`。先读状态与项目README，只接续获批范围。
- 工具复用原核心的锁、来源指纹、修订、路径和Git范围检查。写项目数据先取 `project_snapshot.revision`；设计取 `architecture_design_snapshot.revision` 和明确启动的draftId。
- `resources/list` 列出固定的Architecture Copilot正文、来源、许可与参考资料。只读这些资源，不提供任意文件URI读取。
- `prompts/list` 提供 `architecture-analysis` 与 `architecture-design`，直接嵌入同一份Skill正文。取提示不运行Agent，不产生付费模型请求，也不授予写入权限。
- 如需客户端原生Skill发现，可手动把包中 `plugin/skills/architecture-copilot/` 完整目录放入该客户端支持的Skill目录；与开发源路径相同。保留LICENSE、SOURCE.md和references，不复制旧提示词作为第二来源。

源码分析与设计方案严格分开。MCP可在明确授权下创建/保存草案，不提供基线确认、宿主模型或会话/窗口控制。基线由PI面板或 [本地Web控制台](web-console.md) 人工审阅确认；网页与MCP绑定同一项目并手动刷新。普通功能不强制架构设计或单独验收。

## 安全与排错

MCP客户端负责呈现写入权限与用户确认。Skill是方法指导，不是授权证明；测试与审批仍由调用方真实运行和陈述。不要向不可信Agent开放写入工具。

参数不符合schema时返回协议参数错误；核心拒绝操作时返回 `isError: true`，不回显可能含路径/敏感参数的Git错误。先重新查询状态和快照，检查工作区、范围、锁及最新revision；不要盲目重试写入。

这是可信仓库工具，不是恶意进程或并发文件替换的沙箱；不会拦截其它工具。多客户端写同项目时仍应串行处理明确的任务。不要把凭据放入工具参数、Skill或分发包。

构建和发布策略见 [交付](releasing.md)，扩展目标与官方PI包校验见 [安装与发布](publishing.md)。
