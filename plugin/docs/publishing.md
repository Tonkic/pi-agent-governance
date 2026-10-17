<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->
# 产物与安装 / Distributions

支持 **通用MCP＋Skills＋本地Web控制台包**及 **PI-Desktop官方piplug**，附Codex、Claude Code、Pi配置示例；不是各CLI原生插件。1.x起稳定主/次版本vX.Y.0各发布一次GitHub Release；当前0.7.8不发布，见 [交付规则](releasing.md)。

## 构建目标

在干净、已构建且已审查的来源提交上执行：

```powershell
npm ci
npm run typecheck
npm test
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

通用包包含metadata/安装锁、MCP/Web入口、共享core/git/project/design/behaviors/tool/panel及browser/browser-open/workbench/workbench-tool模块、规范Skill和许可/来源/参考、客户端示例及同一工作台静态资源。排除PI的operations/main适配、开发node_modules、项目STATE、`.governance/`、`.pi/`、`.secrets/`和本机证据。

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

1. 插件源码/说明修改后执行干净构建、类型、全套测试、浏览器和官方 i18n 检查。
2. 使用宿主 **PluginCheck / PluginPack 工具**检查并生成当前版本包，提交至 `plugin/dist/`。不得用脚本自制 piplug。当前目录只保留当前包；旧包可从已验证 Git 提交取回。
3. CI 解读 ZIP，拒绝路径穿越、重复/大小写别名、链接、未知条目、私密文件、CRC/结构错误和过大内容。版本、manifest（含权限/fs/net）及完整允许文件清单必须匹配新构建源码；仅允许 CRLF→LF 归一化。
4. 缺包、包未提交、源码不一致或篡改立即阻塞；CI 不修复或重打包。重新执行官方工具并审查后才能重建。构建器只核对产物，不能独立证明工具来源；PluginPack 检查事实仍需真实记录。

本次迁移的共享 Skill、源码与说明集成后，必须由协调 Agent 重新生成官方包。旧包不能冒充新源码匹配。

## 安装与更新边界

- 使用 PI-Desktop 插件页自行安装/更新并确认权限，不自动安装或调用市场。旧 ID `pi.agent-governance` 不跨 ID 更新：先备份 STATE/`.governance/`，停用旧实例再安装新 ID，不删除项目数据。
- 市场已发布版本和 GitHub 下载产物是不同通道；本仓库不再自动提交市场，也不读取旧市场凭据。保留已有凭据与发布历史，不迁移、不打印、不上传。
- 本次统一入口明确获批shell.openExternal，仅打开生成的本地工作台URL；移除ui.panel/models.list，desktop.control仅核实调用身份。仍需宿主安装页确认权限，不自动安装或扩权。0.7.0历史权限见 [发布记录](https://github.com/Tonkic/pi-agent-governance/blob/main/notes/release-0.7.0.md)。
- 浏览器按navigator.language选择中/英文，主题跟随系统；PI命令按宿主语言。用户内容和底层诊断不翻译。改变浏览器语言后重新打开页面。
- PI-Desktop 0.16.1 本地 MCP 不开放安装或插件更新接口；不能借内部服务绕过宿主注册操作。GitHub 发布成功不等于真实宿主/目视验收完成。
