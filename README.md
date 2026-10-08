# PI Agent Governance

PI-Desktop 本地插件：保存任务目标和进度，展示项目看板与源码架构，管理受管 Git 工作区。项目数据保存在仓库文件中，Agent 可以据此接手工作。

社区 ID：`io.github.tonkic.agent-governance`。本地版本 0.6.10；市场已发布版本 0.6.0。

## 安装与使用

1. 在 PI-Desktop 插件页安装 `plugin/dist/io.github.tonkic.agent-governance-0.6.10.piplug`，确认权限。开发时加载 `plugin/`。任务执行需 `desktop.control`；模型选择新增只读 `models.list`。
2. 打开项目工作区，在命令面板运行 `Agent Governance: 打开治理面板`。
3. 向 Agent 提出目标与验收条件，例如：`使用 governance 初始化这个项目，保留已有文件。目标是修复搜索功能，验收是相关测试通过。`

工作台分为待办、正在进行、已完成、已验收四列。页面级按钮集中在顶部操作面板，按「页面操作」「项目任务」「显示设置」「画布」分类，随当前页面显示；卡片编辑/验收仍贴近对象。开始分析、重新分析架构和Agent验收先打开启动设置，选择宿主可用模型及其支持的思考强度，再确认运行。也可明确使用宿主默认；选择仅用于本次新会话，不修改宿主设置。刷新只重读已有数据。验收证据、修改后失效及项目总体验收守卫保留。[项目接口与限制](plugin/PROJECT.md)、[组件来源及许可](plugin/UI-SOURCES.md)。

已有任务时先调用 `status`，按 `STATE.json` 接续工作。基本流程为 `status → start（需要时）→ 开发与检查 → verify → close`。看板完成不代表总体验收通过。

本项目已保存手动自动化任务「接续项目：已批准待办」。在 PI-Desktop 自动化中点一次运行，Agent 根据 STATE/看板连续执行可执行项，不需要反复写“继续”。没有活动授权、完成、需要审批或遇真实阻塞时停止；不定时、不自动安装。见 [开发说明](docs/development.md)。

旧 ID `pi.agent-governance` 不会自动迁移。先备份 STATE 与 `.governance/`，停用旧插件，再安装新 ID；不需要删除项目数据。保留旧包供回退。

## 代码入口

先看 `plugin/main.ts` 的入口，再看 `plugin/core.ts` 的 `run()` 分派。任务动作在同文件的具名方法中；看板与架构在 `project.ts`，Git 协作在 `git.ts`。界面入口是 `renderer/panel.ts`，面板操作校验在 `panel.ts`。

| 路径 | 内容 |
| --- | --- |
| `plugin/*.ts`、`plugin/renderer/` | 插件源码及静态资源 |
| `plugin/runtime/` | 生成的运行 JS，不手改 |
| `scripts/`、`test/` | 构建、交付工具与测试源码 |
| `build/` | Git 忽略的 CLI、测试与编译中间文件 |
| `docs/` | 稳定用法与架构说明 |
| `notes/`、`changes/` | 决策、验收证据与历史归档 |
| `STATE.json`、`.governance/` | 当前任务、看板与项目架构数据 |

## 开发

需要 Node.js 20+。修改 TS 后重新构建，不直接修改 runtime 或 manifest。

```powershell
npm ci
npm run typecheck
npm run build
npm test
'{"action":"status"}' | node build/scripts/governance.js
```

浏览器检查、输出目录及修改定位见 [开发说明](docs/development.md)。宿主只加载 JS；插件没有第三方运行时依赖，不需要 Web 服务或数据库。

## 文档

- [文档入口](docs/README.md)：Microsoft 写作指南、架构和开发说明。
- [工具用法](plugin/README.md)、[项目数据](plugin/PROJECT.md)、[Git 协作](plugin/GIT.md)：参数、行为与限制。
- [交付流程](scripts/RELEASING.md)：小更新同步 GitHub并集成 main；主/次版本升级另发布市场。检查后清理已合并临时分支。
- [市场发布说明](plugin/PUBLISHING.md)：凭据、旧 ID 迁移和提交方式。
- [Agent 入口](AGENTS.md)：执行规则。当前目标、范围和阻塞只以 STATE 为准。

## 限制

- 面板写入需确认；版本过期或工作区切换后拒绝写入。刷新不会自动保存表单，也没有后台轮询。
- 宿主语言决定界面语言，切换后重开面板。用户数据和底层诊断原文不翻译。
- 架构图保存源码依据和指纹，不是运行时监控；源码变化后须重新核对。
- 验收证据由调用方声明，不是独立认证。按钮经确认后可发起分析/验收 Agent 会话，不拦截其他工具、不后台轮询；会话结束不自动代表验收通过。
- Node fs 和 Git execFile 不经过宿主文件/命令网关。仅用于可信仓库；锁和写前比较不能防御恶意并发写入。Git配置、worktree位置与恢复限制见 Git 协作说明。
- 更新安装由 PI-Desktop 管理。仓库构建不推送、不发布、不安装；发布成功也不代表实际宿主验收完成。
