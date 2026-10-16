# 宿主项目与会话复用

## 结果与范围

按用户修正暂停独立Tauri桌面，不合并其代码或安装包。本次复用PI-Desktop已有项目/会话，以及Claude Code官方项目环境和Codex官方Hook；同一核心、STATE与治理文件，无新目录选择器、聊天库、后台WebView或私有历史扫描。版本0.7.8、既有权限不变。

- PI工具：以可信ToolExecContext.sessionId作有界公开身份查询，绑定原会话项目；前台不同项目不串写。身份缺失/远程/隔离/定时/只读会话拒绝，不回退全局workspace。
- PI面板：默认同项目已有会话；唯一候选自动选择，多候选明确选择，不把最近称作当前。发送前两次身份/空闲核对，保留模型/思考/历史，只有显式new才创建和读取模型列表。
- 共享会话：禁止插件abort。unknown或退出遗留的created经人工核对解除本地记录；不重发、不停止、不把idle当作unknown完成。running仍需核对会话/项目。
- Claude：`--host claude-code`从官方MCP子进程CLAUDE_PROJECT_DIR绑定启动项目；不读cwd/home/最近记录作兜底，固定--workspace兼容保留。
- Codex：有界只读Hook读取stdin session_id/cwd并向原会话返回最小项目状态；遇未初始化checkout/worktree不串回父项目。不动态重绑MCP、不读取transcript_path、不自动init/新建模型回合。
- HTTP仍隐藏并拒绝所有宿主operation/会话/模型控制。所有安装、配置和付费调用由用户明确执行；未自动操作。

## 实际证据

实现阶段提交`d5f0ca81a5d514139cb87220a02c0ed4c86ef48d`；UI受管提交`1f212384456590540bcfd5cc00dc9f95ece22a0f`，集成`96b46941d238147ea1e305cbd9352fb4675ab95e`。最终交付SHA与产物校验在后续段更新。

- 实际npm ci：0漏洞；typecheck/build/full测试163/163，无跳过。真实SDK子进程验证Claude环境绑定、空目录无自动init、跨cwd不串写和缺失/相对/文件/链接拒绝；Hook进程验证两项目/子目录/worktree与坏输入、无历史读取和状态字节不变。
- PI入口VM使用编译后的真实核心：调用会话项目A与可见项目B隔离；session元数据查询有界。后端覆盖无ID/忙碌/异项目/模型覆盖/发送前移动拒绝、原会话prompt且无create/configure/abort。
- Edge面板98张截图和真实HTTP7张截图通过；包含多候选/显式new/错误不fallback/晚到结果/离线/工作区切换/共享取消隐藏及解除确认。截图自动生成，不声明安装宿主或人工目视已验收。
- 一次静态复核找到shared created退出恢复缺口；新增回归真实失败`Only unresolved sessionless creation or shared unknown submission can be released`，修复后full163通过。仅修复具体缺陷，未重启广泛复核。
- 行为契约原关联源码增长至505629字符，被500000预算真实拦截；独立会话浏览器契约用例拆到`test/host-context-browser.cjs`并继续串行执行，原10场景、指纹和预算不变，之后行为检查通过。新增离线用例改为等待页面事件后断言，不弱化要求。
- 官方PluginCheck通过62文件；PluginPack已执行。最终包哈希及提交后分发检查待最终记录。入口shim仍有既有两项unused提示与显式高风险授权提示，不增加权限。

日志保存在当前会话scratch的`host-context-*.log`；截图`host-context-combined-browser/`与`host-context-behaviors/`。日志为本机证据，不进入发布载荷。曾误用不存在的check:i18n脚本，未据此声称双语检查通过；双语UI由实际浏览器覆盖，正式静态检查单独记录。

## 能力边界

PI公开接口无可靠active-session事件，面板不猜前台会话；支持范围仅本地Agent。MCP不是聊天API，Claude启动项目不随cd自动切换；Codex普通MCP仍固定绑定，Hook不改变该绑定。Codex原生插件新安装官方要求新会话，不暗中创建；IDE/cloud/SSH/WSL与热载入未实测。不声称已安装PI/Codex/Claude E2E、付费模型、原总体真实宿主/换行指纹/一次启动接续检查通过。总体STATE继续working，原阻塞保留。
