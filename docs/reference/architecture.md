# 架构

一个只读浏览器工作台与共享治理核心，同时兼容 **Antigravity / CLI（经本地 stdio MCP + Skills）** 与 **PI-Desktop（薄宿主插件连接器）**。开发、项目操作与文档同步维护在原 AI 宿主完成；`docs/` 是当前功能与架构唯一事实源，`notes/` 仅按需追溯。数据留在仓库内，不新增外部数据库。

## 模块与代码入口

以下路径相对 `plugin/`；日常阅读与修改 TS 源码，不手改构建生成的 `runtime/`。

| 文件 | 职责 | 入口 |
| --- | --- | --- |
| `main.ts` | PI 工具/命令注册、可信调用会话绑定、工作区切换回收与卸载 | `onLoad`、`workspaceRoot` |
| `workbench-tool.ts` | PI 与 MCP 共用的 `open`/`close`/`status` 确认工具，不接受路径或 URL 参数 | `invokeWorkbench` |
| `entry-bridge.ts`、`entry/` | PI 启动器与右侧插件视图共用的轻量状态/打开入口页 | `entryBridge`、`entry.js` |
| `workbench.ts` | 单服务所有权、串行打开、项目切换关闭与在途请求撤销 | `BrowserWorkbench` |
| `browser.ts`、`browser-open.ts` | `127.0.0.1` HTTP 服务、只读 API/静态白名单、会话凭据与页面租约、系统浏览器打开器 | `startBrowserConsole`、`openBrowser` |
| `tool.ts`、`core.ts` | 治理 schema、`STATE.json`、文档行数预算、验证指纹、归档与文件锁 | `Governance.run` |
| `panel.ts` | 面板通道分派与守卫；浏览器侧由 `browser.ts` 进一步收紧为纯只读白名单 | `panelInvoke` |
| `project.ts`、`design.ts` | 三栏看板、源码指纹图与独立架构设计草案/ASCII 基线解析 | `ProjectData.run`、`ArchitectureDesign.run` |
| `git.ts` | 受管分支/worktree、范围校验、提交审查、验证与协调集成 | `GitGovernance.run` |
| `git-history.ts`、`renderer/git-history.ts` | 本地提交 DAG 批次读取、第一父差异与只读弹窗详情 | `gitHistory`、`governance.gitHistory` |
| `operations.ts` | 保留底层历史兼容实现；现行 PI 入口仅调用 `localSession` 核实本地会话身份 | `localSession` |
| `behaviors.ts` | 读取编号说明、绑定配置与本机隔离浏览器检查证据 | `behaviorSnapshot` |
| `documents.ts`、`renderer/documents.ts` | 受限 Markdown 扫描、正文安全渲染与内部链接/标题定位（无写入） | `documents`、`governance.documents` |
| `collaboration-cli.ts`、`collaboration.ts`、`collaboration-program.ts` | 显式 GitHub 分支绑定优先解析、隔离 bare 仓库权威文档读取与独立分支推送/核对 | `collaborate`、`authority`、`collaborationProgram` |
| `renderer/` | 四页只读工作台（看板、架构、Git、文档），`panel` 管隔离读取，`shell` 管共享壳层 | `panel.ts`、`shell.ts`、`graph.ts`、`design.ts` |

样式按序分层：`tokens.css`（语义变量）→ `panel.css`（基础控件）→ `shell.css`（导航与顶栏）→ `views.css`（业务视图）→ `documents.css` / `help.css`。

## 调用关系

```text
Antigravity / Codex / Claude / Pi → mcp/server.ts → tool.schema → core.ts → STATE / .governance
PI-Desktop 工具 → main.ts → core.ts → STATE / .governance
PI 命令 / PI 或 MCP governance_ui → workbench-tool → BrowserWorkbench → browser.ts (127.0.0.1)
浏览器只读请求 → renderer 白名单 → web/bridge.js 白名单 → browser.ts 只读白名单 → panel.ts
人工独立 CLI → web/server.ts → browser.ts
文档阅读 → panel.ts → documents.ts → 根说明 / docs / notes（只读）
MCP 资源/提示、宿主 Skill → skills/architecture-copilot/
受管 Git → core.ts → git.ts → Git common directory (pi-governance/)
GitHub 权威协作 CLI → collaboration.ts (.remote-local/github.json) → 临时隔离 bare 仓库
```

PI 工具通过可信 `sessionId` 核实本地项目；MCP 固定绑定显式 `--workspace`（如 Antigravity/Codex/Pi）或 `--host claude-code` 启动环境，见 [MCP](../start/mcp.md)。HTTP 仅监听 `127.0.0.1`，校验精确 `Host`/`Origin`/随机凭据，拒绝一切写入，见 [工作台](../start/web-console.md)。

## 数据位置

| 位置 | 内容 |
| --- | --- |
| `STATE.json` | 当前任务目标、范围、约束、进度与总体阻塞 |
| `.governance/board.json` | 三栏工作项与历史完成记录 |
| `.governance/architecture.json`、`architecture-design.json` | 源码事实图与独立架构草案/确认历史 |
| `docs/behavior-bindings.json`、`.governance/behavior-evidence.json` | 编号行为绑定与忽略的本机浏览器证据 |
| Git common directory 下 `pi-governance/` | 本机受管 worktree 与提交验证登记 |
| `.remote-local/` | 忽略的 GitHub 无秘密绑定、推送 `unknown` 日志与临时 bare 缓存（无内置 SSH 凭据库） |

## 限制

仅用于可信本地仓库；文件锁与路径限制不充当恶意并发沙箱。开发闭环见 [分层文档](../guides/doc-driven.md)，构建见 [开发](../ops/development.md)，接口见 [治理](governance.md)、[项目](project.md)、[Git](../guides/git.md)。
