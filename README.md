# PI Agent Governance

PI-Desktop 本地插件：保存任务目标和进度，展示项目看板与源码架构，管理受管 Git 工作区。项目数据保存在仓库文件中，Agent 可以据此接手工作。

社区 ID：`io.github.tonkic.agent-governance`。本地版本 0.6.8；市场已发布版本 0.6.0。

## 安装与使用

1. 在 PI-Desktop 插件页安装 `plugin/dist/io.github.tonkic.agent-governance-0.6.8.piplug`，确认权限。开发时加载 `plugin/`。
2. 打开项目工作区，在命令面板运行 `Agent Governance: 打开治理面板`。
3. 向 Agent 提出目标与验收条件，例如：`使用 governance 初始化这个项目，保留已有文件。目标是修复搜索功能，验收是相关测试通过。`

三页导航：工作台、项目架构、Git 协作。工作台搜索和拖动工作项，点击查看详情，右键、长按或 Shift+F10 打开编辑、排序、迁移和指导菜单；总体任务在「项目目标与进度」中展开。切页保留草稿，切换编辑对象或关闭详情须确认丢弃。指导仅生成可复制文本，不启动 Agent。默认独立配色，跟随宿主明暗；顶部按钮可切宿主颜色并本地保存，不修改宿主设置。组件来源及许可见 [UI sources](plugin/UI-SOURCES.md)。

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
- 测试证据由调用方提交，插件不执行测试、不拦截其他工具、不自动调度 Agent。
- Node fs 和 Git execFile 不经过宿主文件/命令网关。仅用于可信仓库；锁和写前比较不能防御恶意并发写入。Git配置、worktree位置与恢复限制见 Git 协作说明。
- 更新安装由 PI-Desktop 管理。仓库构建不推送、不发布、不安装；发布成功也不代表实际宿主验收完成。
