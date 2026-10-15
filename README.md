# PI Agent Governance

共享治理核心＋本地MCP＋可移植Skill，提供独立浏览器控制台并保留PI-Desktop图形插件。保存任务进度、项目看板、源码架构与设计草案；项目数据仍在仓库文件中，各入口共享。

社区 ID：`io.github.tonkic.agent-governance`。仓库版本0.7.8；市场已发布0.7.0。本机安装不会自动升级；权限说明见 [发布说明](notes/release-0.7.0.md)。

## 开始使用

1. 在 PI-Desktop 插件页安装对应的 `plugin/dist/` 包并确认权限；开发时加载 `plugin/`。安装不会由本仓库自动执行。
2. 打开项目，在命令面板运行 `Agent Governance: 打开治理面板`。
3. 明确要开发的功能与检查条件；已有任务先调用 `status`，按 STATE 接续。

使用Codex、Claude Code或Pi：按 [MCP与Skill](docs/mcp.md) 配置本地stdio服务。也可启动 [本地Web控制台](docs/web-console.md)，浏览器管理同一项目，不依赖PI-Desktop、不从网页启动Agent。通用包和PI包分目标构建；1.x起稳定 `vX.Y.0` 主/次版本各发布一次GitHub Release，0.x/补丁/预发布仅CI，不自动发布npm、提交市场、安装或创建标签。

工作台三栏为待办/进行中/已完成。完成栏只展示近期5项，「查看全部」打开可搜索历史表格，数据不删除；全局搜索仍搜索全部。功能按分层文档实现并测试，通过后完成，没有独立验收。旧历史只读保留，见 [文档开发](docs/doc-driven.md)。

工作项可标记架构影响，默认不扫描源码或自动重分析；需要时手动核对来源。面板跟随宿主主工作区切换，旧草稿只读隔离保留，新项目须确认启用。规则见 [项目接口](docs/project.md)。

「分析架构」默认使用Architecture Copilot的源码现状模式；「设计方案」用同一Skill的设计模式，ASCII正文和画板同源，确定后沿用基线。两者不混写，Skill不可用则停止，不回退旧提示词。架构对普通功能开发仍可选。见 [架构分析与设计](docs/architecture-design.md)。

已结束会话的旧运行记录会在打开/刷新「分析进度」或开始新操作时核对宿主并同步，不需要手动先点结果；未知提交仍保留明确处理，不自动重发或后台轮询。

「行为文档」保留可读正文并展示关联场景的实际结果。完成依赖实际检查，不依赖单独验收；移动卡片不自动证明测试通过。本仓库运行 `npm run check:behaviors` 生成本机证据。

## 按问题阅读

- [文档索引](docs/README.md)：先定位专题，需要时再读参数和限制。
- [MCP 与 Skill](docs/mcp.md)：通用包、客户端配置、工具与安全边界。
- [治理用法](docs/governance.md)、[项目接口](docs/project.md)、[Git 协作](docs/git.md)。
- [文档维护](docs/documentation.md)：简短 Docs、Git 式 Notes、渐进式披露。
- [架构](docs/architecture.md)、[开发](docs/development.md)、[交付](docs/releasing.md)、[安装与发布](docs/publishing.md)。
- [变更记录](notes/README.md)、[Agent 规则](AGENTS.md)。当前授权只以 STATE 为准。

## 开发检查

需要 Node.js 22+。修改 TS 或 `docs/` 后重新构建；不手改 runtime、manifest 或安装包说明。

```powershell
npm ci
npm run typecheck
npm run build
npm test
```

构建不会推送、发布或安装。浏览器检查与生成目录见 [开发](docs/development.md)。

## 必要限制

安全写入仍需确认，过期或切换项目时拒绝。卡片状态和会话结束不自动证明测试结果。插件不拦截其它工具；提示词、路径和锁不是恶意并发安全沙箱。仅用于可信仓库。

旧 ID `pi.agent-governance` 不自动迁移：备份STATE和`.governance/`，停用旧插件后安装新ID。当前目录只保留当前可用包，旧包按需从对应Git提交取回；更新和权限由宿主管理。
