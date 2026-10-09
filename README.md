# PI Agent Governance

PI-Desktop 本地插件：保存任务目标和进度，展示项目看板与源码架构，管理受管 Git 工作区。项目数据保存在仓库文件中，Agent 可以据此接手。

社区 ID：`io.github.tonkic.agent-governance`。本地版本 0.6.12；市场已发布版本 0.6.0。

## 开始使用

1. 在 PI-Desktop 插件页安装对应的 `plugin/dist/` 包并确认权限；开发时加载 `plugin/`。安装不会由本仓库自动执行。
2. 打开项目，在命令面板运行 `Agent Governance: 打开治理面板`。
3. 向 Agent 明确目标与验收条件；已有任务先调用 `status`，按 STATE 接续。

工作台提供四列看板和居中详情。顶部「项目任务 → 更新文档」整理当前项目的 `docs/`、`notes/`，先选模型再确认，不升级插件。Agent 任务需要 `desktop.control`，自选模型使用只读 `models.list`。

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

面板写入需确认；任务或工作区版本过期时拒绝。工作项完成、会话结束和调用方证据不等于总体真实验收。插件不拦截其他工具；提示词、路径门禁和文件锁不是恶意并发写入的安全沙箱。只用于可信仓库。

旧 ID `pi.agent-governance` 不自动迁移：备份 STATE 和 `.governance/`，停用旧插件后安装新 ID，保留旧包供回退。更新和权限由宿主管理。
