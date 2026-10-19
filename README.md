# PI Agent Governance

**所有宿主共用一个浏览器工作台。** PI-Desktop、Codex、Claude Code只负责连接已有项目；看板、源码架构、设计草案与行为文档使用同一界面、核心和仓库文件。不再提供另一套PI内嵌面板，也不新增聊天数据库或独立桌面。

社区 ID：`io.github.tonkic.agent-governance`。仓库版本 **0.8.3**：默认收起悬浮导航，行为文档升级为一级页面。本次获准同步源码、官方安装包及一次插件市场更新；市场结果见[交付记录](changes/active/project-board-release/hover-behaviors-083.md)。不建标签/Release，不发布npm或自动安装；见[安装与发布](docs/publishing.md)。

## 开始使用

1. PI-Desktop：手动安装 `plugin/dist/` 包并确认权限。打开项目后，按 **Alt+空格**搜索“Agent 项目治理”，或从**右侧工作面板的插件列表**选“项目治理工作台”，在轻量入口点击“打开浏览器工作台”。也可按 **Ctrl+Shift+P** 运行同名命令直接打开。
2. Codex、Claude Code或Pi：按 [MCP与Skill](docs/mcp.md) 配置本地stdio连接，在原会话请求“打开当前项目工作台”。宿主调用 `governance_ui`，参数 `{"action":"open","confirmed":true}`。
3. 所有入口打开同一浏览器页面。已有项目直接读取；未初始化项目须明确确认。先读 `status` 和项目README，只接续获批范围。

浏览器只管理项目数据；开发、分析和文档任务仍在原宿主会话执行，保留历史、模型和思考设置。页面不创建聊天、调用模型或停止会话，也不列举/扫描私有聊天数据。

PI工具绑定可信调用会话的项目；命令使用宿主可见项目。缺少或不支持身份时拒绝，不猜“最近项目”。Claude MCP可读取官方启动项目环境；Codex普通MCP仍显式绑定项目，Hook只提供只读上下文。详见 [项目接口](docs/project.md)。

`governance_ui` 另支持 `status` 与需确认的 `close`。同项目复用服务；切换、卸载、MCP断开或页面租约到期回收自有服务。显式重复打开可能另开标签页，不承诺跨浏览器聚焦。SSH/WSL/远程环境不保证能打开用户本机浏览器。独立手动启动方式见 [浏览器工作台](docs/web-console.md)。

PI的 `shell.openExternal` 只打开自身生成的本地链接；本次明确批准 `ui.panel`、`ui.view`，仅用于同一轻量入口页，不内嵌看板/聊天。入口只读状态，显式点击才打开；恢复/切换不自动弹浏览器。无models.list，不自动安装或扩权。左侧聊天/项目栏不是本次扩展位置。

## 工作方式

三栏为待办/进行中/已完成。功能按分层文档实现并实际测试，通过后完成，没有独立验收。完成栏显示近期5项，「查看全部」可搜索全部历史；数据不删除。见 [文档开发](docs/doc-driven.md)。

各页面共用同一导航和顶部栏。桌面默认64px图标栏，鼠标移入或键盘聚焦时覆盖展开，不挤正文；无切换按钮，窄屏可直接点击导航。一级“行为文档”按需读取正文和实际证据，支持手动刷新。左侧“项目文档”可搜索文件名、阅读根说明及 `docs/`、`notes/` Markdown，保留舒适字号/行宽、局部文件库/标题目录、字号调整与专注阅读。内部Markdown链接和标题可在阅读器内跳转；外部链接、图片和HTML仍为文本，不加载资源。只读、有界；外部修改后手动刷新，详见 [阅读范围与限制](docs/web-console.md#项目文档阅读)。

架构设计可选。需要时在原宿主使用Architecture Copilot：源码分析保存带指纹的事实图；设计模式只保存已明确发起的草案。浏览器审阅同源ASCII/画板并人工确认基线。确认不批准代码实施，也不证明测试通过，见 [架构分析与设计](docs/architecture-design.md)。

## 按问题阅读

- [文档索引](docs/README.md)：定位专题，不必逐层打卡。
- [浏览器工作台](docs/web-console.md)、[MCP与Skill](docs/mcp.md)、[项目接口](docs/project.md)。
- [治理用法](docs/governance.md)、[Git协作](docs/git.md)、[文档维护](docs/documentation.md)。
- [架构](docs/architecture.md)、[开发](docs/development.md)、[交付](docs/releasing.md)、[安装与发布](docs/publishing.md)。
- [变更记录](notes/README.md)、[Agent规则](AGENTS.md)。当前授权只以STATE为准。

## 开发检查

小改定向测，公共/高风险/未知及大版本全量；提交/合并只按实际变化补测，不机械重跑。首次或锁文件变化后安装依赖：

```powershell
npm ci
npm run check -- --scope reader  # 示例：文档阅读局部改动
npm run check -- --full          # 公共改动/完整交付：一次构建与完整检查
```

浏览器与行为检查见 [开发](docs/development.md)。构建不推送、发布或安装；1.x起稳定 `vX.Y.0` 主/次版本各发布一次GitHub Release，不自行升版本、建标签、发布npm或提交市场。

## 必要限制

仅监听127.0.0.1，私有访问凭据只交给浏览器，不返回聊天。不要分享链接、转发端口或配置公网代理。安全写入仍需确认和最新修订；锁/路径不是恶意并发沙箱，只用于可信仓库。不拦截其它工具，不把卡片完成当测试证据。

旧ID `pi.agent-governance` 不自动迁移：备份STATE和`.governance/`，停用旧插件后安装新ID。安装后的真实客户端交互与物理/远程场景未由自动测试代替。
