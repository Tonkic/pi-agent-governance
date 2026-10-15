# MCP/Skills 与大版本发布检查

本次实现共享核心＋本地stdio MCP＋可移植Architecture Copilot Skill，保留PI图形适配器和项目数据格式。当前版本0.7.8不升级，不建标签，不创建真实Release，不安装或提交市场。

## 已实际检查

- 干净npm ci、typecheck/build成功；初始集成151测试通过，补齐CI依赖顺序回归后本地与远端均 **152/152**，无跳过。
- 真实SDK子进程完成握手、schema/参数校验、工作区绑定、无自动初始化、并发锁/过期修订、来源指纹、草案ID、Skill资源/提示、路径穿越、畸形/超限输入及EOF检查。
- 实际通用tgz解压后使用npm-shrinkwrap进行 `npm ci --omit=dev --ignore-scripts --offline`，无开发TypeScript/Playwright依赖，独立MCP启动与工具/资源/初始化/状态成功。
- Edge模拟宿主浏览器回归通过，保存95张视口截图；原有10行为场景通过。i18n 0失败、2项既有提示。
- 官方PluginCheck/PluginPack通过：当前PI包61文件、713439字节，SHA256 `f88a804004796decc54a107ba3a1fdeaea1efbe044f0d9639c3738174b3e5f19`。权限不变；静态入口shim的两项unused提示仍保留。
- 发布/分发测试使用本地Git夹具与mock HTTPS，不访问真实发布接口；覆盖主版本精确资格、固定仓库/标签SHA/main祖先、干净源码、敏感历史、白名单/CRC/路径/大小/权限与摘要、幂等跳过和未知写入停止。
- 一次只读复核指出完整已有Release应跳过；已复现失败并修复，新增部分/篡改/无摘要拒绝测试后通过。Windows解包测试清理次序的EBUSY已复现并修复。

## 交付检查

- 初始受管源码464bcda经提交后全套检查与git_verify，main9de2b6a集成重测/普通推送并核对远端SHA。MCP包70713字节，SHA256 `051dedf2371265f6e86499b7f339767cf0ee0e61d2a2fa57825c83b193ff63d5`；PI包原字节不变。两目标及发布计划publish:false/mutation:false通过。
- 真实CI38779107707发现Chromium安装晚于行为检查，顺序回归red→green；受管修复b32ff20。CI38780981726的Ubuntu全通过，Windows13个Git夹具因TEMP别名失败；本地别名目录复现13失败，夹具realpath后13通过，不改产品根目录门禁；受管修复ddff7a1提交后152测试通过。
- main `45a2f871682c3fd28b384d28125a8b811bb50830` 集成重测152通过、正常推送并核对SHA。[真实Tests运行38782258411](https://github.com/Tonkic/pi-agent-governance/actions/runs/38782258411) 已观察到success：Ubuntu与Windows的npm ci、类型、构建、生成物diff、152测试、Chromium安装、行为与浏览器检查全部通过。
- 后续记录提交仅更新STATE、看板和本页/Notes，不改变实现、权限或官方PI包。宿主外部阻塞保留。

## 未验证与限制

没有创建发布标签或真实GitHub Release；上述远端成功仅指Tests工作流，不是Release发布job实发。三个CLI目前提供配置示例，未进行其真实模型会话端到端测试。没有自动安装或绕过PI宿主权限。

内置Browser前台目视、真实已安装宿主完整交互、换行指纹/一次启动接续等原总体阻塞保留。模拟测试/截图保存不是手工目视或真实宿主证据；总体STATE继续working。
