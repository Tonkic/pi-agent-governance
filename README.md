# PI Agent Governance

PI-Desktop 本地插件：保存任务目标和进度，展示项目看板与源码架构，管理受管 Git 工作区。项目数据保存在仓库文件中，Agent 可以据此接手。

社区 ID：`io.github.tonkic.agent-governance`。仓库版本 0.7.4；市场已发布版本 0.7.0。本机安装不会自动升级。累计变化和权限见 [发布说明](notes/release-0.7.0.md)。

## 开始使用

1. 在 PI-Desktop 插件页安装对应的 `plugin/dist/` 包并确认权限；开发时加载 `plugin/`。安装不会由本仓库自动执行。
2. 打开项目，在命令面板运行 `Agent Governance: 打开治理面板`。
3. 明确要开发的功能与检查条件；已有任务先调用 `status`，按 STATE 接续。

工作台只有三栏：待办 / 进行中 / 已完成。依据功能文档实现并测试，通过后完成，不再增加人工或Agent验收。旧验收记录保留为历史。文档分层与检查方法见 [文档开发](docs/doc-driven.md)。顶部「更新文档」整理当前项目说明，不升级插件。

工作项可标记架构影响，默认不扫描源码或自动重分析；需要时手动核对来源。面板跟随宿主主工作区切换，旧草稿只读隔离保留，新项目须确认启用。规则见 [项目接口](docs/project.md)。

架构设计是可选的。需要明确开发方向或架构可视化时，用Architecture Copilot与现有画板；确定后沿用基线，普通功能更新不重设计。Skill使用已批准的agent.prompt.inject，图不替代源码事实或授权范围。见 [可选架构设计](docs/architecture-design.md)。

「行为文档」保留可读正文并展示关联场景的实际结果。完成依赖实际检查，不依赖单独验收；移动卡片不自动证明测试通过。本仓库运行 `npm run check:behaviors` 生成本机证据。

## 按问题阅读

- [文档索引](docs/README.md)：先定位专题，需要时再读参数和限制。
- [治理用法](docs/governance.md)、[项目接口](docs/project.md)、[Git 协作](docs/git.md)。
- [文档维护](docs/documentation.md)：简短 Docs、Git 式 Notes、渐进式披露。
- [架构](docs/architecture.md)、[开发](docs/development.md)、[交付](docs/releasing.md)、[安装与发布](docs/publishing.md)。
- [变更记录](notes/README.md)、[Agent 规则](AGENTS.md)。当前授权只以 STATE 为准。

## 开发检查

需要 Node.js 20+。修改 TS 或 `docs/` 后重新构建；不手改 runtime、manifest 或安装包说明。

```powershell
npm ci
npm run typecheck
npm run build
npm test
```

构建不会推送、发布或安装。浏览器检查与生成目录见 [开发](docs/development.md)。

## 必要限制

安全写入仍需确认，过期或切换项目时拒绝。卡片状态和会话结束不自动证明测试结果。插件不拦截其它工具；提示词、路径和锁不是恶意并发安全沙箱。仅用于可信仓库。

旧 ID `pi.agent-governance` 不自动迁移：备份 STATE 和 `.governance/`，停用旧插件后安装新 ID，保留旧包供回退。更新和权限由宿主管理。
