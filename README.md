# PI Agent Governance

**所有宿主共用一个只读浏览器工作台与共享治理核心。** 同时兼容 **Antigravity**、**PI-Desktop**、Codex、Claude Code 与 Pi；浏览器只读查看工作看板、项目架构、Git 和项目文档，开发与文档同步维护留在原 AI 宿主会话完成。

社区 ID：`io.github.tonkic.agent-governance`。仓库版本 **0.12.0**：将 `docs/` 重构为人类易读的四类意图子目录（`start/`、`guides/`、`reference/`、`ops/`），升级工作台视觉与「项目文档」分类标题导航/四象限选读面板，并同步更新 `0.12.0` 真实双宿主源码架构图。见 [文档开发](docs/guides/doc-driven.md)、[维护原则](docs/guides/documentation.md) 与 [交付规则](docs/ops/releasing.md)。

## 开始使用

1. **Antigravity**、Codex、Claude Code 或 Pi：按 [MCP与Skill](docs/start/mcp.md) 合并 `mcp/clients/` 下的本地 stdio 配置（Antigravity 使用 `antigravity.json`，并自动加载工作区 `AGENTS.md`）。在原会话请求打开工作台，调用 `governance_ui`：`{"action":"open","confirmed":true}`。
2. **PI-Desktop**：手动安装 `plugin/dist/` 官方包并确认权限。打开项目后，按 **Alt+空格**搜索“Agent 项目治理”，或从**右侧工作面板插件列表**选“项目治理工作台”点击打开；也可按 **Ctrl+Shift+P** 直接打开。
3. **统一面向文档工作流**：人在 `docs/` 明确功能与边界、在 `STATE.json` 批准范围；Agent 先读 `status` 与对应 `docs/` 专题，实现并运行检查后在同一轮最小更新 `docs/`。未初始化项目也可只读浏览已有文档。
4. **GitHub 权威协作**：多端共用仓库时，用 `collaboration-cli` 显式绑定仓库及权威分支；未绑定按本地工作区处理，已绑定遇网络故障不降级。本地按受管 Git 检查提交后推独立分支提 PR，详见 [协作指南](docs/guides/collaboration.md)。

浏览器只查看项目数据，不写项目、不创建聊天或调用模型。PI 工具绑定可信调用会话项目；Claude MCP 可读取官方 `CLAUDE_PROJECT_DIR`；Antigravity、Codex、Pi 的 stdio MCP 显式绑定项目目录。详见 [项目接口](docs/reference/project.md)。

`governance_ui` 支持 `status` 及需确认的 `open`、`close`。同项目复用服务；切换、卸载、MCP 断开或页面租约到期自动回收。独立手动启动见 [浏览器工作台](docs/start/web-console.md)。PI 的 `ui.panel`、`ui.view` 仅挂载同一轻量状态入口，点击才用 `shell.openExternal` 打开本地链接，不内嵌业务面板。

## 工作方式

三栏为待办/进行中/已完成。功能按分层文档实现并实际测试，通过即完成，不设独立二次验收。完成栏默认显示近期 5 项，「查看全部」可搜索全部历史。见 [文档开发](docs/guides/doc-driven.md)。

四页共用导航和顶部栏。桌面默认 64px 图标栏，悬停或聚焦覆盖展开；“项目文档”搜索阅读根说明及 `docs/`、`notes/` Markdown，支持字号、专注阅读和内部链接跳转。Docs 是当前功能与架构依据，Notes 仅按需追溯历史。外部修改后手动刷新，见 [阅读范围与限制](docs/start/web-console.md#项目文档阅读)。

Git 页展示上新下旧的真实提交图：`main` 第一父链固定居中，常驻只标主轴和 `HEAD`，其余分支/标签移到悬停与键盘摘要，点击查看提交与文件差异。仅本地只读，详见 [图与限制](docs/guides/git.md#浏览器提交图)。

架构设计可选，在原宿主使用 Architecture Copilot 发起和保存草案；浏览器仅只读查看源码事实图、草案/基线/历史及 ASCII 画板。见 [架构分析与设计](docs/reference/architecture-design.md)。

## 按问题阅读

- [文档索引](docs/README.md)：按问题定位专题，不必逐层打卡。
- [文档开发](docs/guides/doc-driven.md)、[文档维护](docs/guides/documentation.md)：人写/审文档与 Agent 同步维护操作法。
- [浏览器工作台](docs/start/web-console.md)、[MCP与Skill](docs/start/mcp.md)、[项目接口](docs/reference/project.md)。
- [治理用法](docs/reference/governance.md)、[Git协作](docs/guides/git.md)、[权威协作](docs/guides/collaboration.md)。
- [架构](docs/reference/architecture.md)、[开发](docs/ops/development.md)、[交付](docs/ops/releasing.md)、[安装与发布](docs/ops/publishing.md)。
- [变更记录](notes/README.md)、[Agent规则](AGENTS.md)。当前授权只以 [STATE.json](STATE.json) 为准。

## 开发检查

```powershell
npm ci
npm run check -- --scope docs    # 文档、生成包说明与链接/行数检查
npm run check -- --scope reader  # 文档阅读器局部检查
npm run check -- --full          # 公共改动/版本交付：一次构建与完整单元+浏览器检查
```

通用 MCP/Skills 分发包可在任意宿主运行 `npm run build:distributions -- mcp-skills` 构建；PI-Desktop `.piplug` 安装包在 PI-Desktop 内由官方 `PluginCheck`/`PluginPack` 更新，见 [产物与安装](docs/ops/publishing.md)。1.x 起稳定 `vX.Y.0` 标签由人创建后触发一次 GitHub Release。

## 必要限制

仅监听 `127.0.0.1`，私有凭据只交给浏览器，不进聊天日志；勿转发端口或配置公网代理。网页拒绝一切写入；原宿主写入仍受确认、修订与路径锁保护。旧 ID `pi.agent-governance` 迁移前先备份 `STATE.json` 与 `.governance/` 并停用旧插件。
