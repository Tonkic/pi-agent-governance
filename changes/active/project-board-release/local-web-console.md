# 独立本地控制台与稳定主／次版本发布

## 结果与边界

- 已实现独立Web项目控制台；仅127.0.0.1、显式绝对可信项目目录，复用现有renderer、panelInvoke和核心文件。不要求PI-Desktop运行。
- 看板、STATE进度、源码架构、设计草案人工确认、文档/检查状态；CLI/桌面客户端通过其支持的stdio MCP配置共享同一项目。不是软件窗口/Agent/模型遥控器。
- 随机启动凭据、精确Host/Origin/JSON、固定API/静态白名单、有界请求/连接/并发/时间；无任意命令、Git写入、文件浏览或公网模式。可信本地仓库边界不是恶意本机进程沙箱。
- 发布资格改为稳定vX.Y.0（X≥1，Y≥0），包括1.0.0、1.1.0、1.2.0、2.0.0。排除0.x、非零补丁、预发布、构建后缀/前导零；保留精确版本、main来源和一次发布保护。
- 版本仍0.7.8；未创建标签、实发Release、发布npm/市场或安装。不把发布模拟测试当实际Release运行。

## 已实际完成的检查

- 源码阶段45808441381d3c16be739047d177ecba6cb51b73；已验证发布worker d385566cd6f871199c153b59b1d037d97a2e5c6c集成至c2280634386553c39783ff8051709b2b7083938c。
- npm ci（0漏洞）、typecheck/build、组合npm test 156/156通过；新HTTP3项含真实SDK MCP↔Web共享、修订拒绝及设计人工确认隔离。
- 真实HTTP Playwright新增7图，原浏览器95图及10行为场景通过；中英文、390/768/1280、明暗主题、离线/过期/确认取消/XSS纯文本/凭据移除与刷新覆盖。截图仅为自动检查证据，未声称人工目视。
- 通用包解压、仅生产依赖npm ci后，真实SDK MCP和独立Web服务入口均通过，不依赖仓库或PI宿主。
- 一次只读安全复核无可操作缺陷；复核未独立运行测试。i18n 0失败/2既有提示。
- 官方PluginCheck/Pack：62文件、719477字节、SHA256 b6c89288d3de1fbf6cc0be710336fd17826ca9502ac188dfce03ff06525f8458；版本及原权限不变。官方既有风险权限/入口shim静态扫描提示保留。

## 交付检查（持续更新本记录）

- 受管最终提交6df5ff5af0ffb53e02e50b67c999a8204af8cf2b实际重装依赖、typecheck/build、156测试、95+7浏览器图和10行为场景通过；git_verify已据实登记，工作区干净。
- main集成9236ccad9b35edbdd1770864b3bd9c4285938a5a后重复上述完整检查，通过后普通push，ls-remote核对完整SHA一致。
- main两目标构建通过；通用tgz 125539字节SHA256 7944b2228122265450cfa0b7c423aff9e533a87061ae467847c3d78771983538，PI保持上述官方原字节。readAssets核对两个产物、manifest和SHA256SUMS共4文件通过。
- main只读发布计划返回publish:false、mutation:false、reason:not-stable-major-minor-tag，符合当前0.7.8；无真实发布调用。
- [真实Tests CI 38794612011](https://github.com/Tonkic/pi-agent-governance/actions/runs/38794612011)在9236cca成功：Ubuntu 1m48s、Windows 7m41s，两边ci/类型/构建/生成差异/156测试/Chromium/行为/浏览器全部通过。保留Actions运行时弃用和runner镜像迁移提示，不视作失败。
- 检查日志与CI结果保存在本次session scratch的web-postcommit-*、web-main-*、web-github-ci-*；不把本机证据打入分发包。本项直接done；总体外部阻塞不close。

## 保留限制

内置Browser前台/人工目视、实际安装宿主完整交互/主题模型、原始换行来源指纹和一次启动接续检查仍未完成。总体STATE保持working，不新增验收阶段或绕过安装权限。

用法见[本地Web控制台](../../../docs/web-console.md)与[MCP](../../../docs/mcp.md)。
