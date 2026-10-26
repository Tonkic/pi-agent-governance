# PI Agent Governance

**所有宿主共用一个只读浏览器工作台。** PI-Desktop、Codex、Claude Code连接已有项目；插件查看工作看板、项目架构、Git和项目文档，操作留在原AI CLI/应用，不另建聊天或重复操作面板。

社区 ID：`io.github.tonkic.agent-governance`。仓库版本 **0.10.3**：只读工作台移除“项目操作”、网页看板/设计写入和独立“行为文档”入口，保留搜索、详情、历史、画板与安全阅读器。Docs是当前功能与架构依据，Notes仅按需追溯；每轮按影响最小更新，见[维护原则](docs/documentation.md)。补丁不市场，不自动安装/npm/建标签；原SSH市场拒绝保留，见[交付规则](docs/releasing.md)。

## 开始使用

1. PI-Desktop：手动安装 `plugin/dist/` 包并确认权限。打开项目后，按 **Alt+空格**搜索“Agent 项目治理”，或从**右侧工作面板的插件列表**选“项目治理工作台”，在轻量入口点击“打开浏览器工作台”。也可按 **Ctrl+Shift+P** 运行同名命令直接打开。
2. Codex、Claude Code或Pi：按 [MCP与Skill](docs/mcp.md) 配置本地stdio连接，在原会话请求“打开当前项目工作台”。宿主调用 `governance_ui`，参数 `{"action":"open","confirmed":true}`。
3. 所有入口打开同一只读页面。未初始化也可阅读已有资料；初始化与项目更新在原宿主执行。先读 `status` 和项目README，只接续获批范围。
4. 远端项目：把工具包放进工作目录的 `.remote-local/tool/`，先配置Git忽略，再用remote-cli配置连接并核对指纹。AGENTS只记录入口和实际远端目录，不放密码；使用方法与迁移/离线边界见[SSH指南](docs/remote.md)。
5. GitHub协作：用collaboration-cli显式绑定仓库及权威分支；无绑定才按SSH/本地使用，已绑定的网络故障不切权威。两端先按正常Git编辑、检查并提交，再明确推到独立协作分支，详见[指南](docs/collaboration.md)。

浏览器只查看项目数据；开发、项目操作和文档维护在原AI CLI/应用完成，保留历史、模型和思考设置。页面不写项目、不创建聊天或调用模型，也不列举/扫描私有聊天数据。

PI工具绑定可信调用会话的项目；命令使用宿主可见项目。缺少或不支持身份时拒绝，不猜“最近项目”。Claude MCP可读取官方启动项目环境；Codex普通MCP仍显式绑定项目，Hook只提供只读上下文。详见 [项目接口](docs/project.md)。

`governance_ui` 另支持 `status` 与需确认的 `close`。同项目复用服务；切换、卸载、MCP断开或页面租约到期回收自有服务。显式重复打开可能另开标签页，不承诺跨浏览器聚焦。SSH/WSL/远程环境不保证能打开用户本机浏览器。独立手动启动方式见 [浏览器工作台](docs/web-console.md)。

PI的 `shell.openExternal` 只打开自身生成的本地链接；本次明确批准 `ui.panel`、`ui.view`，仅用于同一轻量入口页，不内嵌看板/聊天。入口只读状态，显式点击才打开；恢复/切换不自动弹浏览器。无models.list，不自动安装或扩权。左侧聊天/项目栏不是本次扩展位置。

## 工作方式

三栏为待办/进行中/已完成。功能按分层文档实现并实际测试，通过后完成，没有独立验收。完成栏显示近期5项，「查看全部」可搜索全部历史；数据不删除。见 [文档开发](docs/doc-driven.md)。

四页共用导航和顶部栏。桌面默认64px图标栏，悬停或聚焦覆盖展开、不挤正文；窄屏可直接点击四项导航。“项目文档”搜索文件名、阅读根说明及 `docs/`、`notes/` Markdown，支持字号、专注阅读、内部链接和标题定位；外部链接、图片和HTML只作文本。Docs日常按问题读取，Notes仅在需要历史时查阅。外部修改后手动刷新，见[阅读范围与限制](docs/web-console.md#项目文档阅读)。

Git页只展示上新下旧的真实提交图：main第一父链固定居中，图例只保留主轴与分支两项；常驻端点只标主轴和HEAD，其他分支名、标签与归属组合移到悬停/键盘摘要，不铺长列表。点击打开提交/文件差异弹窗，关闭保留图的位置与焦点。不再展示或自动查询“受管工作区”，Agent底层Git工具及真实分支数据保留。仅本地只读，详见[图与限制](docs/git.md#浏览器提交图)。插件包包含浏览器服务和界面，普通使用无需下载本插件源码。

架构设计可选，在原宿主使用Architecture Copilot发起和保存草案。浏览器仅查看源码事实图、既有草案/基线/历史及ASCII/画板，不提供确认入口，也不新增Agent自行确认权限。设计不代表实现或测试证据，见[架构分析与设计](docs/architecture-design.md)。

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

浏览器与行为检查见 [开发](docs/development.md)。构建不推送、发布或安装；Agent按已批准产品变化评估升版，patch不市场，大更新检查后提交一次，见[交付规则](docs/releasing.md)。1.x起稳定 `vX.Y.0` 主/次版本各发布一次GitHub Release，标签仍由人创建，不自动发布npm或安装。

## 必要限制

仅监听127.0.0.1，私有访问凭据只交给浏览器，不返回聊天。不要分享链接、转发端口或配置公网代理。网页写入被拒绝；原宿主安全写入仍需原确认与修订保护。锁/路径不是恶意并发沙箱，只用于可信仓库。不拦截其它工具，不把卡片完成当测试证据。

旧ID `pi.agent-governance` 不自动迁移：备份STATE和`.governance/`，停用旧插件后安装新ID。安装后的真实客户端交互与物理/远程场景未由自动测试代替。
