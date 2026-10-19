# 架构

一个浏览器工作台、共享治理核心，PI/MCP是薄宿主连接器。STATE和项目数据保留在仓库；会话历史、模型和思考设置保留在原宿主，不新增上下文数据库或常驻桌面。

## 模块与代码入口

以下路径相对plugin/。阅读修改TS，不手改生成runtime。

| 文件 | 职责 | 入口 |
| --- | --- | --- |
| `main.ts` | PI工具/浏览器命令、可信调用会话绑定、工作区事件和卸载 | `onLoad`、`workspaceRoot` |
| `workbench-tool.ts` | PI/MCP共用open/close/status及确认校验，无路径/URL参数 | `invokeWorkbench` |
| `entry-bridge.ts`、`entry/` | Alt+空格和右侧插件视图共用轻量页，只读连接状态与版本绑定的显式打开 | `entryBridge`、`entry.js` |
| `workbench.ts` | 单服务所有权、串行打开、切换/关闭/在途撤销 | `BrowserWorkbench` |
| `browser.ts` | loopback HTTP、固定资产/API、认证与有界页面租约 | `startBrowserConsole` |
| `browser-open.ts` | 固定平台打开器、严格本地URL、有界超时 | `openBrowser` |
| `tool.ts`、`core.ts` | 治理schema、STATE、验证、归档和锁 | `Governance.run` |
| `panel.ts` | UI动作白名单、确认与修订校验，不依赖PI | `panelInvoke` |
| `project.ts`、`design.ts` | 看板/指纹与独立设计草案/追加基线 | `ProjectData.run`、`ArchitectureDesign.run` |
| `git.ts` | worktree、范围与提交验证 | `GitGovernance.run` |
| `git-history.ts`、`renderer/git-history.ts` | 有界本地历史/第一父提交文件差异，快照隔离及只读提交DAG/二级详情；与写入型Git登记分开 | `gitHistory`、`governance.gitHistory` |
| `operations.ts` | 保留历史兼容实现；当前PI入口仅使用localSession身份过滤 | `localSession` |
| `behaviors.ts` | 安全读取行为正文/关联/本机证据 | `behaviorSnapshot` |
| `documents.ts`、`renderer/documents.ts` | 受限Markdown元数据/正文只读与安全DOM阅读、标题导航；无锁或初始化写入 | `documents`、`governance.documents` |
| `renderer/` | 同一工作台、双语、图布局及设计画板 | `panel.ts`、`graph.ts`、`design.ts` |

## 调用关系

```text
PI治理工具 → main.ts → core.ts → STATE / .governance
MCP治理工具 → mcp/server.ts → tool.schema → core.ts
PI命令 / PI或MCP governance_ui → workbench-tool → BrowserWorkbench
BrowserWorkbench → browser.ts → 127.0.0.1 + 私有片段URL → 系统浏览器
浏览器 → web/bridge.js → browser.ts白名单 → panel.ts → core.ts
人工CLI → web/server.ts薄wrapper → 同一个browser.ts
浏览器文档阅读 → panel.ts → documents.ts → 固定根Markdown / docs / notes（只读）
MCP资源/提示、PI Skill → skills/architecture-copilot/
core.ts → git.ts → Git common directory
```

PI工具只用可信ToolExecContext.sessionId的有界session/get核实项目，缺失/外来/不支持会话拒绝；显式命令用宿主可见项目。工作区事件撤销旧服务，不重定向旧能力。PI只通过公开shell.openExternal打开自身生成地址，不调用Agent/create/prompt/abort或models.list。

MCP固定绑定显式绝对项目或Claude官方启动项目环境。普通连接/状态/资源读取不监听HTTP、不自动初始化。确认open才启动；断开输入/传输、信号关闭时撤销在途打开并dispose。只读context-hook读取官方session_id/cwd，将有界状态带回原会话，不读历史或动态重绑MCP。见 [MCP](mcp.md)。

BrowserWorkbench同项目复用服务，切换先关闭，启动前后/打开前复核身份。close/dispose立即失效在途请求，迟到服务回收。结果与错误不含私有URL。页面租约限制16个，心跳/TTL/退出宽限与服务连接超时均有界。独立CLI直到Ctrl+C，不套用宿主页生命周期。

HTTP只监听127.0.0.1，精确Host/Origin/token/JSON及固定资源/动作白名单。复用renderer和原确认/修订/范围/锁，不提供Agent/model/session或任意Git写入。凭据不落盘，片段由浏览器移入标签页sessionStorage。参数和租约配置不从工具/网页接受任意路径或URL。见 [浏览器工作台](web-console.md)。

## 数据位置

| 位置 | 内容 |
| --- | --- |
| `STATE.json` | 总目标、范围、条件、进度和阻塞 |
| `.governance/board.json` | 三栏工作项与保留的旧检查历史 |
| `.governance/architecture.json` | 源码图与指纹，不是设计 |
| `.governance/architecture-design.json` | 独立草案和人工确认历史，不是实现证据 |
| `.governance/operations.json` | 如存在则为旧会话操作记录；统一入口不新建或重放 |
| `docs/behavior-bindings.json`、Markdown | 可读行为与固定场景关联 |
| `.governance/behavior-evidence.json` | 忽略的本机实际检查证据，不代表整体通过 |
| Git common directory的 `pi-governance/` | 本机任务/worktree/提交验证登记 |

没有新增服务/聊天注册表，私有URL只在拥有服务和浏览器内存。PI的ui.panel/contributes.views指向同一entry/index.html，只有状态/刷新/打开按钮；onPanelInvoke仅governance.entry状态和确认打开，拒绝核心/会话操作。版本绑定可见项目与代次，迟到/切换请求拒绝；不接受路径/URL，不返回origin/私有片段。不是第二套业务工作台。

## 限制

仅用于可信仓库；锁/路径不防恶意并发。测试由调用方实际执行和陈述，卡片/会话结束不证明检查通过。浏览器和安装权限由宿主/系统管理，不支持时明确拒绝，不访问私有API/数据库。SSH/WSL等不保证用户本机浏览器可达。

功能按 [分层文档](doc-driven.md) 实现和测试；[架构设计](architecture-design.md) 可选。构建见 [开发](development.md)，动作见 [治理](governance.md)、[项目](project.md)、[Git](git.md)。
