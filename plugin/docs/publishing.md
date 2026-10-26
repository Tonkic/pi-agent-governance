<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->
# 产物与安装 / Distributions

支持**通用MCP＋Skills＋本地Web控制台包**及**PI-Desktop官方piplug**，附Codex、Claude Code、Pi配置示例。当前 **0.10.2** 优化按需帮助与内容优先，patch不市场；保留[ASCII画板](architecture-design.md)与[GitHub协作](collaboration.md)。共享改动需完整检查、官方包与main双OS CI，不自动安装/npm/建标签。原SSH市场规则拒绝仍保留，不重试同类包；运行时与许可继续随包，见[交付规则](releasing.md)。

0.8.3市场包现已published；0.9.0单次提交被平台eval动态执行规则拒绝，版本未创建，不重试或绕过，详见[记录](https://github.com/Tonkic/pi-agent-governance/blob/main/changes/active/project-board-release/ssh-portable-090.md)。每次产品交付使用新版本，不覆盖已用/待审版本。SSH配置、凭据与快照仅位于忽略的.remote-local，不进入公开产物；见[SSH](remote.md)。

插件已包含本地浏览器服务/界面，安装后无需下载本源码仓库；需PI-Desktop启用插件、授权并打开自己的项目。源码CLI命令仅是独立运行方式，不是插件启动前提。

## 构建目标

在干净、已构建且已审查的来源提交上执行：

```powershell
# 先完成所选范围检查；已通过且内容等同就不重复，公共改动/大版本用 --full
npm run check -- --full
npm run build:distributions
# 可单独检查命名目标；不接受任意shell命令
npm run build:distributions -- mcp-skills
npm run build:distributions -- pi-desktop
```

输出只在忽略的 `build/distributions/`。构建器仅清理自己标记且文件清单已知的目录；未知文件、符号链接/junction 或不完整旧输出会阻塞，不覆盖用户内容。普通 build 会清理 build/，所以先完成检查再生成发布产物。

| 目标 | 输出与约束 |
| --- | --- |
| mcp-skills | `agent-governance-mcp-skills-VERSION.tgz`；npm pack --ignore-scripts 生成的本地可安装下载包，不发布到 npm |
| pi-desktop | `io.github.tonkic.agent-governance-VERSION.piplug`；核对已提交的官方包，复制原始字节，不用 shell 打包 |
| 两者 | `asset-manifest.json` 与 `SHA256SUMS`，绑定版本、来源完整 SHA、文件名、大小和 SHA256 |

通用包包含metadata/安装锁、MCP/Web入口、共享core/git/project/design/behaviors/documents/tool/panel及browser/browser-open/workbench/workbench-tool模块、规范Skill和许可/来源/参考、客户端示例及同一工作台静态资源。排除PI的operations/main适配、开发node_modules、项目STATE、`.governance/`、`.pi/`、`.secrets/`和本机证据。

npm pack 不包含 package-lock.json，因此包内使用由根 package-lock 派生的 **npm-shrinkwrap.json**。它保留精确依赖图，运行依赖与根包一致；解包后 `npm ci --omit=dev` 可直接使用。包自身不包含生命周期脚本。

## 通用包安装

1. 校验 SHA256SUMS，解压到可信本地目录。需要 Node.js 22+、Git。
2. 在解压后的 package 目录执行 `npm ci --omit=dev --ignore-scripts`。
3. 使用 `node build/mcp/server.js --workspace D:/projects/example` 启动stdio MCP。按 `mcp/clients/` 示例替换node/server/项目的绝对路径；项目须已存在，不自动初始化，不把凭据写入配置。
4. 按客户端支持的 Skill 位置选择复制 `plugin/skills/architecture-copilot/`。Skill 不授予代码变更或自动确认基线权限。
5. 在原宿主会话请求打开工作台：governance_ui action:open、confirmed:true。不再另配一套PI面板；手动CLI方式见 [浏览器工作台](web-console.md)，不配置公网代理。

MCP 使用与现有插件相同的共享治理核心；数据、修订/锁和显式写入/Git边界不变。只在可信仓库使用；提示词和路径检查不是操作系统沙箱。客户端配置与协议用法见仓库 `docs/mcp.md`。

## PI-Desktop 官方包检查

Community ID：`io.github.tonkic.agent-governance`。源码仓库：`Tonkic/pi-agent-governance`。

1. 按影响范围完成[开发检查](development.md#检查命令)，复用已通过且输入/环境等同的结果；插件源码/说明变化保留干净构建、包核对和官方i18n，不因打包重复产品全量。
2. 使用宿主 **PluginCheck / PluginPack 工具**检查并生成当前版本包，提交至 `plugin/dist/`。不得用脚本自制 piplug。当前目录只保留当前包；旧包可从已验证 Git 提交取回。
3. CI 解读 ZIP，拒绝路径穿越、重复/大小写别名、链接、未知条目、私密文件、CRC/结构错误和过大内容。版本、manifest（含权限/fs/net）及完整允许文件清单必须匹配新构建源码；仅允许 CRLF→LF 归一化。
4. 缺包、包未提交、源码不一致或篡改立即阻塞；CI 不修复或重打包。重新执行官方工具并审查后才能重建。构建器只核对产物，不能独立证明工具来源；PluginPack 检查事实仍需真实记录。

包必须对应最终源码/说明；来源内容变化就重新用官方工具生成并核对，旧包不能冒充新源码。纯STATE/看板/证据记录不在包内，不必重打包。

## 安装与更新边界

- 使用 PI-Desktop 插件页自行安装/更新并确认权限，不自动安装。旧 ID `pi.agent-governance` 不跨 ID 更新：先备份 STATE/`.governance/`，停用旧实例再安装新 ID，不删除项目数据。
- 市场与GitHub不同通道，日常构建和CI不调用市场。用户现已授权未来大更新由Agent按语义判级升版，在源码/官方包/main完整CI通过后核对版本/待审并提交一次；patch不提交。记录真实结果，未知写入不重试，不覆盖待审/已用版本。凭据仅供合规提交，不打印、复制或上传，缺失则如实阻塞。
- shell.openExternal仅打开生成本地URL。用户本次明确批准ui.panel/ui.view，仅用于Alt+空格/右侧插件视图的共用轻量入口（状态、刷新、显式打开），不恢复内嵌业务或models.list；安装仍需人工授权。既有安装不会因源码更新生效，需手动更新/重载。0.7.0历史见 [记录](https://github.com/Tonkic/pi-agent-governance/blob/main/notes/release-0.7.0.md)。
- 浏览器按navigator.language选择中/英文，主题跟随系统；PI命令按宿主语言。用户内容和底层诊断不翻译。改变浏览器语言后重新打开页面。
- PI-Desktop 0.16.1 本地 MCP 不开放安装或插件更新接口；不能借内部服务绕过宿主注册操作。GitHub 发布成功不等于真实宿主/目视验收完成。
