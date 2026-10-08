# 源码/产物分离决策与验证

## 为什么改

用户要求更容易读懂代码，并将 TS 与编译 JS 分开。旧布局由无 outDir 的 tsc 在 TS 旁生成 JS，宿主直接加载 main.js；可打包但目录噪声大。此记录保存迁移依据，不作为当前任务来源。

## 决策

- TS 路径保留，避免无意义重命名核心模块和架构引用。plugin/runtime 集中放10个安装 JS，build 放可丢弃的中间产物、测试和CLI。
- runtime 与 manifest 仍提交，支持宿主直接加载和发布者从审核 SHA 构造白名单载荷。并非要求所有产物都从 Git 忽略；CI 重建检查保证源码一致。
- manifest.main 改为 runtime/main.js，HTML四个脚本改为 ../runtime/renderer/，发布白名单与浏览器桥接跟随迁移。
- Docs 保存稳定架构和开发用法，Notes 按需要记录实际决策/验证；插件不强制空目录。原有工具文档/changes 证据保留，通过入口链接。没有修改业务规则、权限或用户项目数据。
- 0.6.2 是本地补丁，按已授权流程同步GitHub并集成main，不发布市场、不自动安装。旧安装包保留。

## 实际验证

- typecheck/build、63/63测试通过，包括新布局、CLI、入口/HTML引用与生成文件一致性测试。
- npm run test:browser 连接真实内核、模拟宿主桥接通过，中英文刷新/看板/架构/版本守卫保留；不是实际宿主或人工目视验收。
- scratch干净副本没有runtime/旧邻接JS，npm ci后typecheck/build/test重新生成成功，63/63通过。日志：session scratch layout-clean.log、layout-tests.log。
- PluginPack含校验：28文件，277359字节，SHA256 ade28c7fb06fc033d140cedf0894fa9277ae78c58ef35c66cea48c956f20c930；仅原有agent.tool.register授权提示。
- TS7不导出bin/tsc子路径，构建从package.json声明的bin.tsc解析CLI。旧HTML路径断言已更新，新布局测试验证真实引用，不保留虚假旧入口。

## 边界

build/runtime为编译器拥有目录，仅允许生成文件；构建拒绝符号链接输出根，不防恶意并发。历史包和STATE/.governance不清理。受管git_create此前因无关未跟踪目录拒绝，使用串行独立功能分支与原生Git，不伪造受管git_verify。总体验收仍待宿主窗口拖动与人工目视检查，整体STATE不close。提交后及main集成后仍需实测与远端核对，不能用上述提交前结果代替。

追加检查：3项布局/CLI/文档链接测试独立通过；全部10个运行JS与迁移前逐字节一致。官方i18n门禁0 FAIL、2 REVIEW：安装器要求的双语字符串命令标题与固定标识STATE，保持已验证兼容方案。diff审查覆盖输出/入口/脚本白名单与测试路径，无权限扩大。

提交后验证：代码提交577c79d；release:auto实际重跑typecheck/build、64/64测试、中英文浏览器回归通过，审核SHA白名单27文件可完整读取并包含runtime入口。GitHub在远端核对阶段HTTPS443超时，随后两次只读ls-remote也失败；不假定推送成功，不合并/删除未核实远端的分支。待网络恢复按STATE接续，保留功能分支。日志：session scratch layout-delivery.log。

## 0.6.3 阅读负担精简

用户批准排版、任务动作提取和文档去重一起实施。core.run保留锁、版本校验和状态检查，动作由同文件progress/context/verify/gate/close方法执行；没有增加运行模块或新抽象层。10个TS排版展开字段与语句，超过200字符行由41条降为0；初始化模板三份输出与旧版本完全一致，工具描述/schema值一致，其他8模块规范化后与旧源码一致。

README从11376字节减为3661字节，移出Agent规则和重复参数/交付说明，唯一的图键盘与刷新说明迁入PROJECT。AGENTS和RELEASING统一当前main授权，历史包/截图/证据保留；同一任务检查更新此记录，不新建模板。

typecheck/build、65测试及中英文浏览器回归通过；新增过期版本对所有提取动作的拒绝/锁释放回归，文档链接测试覆盖README。i18n门禁0FAIL，2既有REVIEW分别为安装器字符串命令标题和STATE固定标识。PluginPack通过：28文件301883字节，SHA256 6d841a0a8a6d35cbb6ae13e8ac0c5abb59a99aa80aadd199ed2027a1fc6ae4c6。包因排版增大，不声称减少运行体积或内存。日志在scratch的simplify-tests.log、simplify-i18n.log；formatter仅安装scratch，无新增项目依赖。GitHub只读核对仍443超时，待实际交付命令/远端核对结果，不假定已合并。不发布补丁市场或安装。

代码提交087a0a7后实际release:auto在市场基线读取阶段fetch failed，未进入推送/市场提交。远端main不可核对，保留功能分支不删除；网络恢复按STATE接续。最终本地提交的回归日志使用scratch/simplify-final-tests.log，不以交付命令失败冒称测试运行。

## 网络恢复后的交付与待办核对

网络恢复后release:auto在b1711fc实际完成typecheck/build、65测试、双语浏览器与凭据历史扫描，源码分支同步成功，未提交市场。0.6.2/0.6.3改造no-ff集成main至1ed8390，集成后相同检查通过，普通推送且ls-remote SHA一致。日志：scratch/todo-delivery.log、todo-main-tests.log。

看板通过revision接口修正过时main禁令、补交付与窗口卡片并填写阻塞；GitHub交付卡片完成。最新截图已生成，自动检查通过但人工目视未验收。真实宿主snapshot仍guest unavailable；安装清单为社区0.6.1，源码0.6.3没有自动安装。host-smoke、visual-check、release-acceptance、host-window-drag保留待办，不close整体任务。临时分支仅在远端main包含其全部提交并无活动worktree/登记后清理；旧0.6.0发布来源保留。

## 0.6.4 宿主拖动CSP修复（真实复验未完成）

合同：.pi/goal/修复真实插件窗口拖动并完成剩余验收-20261007-0457.md。自行读取PI0.16.1和安装0.6.3，枚举真实治理窗口5312264。两次原生鼠标拖动（相对顶部200,20和400,35；第二次确认前台句柄）前后均(1032,154)，尺寸1356×730。PrintWindow成功捕获；已实际查看一张中文窗口图像，证据host-inspection.html及host-window-0.6.3.png。不证明全部尺寸/主题目视通过。

实际installed preload为closed Shadow DOM注入内联style，46px app-region drag、按钮no-drag。插件style-src self阻止注入：新浏览器回归旧策略失败，计算值none/static/0px；仅放行style unsafe-inline后回归通过，script-src self、网络限制和permissions不变。未修改宿主程序。65测试、typecheck/build、双语浏览器通过；i18n0FAIL2既有REVIEW；PluginPack28文件305076字节SHA4020c2fbfab9374d177718f669bc8f65ffcd1c22e4970fb09f66d2b626999c13。只读审查08723261无具体缺陷，明确CSS回归不能证明原生移动。

尝试原生UIA：主窗口10、治理窗口9个空Pane，无可操作控件。通过截图辨认并点击主窗口插件入口；之后浏览器截图反复plugin did not answer，恢复预览仍超时。Windows无piplug关联，也无公开安装工具；无法安全辨认确认按钮，因此停止UI安装，不盲点、不通过内部IPC或直接覆盖目录。0.6.4未安装；真实移动/缩放/关闭、隔离项目交互、12组目视均未验收。保留全部未完成项，不verify/close。用户已确认更新的0.6.3安装阻塞已删除。架构来源的CRLF导致expected指纹拒绝，未通过重写所有指纹绕过。

临时诊断与只读提取均在scratch：inspect-windows.ps1、host-ui/installed-plugin-panel.js、公开宿主ADR0093/0275与preload源文件。主窗口截图不提交，未开调试端口或终止进程。

### 后续正常UI安装与真实拖动通过

继续核对实际0.16.1与公开源码：PluginsPage更多菜单→installPackage→原生showOpenDialog→宿主校验并加载。利用Windows PrintWindow/OCR定位入口，设置/插件页会隐藏work-panel导致pi.browser截图超时；返回应用后即可查看之前的截图，这不是工具永远不可用。点击应用插头入口、更多、安装插件包；原生“打开”窗句柄2952488。Alt+N输入路径时IME将冒号变全角导致失败，改为正常剪贴板粘贴ASCII路径（恢复原剪贴板）并点击打开。安装清单与实际HTML确认0.6.4，旧窗口被宿主关闭。未内部IPC、未改安装目录、未绕过确认或新增权限。

正常插件页重新打开窗口854818：顶部真实鼠标拖动前(1032,516)/496×368，后(924,552)/496×368；边缘拖动尺寸变656×448。已查看真实中文窗口图像：宿主三个控件显示、4节点4关系出现；点击刷新不写项目数据。点击关闭后窗口数量为0，再正常重开窗口10293024，成功。证据host-window-0.6.4.png，scratch原始坐标installed-064-drag.json、installed-064-resize.json。窗口拖动卡片已完成；隔离项目全操作和12组目视未完成，不关闭整体任务。上述“未安装”描述为先前尝试的历史结果，以此后续实测为准。

## 0.6.5 独立视图与Fluent风格

按用户要求将architecture/board/task/git由滚动锚点改为hash独立页面，仅活动页参与布局。DOM保留，切页不丢草稿；返回前进和无效hash回退可用，显示图时重算尺寸。新增views.css集中材质与圆角卡片，毛玻璃仅导航/确认浮层，正文卡片保持不透明；高对比/减少透明度关闭blur，减少动画取消过渡。未增加框架或权限，CSP宿主拖动修复保留。参考pebrel的分区导航与原生工作区组织，未复制其GPL实现。

typecheck、65测试通过；四页中英文390/768/1280×明暗主题48截图及互斥显示、跨页草稿取消、历史导航、高对比降级、拖动/键盘/过期写入/CSP浏览器回归通过。实际查看宽屏中文架构、390中文看板、768英文深色任务截图，未发现遮挡或横向溢出；不宣称48张均已目视或新版宿主验收完成。PluginPack29文件309880字节，SHA4c554da9c3bd0d2c2fc9c69038a6cb9f459cdb46917dee21eabc6d7b85512145。安装版本仍0.6.4，本次新包不自动安装；补丁不提交市场。

0.6.5源码提交b15ff1c，提交后release:auto完成typecheck/65测试/四页浏览器/凭据扫描，远端读取短暂连接中止。只读确认main仍f688470且来源不存在后，网络恢复普通推送来源，no-ff集成main a4375da；集成后65测试与48截图导航回归通过并推送核对一致。日志scratch/views-delivery.log、views-main-tests.log；不发布市场或自动安装。

### 0.6.5安装与全组布局复核

已通过正常插件页/原生打开框安装0.6.5，安装清单与views.css核对，新治理窗口789732成功打开及最大化；未直接写安装目录。后续本轮实际逐组查看四页×中英文×390/768/1280×明暗的48张截图，八张六图对照页截图在scratch：1791360233141、0259786、0280891、0320858、0342683、0369536、0397663、0420109（browser-screenshot同时间后缀）。核对导航换行、宽/窄布局、卡片/表单/关系图与控件遮挡，无可见布局缺陷；Git夹具非Git仓库，截图为明确错误状态，不声称覆盖受管协作关系图。此为模拟宿主布局目视验收，不等于隔离项目真实交互通过。

隔离项目在scratch/real-host-acceptance-I83Gxv；只初始化测试数据与单节点架构。尝试宿主正常Ctrl+O项目表单，前台切换被Windows拒绝时停止键盘，用户置前后继续；没有成功创建/激活该隔离项目，未在真实项目卡片上测试写入。公开ADR0203确认已有本地MCP控制面（PI_DESKTOP_MCP_CONTROL=1，默认loopback37123），ADR0237确认官方SessionTask/desktop.control可创建真实会话；本机无mcp-control.json/监听、也未安装会话编排工具，不能直接接入或开第二个host-core写活跃数据库。未启用新服务/权限/重启宿主。剩余host-smoke与总体验收保持阻塞，不close。

## 0.6.6 宿主主题颜色适配

本地MCP已实际验证：127.0.0.1:37123监听、active清单/PID一致，认证initialize、tools/list、pi_control_describe、pi_project_get通过；不输出令牌、不创建会话。此前未启用的描述是历史状态。GitHub目录API本次返回403而不是超时，原因未确定；主题契约由官方03-plugin-api、Hello主题示例和本机0.16.1 CSS核对，不靠猜字段。

美化单独卡片host-theme-adaptation已登记。读取appearance的base/pluginTheme.css，仅解析匹配root的九个--ds-*颜色，支持有限变量别名、优先级和important；未adopt构建的CSSStyleSheet，不执行布局/字体/图片/URL或导入。内置回退为宿主中性明暗配色，选中/玻璃材质从accent/sidebar派生；切换清除旧值、保留草稿，系统变化不丢初次宿主响应，事件先到时旧响应不能覆盖。不是继承整套宿主主题布局或所有CSS语法；未支持的颜色安全回退。

typecheck/build、65项测试和四页浏览器回归通过。新增贡献绿色主题、根选择器优先级/important、延迟初次响应遇系统变化、URL/循环/展开预算、内置旧值清理、系统实时变化、草稿保留回归；48截图重新生成，实际查看390浅色看板和1280英文深色架构（修正旧紫色优先级残留后），未见遮挡。单次只读审查45e261ef指出别名指数展开/初始竞态/优先级三项具体问题，均修正并回归；未再次启动广泛审查。

PluginPack29文件318639字节，SHA256 11bfccc6ede0b4328b97a24597eb015a75d7cac80ecdd01f5983fc0570c7919f；只有原agent.tool.register提示。未新增框架、权限或脚本CSP放宽，未改变宿主主题、未安装0.6.6/发布市场。当前真实宿主安装0.6.5，主题卡片应保留安装后自定义主题复验阻塞，整体不close。原架构CRLF问题不纳入本次修复；原始指纹过期仍诚实保留。日志scratch/theme-final-tests.log及浏览器输出。

0.6.6源码3ca3610完成release:auto提交后typecheck/build、65测试、主题/四页浏览器及敏感历史扫描后普通推送；no-ff集成main至61d3f79，集成后65测试和浏览器回归通过，远端SHA核对一致，来源/功能分支已清理。新增颜色回归是浏览器断言，不增加node:test计数。日志scratch/theme-delivery.log、theme-main-tests.log。公开REST API403未阻塞Git协议推送；未安装0.6.6或改变宿主主题，宿主复验仍保留。

### 0.6.6实际更新与待办查询

本轮实时MCP工具目录/describe只有plugin/list、themes、views等读取，未提供install/update/reload/market安装；没有调用目录外内部接口。MCP前查询0.6.5 enabled，包SHA匹配后使用正常插件页更多→安装插件包→原生选择框8588270、文件名粘贴准确路径（恢复剪贴板）、点击打开升级。后MCP plugin/list确认0.6.6 enabled/source installed，manifest/views.css/runtime文本与本地一致。MCP用于核对，UI用于安装，不能称MCP执行了安装。未输出令牌/创建对话/更改用户项目数据；临时预览删除。

看板修正0.6.6安装阻塞和过时MCP未启用说明。剩3卡：host-theme-adaptation doing（真实贡献主题复验），host-smoke todo（隔离真实面板全流程），release-acceptance todo（依赖前项和STATE中CRLF误报修正）；不宣称安装后全部验收完成或close。

## 0.6.7 一次启动接续与独立配色

用户选择“一次启动连续已批准待办”“pebrel参考独立配色、跟随明暗”。采用宿主原生手动自动化，不自建循环调度或新权限：ScheduledTaskCreate/List确认ID0e911110-ced0-4202-b04a-f7746fae395a，title接续项目：已批准待办，cadence manual、Agent、perRun、工作区D:/pi-agent-governance。指令限定STATE/看板授权，重读/锁/确认、受管worktree，完成/外部阻塞/新授权时停止，不递归开对话、不定时/安装/提权。入口保存及列出通过，尚未点击运行；不声称已验证完整自动执行。AGENTS和开发文档已写连续接续及停止规则，本机配置不随clone迁移。

默认独立低饱和蓝紫/靛色与淡青背景层次，明暗跟随宿主；可显式切宿主标准配色，本地选择持久化。悬浮圆角侧栏、统一SVG图标、独立页标题、卡片留白和玻璃材质实际改入代码；保留CSP原生拖动、高对比/透明度降级、四页隔离与草稿。没有复制pebrel GPL源码/资源到插件；参考仓库说明和截图文件仅在scratch下载，未做逐像素复制。

typecheck/build、65测试和四页48截图浏览器回归通过；新增默认配色/切回宿主/本地保存/切色草稿断言，旧主题安全及导航回归保留。新截图工具两次did not answer，未完成人工目视或真实宿主0.6.7验收，不能沿用0.6.5布局目视当新版通过。PluginPack29文件325685字节SHA08a898604acf021377110a6aab035fbcb616e7a50817894f9b37df71ce7a9c1e。新包未安装/发布市场，当前安装0.6.6；临时预览删除。日志scratch/continuation-ui-tests.log。

0.6.7源码a5dfcc1在提交后release:auto重复typecheck/build、65测试、配色/四页浏览器和凭据历史扫描通过并同步；no-ff集成main d1a7d5e后65测试和浏览器回归通过，远端SHA一致，源码/功能临时分支清理。日志scratch/continuation-ui-delivery.log、continuation-ui-main.log。原生手动任务在此交付期间没有运行，避免双写；新包未安装/发布市场，不以CI或生成截图代替新目视/宿主验收。

## 0.6.8 对象式工作台

用户批准将工作项和当前任务合并为高频工作台，而非再次换皮。三页导航保留架构与Git；工作台移除常驻工作项表单/KPI墙，总体目标/验收/进度折叠展示，完成语义不合并。对象点击看详情，右键/长按/Shift+F10/更多按钮打开编辑、排序、相邻列迁移、指导菜单；/搜索，过滤时暂停拖动。指导仅生成复制文本，不调用Agent。详情使用非模态native dialog，宽屏保留工作区并返回对象；草稿关闭/切换须确认，保存/迁移披露其他草稿丢弃。离线保留读访问、暂停写入，无重放。

实际读取shadcn/ui Sheet、Context Menu及MIT许可，适配表面/间距/焦点样式，不引入React/Radix运行时、不声称使用原组件。plugin/UI-SOURCES.md保留许可并进入30文件包和发布清单。TS/CSS/浏览器测试按现有风格格式化；README/PROJECT更新实际用法，无后端数据格式或权限变化。

一次只读复核ff2164f5指出确认期间断网仍写、长按过久误开详情、取消键盘迁移丢焦点。新增焦点断言实际red，修复并通过全部浏览器回归；断网确认覆盖工作项保存/迁移与总体进度，持久化不变且重连无重放；2.2s合成长按释放保持菜单，不等同真实触屏验收。目视发现导航指示条整页定位，已修复并重新截图。

typecheck/build、65测试和真实Chromium+隔离治理后端43截图回归通过。最终修正从Git归档叠加到scratch/workbench-clean-d7bf64bf213f4f338104dcd560942772后npm ci/typecheck/build/65测试通过；日志workbench-clean-final.log、workbench-browser-final.log。官方i18n 0 FAIL/2 REVIEW：安装器要求command纯字符串、STATE为数据名，理由沿用。最终PluginPack通过，30文件366580字节，SHA 62a08dfb02e11b0cf4c12174ba548114769f4b56f612a6a66e05a63bba43c65e；既有agent.tool.register需用户授权，无新增权限。

视觉证据在changes/active/project-board-release/workbench-0.6.8/index.html：中英文三页390/768/1280明暗的六张对照图已实际查看，并查看工作台及详情大图。Git fixture为非仓库真实错误，不虚构受管卡片；实际宿主0.6.8/触屏和总体隔离验收未通过。当前安装0.6.6，旧包和发布来源保留；不安装、不提交市场、不总体close。受管登记仍空，保留既有.pi/归档使受管创建受阻，本轮按已授权串行普通分支交付，不伪造git_verify。

补看菜单、新建、搜索空态、离线、读取失败大图后，发现读取失败时顶部误称同步；修正读取异常/损坏board提示与保存后错误保留，新增顶部error断言重测通过，错误截图更新并复核。初始源码cf2cc9575f795c6cc7acb0002b1329dc9147e138提交后release:auto实际typecheck/65测试/43截图/历史凭据扫描通过，来源分支核对一致，无市场调用；该源码的366228字节初版包留在Git历史，不是最终包。最终修正继续同一功能分支交付，不启动第二轮审查。

最终源码ed0da0e1fbdf9aac07bc0234f2541317a13b602a交付检查中断在测试中，无残留进程、远端无对应来源分支；只读核对后恢复release:auto，实际typecheck/65测试/43截图与历史凭据扫描通过，sourceSynced:true、published:false。no-ff集成main 52a08713422381c95680e3103391512e39a50d48后typecheck/build/65测试/browser再通过，普通推送并ls-remote核对相同SHA。日志scratch/workbench-delivery-resumed.log、workbench-main-checks.log。最终包哈希不变；构建后的三个生成文件与HEAD规范化内容相同，git add后缓存diff为空，未reset用户文件。

## 0.6.9 四列验收与项目操作

用户批准待办/正在进行/已完成/已验收四列，人工或Agent验收记录方式、结论、依据与时间，内容修改使验收失效，不通过退回进行中；总体STATE验收独立但界面入口移到顶部。用户说明“地址”为项目操作，要求开始分析、分析Progress与架构重分析按钮，并明确批准新增desktop.control，可能模型收费，实际安装仍须宿主授权。MCP最新只读核对当前安装0.6.7 ready/enabled；用户选择仅MCP更新，当前目录没有安装/更新/重载操作，未进行UI安装或目录覆盖。

board_accept要求done、当前task、expectedItem指纹、结论/依据/验收标签，passing逐项criteria=true。保存验收记录和条件；accepted不能靠拖动进入，内容改变或退回时失效。旧三列数据读取不改写、不自动验收；回退旧插件需对应数据备份。PROJECT/README及工具schema更新，用法未堆教程；新字段仍沿用board v1，新阶段不支持旧插件直接读取。

独立operations.ts通过公开pi.desktop目录固定调用session/create、agent/prompt、agent/getStatus、session/get/open、agent/abort，不使用tool-only collaboration spawn/send、隐藏IPC或MCP令牌。绑定当前项目，提示限定分析只读/架构仅写图/验收仅记录证据，不自动开发或总体验收/Git/安装。提示不是工具权限沙箱；模型选择由宿主继承，不指定委派模型。会话ID先持久化、发提示前重验revision/当前工作区/任务；不明结果不重发。当前项目最多一个活动任务、30条记录，手动进度刷新；仅已记录会话可打开/取消。无ID中断创建须明确人工核对后解除本地阻塞，不取消未知会话；宿主明确拒绝为terminal。会话结束不自动验收，展示不伪造百分比。

一次只读复核8564aad7发现跨任务验收、sessionless创建永久阻塞、延迟status覆盖cancel、Escape绕过顶层草稿。新增真实失败断言后修复/重测；还覆盖宿主明确拒绝响应/提示拒绝、恢复按钮不重发。日志scratch/four-stage-review-red.log、four-stage-task-red.log、four-stage-escape-red.log及对应green；未启动二次宽泛审查。75测试、typecheck/build、47张真实Chromium+隔离治理后端/模拟desktop接口回归通过。最终clean目录workbench-clean-440d15ecc94b4727b39ef94ca1b197c9的npm ci/typecheck/build/75测试通过，日志four-stage-clean-final.log、four-stage-browser-final.log。实际宿主Agent执行/物理触屏未验收。

目视证据changes/active/project-board-release/workbench-0.6.9/index.html：中英文三页390/768/1280明暗对照、人工验收/Agent进度/项目操作/中英详情/错误恢复大图已实际查看。PluginCheck/Pack通过32文件436228字节，SHA e09b95508816bae115c4e52909d1950909e8f065b7156519a0518735f17e9fca。官方i18n 0 FAIL/2 REVIEW，command安装器纯字符串及STATE数据名理由保留。包许可继续包含shadcn MIT；无新运行时依赖。既有受管创建因原有未跟踪目录dirty被拒绝，feat/four-stage-actions串行普通分支，不伪造受管git_verify。新版本未安装/未发布市场；CRLF误报及接续入口执行验收仍保留，不close。

源码0711419fde0b4b3b467b3d0c81ed443ec2cb917a提交后release:auto实际typecheck/build、75测试、47截图浏览器与可达历史凭据扫描通过，来源分支sourceSynced:true/published:false。no-ff集成main 81fca6ddb64ac5c5d70351439ba1147a22e98e68后重跑typecheck/build/75测试/browser通过，普通推送并ls-remote核对一致；日志scratch/four-stage-delivery.log、four-stage-main.log。新包哈希不变，旧包/发布来源保留。最终记录只更新既有卡片说明，不用真实用户卡片作夹具、不自动写accepted；本机0.6.7仍可读。临时分支仅在记录同步且已完全合并、无活动受管worktree时清理。

## 0.6.10 顶部操作面板与任务模型设置

用户要求页面级按钮统一置顶分类，架构重分析不再位于图视图切换下方，并在点击Agent入口后选择模型/思考强度。页面操作、项目任务、显示设置、画布控件置于标题下同一面板，按页面隐藏不相关项；对象编辑/验收和弹窗提交仍就近。开始分析/架构分析/Agent验收共用启动窗口，默认明确使用宿主默认，也可用户显式选择；不持久改宿主设置。

用户明确批准新增只读models.list。pi.models.list只返回已启用已认证模型的SDK元数据，后端投影key/providerId/modelId/名称/支持强度，不传额外字段或凭据。thinkingLevels仅采用宿主声明的标准值，不支持时禁用；显式选择在启动前重验，模型失效/强度不支持则拒绝，不隐式换模型。session/create收到providerId/modelId和可选thinkingLevel，操作历史保存本次选择。加载取消/迟到回应、空列表/权限错误、最终确认显示选择及取消保留选择有回归；只读目录失败时明确提示默认选项，不自动启动。

一次只读复核f8dc1c5e发现模型读取前提交锁保留竞争与取消确认焦点丢失。隔离并发/键盘断言实际red，修复后green；未进行第二轮审查。最终77测试、typecheck/build和真实Chromium+隔离治理后端/模拟模型与desktop接口60截图回归通过。scratch/workbench-clean-149b4963888f4331a71e4ae726fa9327从归档叠加本次修改（排除用户项目数据）npm ci/typecheck/build/77测试通过；日志toolbar-model-clean.log、toolbar-model-review-red.log、toolbar-model-focus-red.log、toolbar-model-review-green.log、toolbar-model-browser-final.log。未实际启动收费模型或安装新版。

PluginCheck/Pack通过32文件459119字节，SHA fa1344e4a9f1d84807cc70833ab5c0b69f98ad0ebf0d2922a70340417fbf378e；i18n 0 FAIL/2 REVIEW理由沿用安装器纯字符串command与STATE数据名。视觉证据workbench-0.6.10/index.html，中英文顶部操作/启动窗口390/768/1280明暗对照及架构/启动大图实际查看。最新MCP只读确认本机0.6.9 ready/enabled，不再沿用0.6.7安装信息；0.6.10实际权限/模型选择执行未验收，不close。

开工前用户已有architecture.json修改与未跟踪operations.json，整个实现过程中哈希保持CD7C6390…A4A9F与C7ACEF62…526D6。用户明确允许它们单独提交并公开同步（已告知本机路径/会话ID/状态），579c89f5f6eed13a6e5aea327cd132a36a349c1a仅保存这两份原内容，未改running状态、不伪造任务完成或作为测试夹具。5节点7关系原分析范围/限制与旧源码指纹保留，不自动“修复”指纹。原有.pi/归档保留；无受管任务，仍串行普通功能分支，不伪造受管git_verify。

源码f305ff5a3481b5788082ebb65b072f88fea817df提交后release:auto实际typecheck/build、77测试、60截图浏览器及可达历史凭据扫描通过，sourceSynced:true/published:false。no-ff集成main 6e9b67c9cdffde6f7892958115e1bc06a04e84f0后重跑typecheck/build/77测试/browser通过，普通推送并ls-remote一致；日志scratch/toolbar-model-delivery.log、toolbar-model-main.log。用户原数据独立提交保持原内容/限制/运行记录，不自动确认其完成；正常Git换行转换不算CRLF误报修复。新版未安装/市场未发布，包哈希不变。预览长图出现一次重复拼接，不将其算为新证据；关键架构/启动大图及操作栏/启动中英响应式对照正常查看。

## 0.6.11 居中详情与稳定四列

用户反馈详情侧栏打开使工作台1×4重排2×2，批准改弹窗并增强列区分。真实Chromium+隔离后端反馈环先确保详情关闭，连续两次复现：列宽232→268，后两列移到下一行。排查CSS联动、JS尺寸修改、滚动/断点三项；直接读取file CSSOM被浏览器安全限制，改为计算样式探针，仅恢复容器padding/标题宽度/网格，几何立即恢复且视口仍1280，确认根因是body:has(item-sheet[open])联动。探针仅在测试页面，已从源码清除，日志scratch/modal-board-red-1/2.log、modal-board-probe.log保留。

详情改showModal居中显示，移除所有打开态压缩/两列CSS，不改背景布局；背景交互暂禁用，焦点受原生模态约束，返回/Escape关闭并回对象。顶部上一项/下一项按当前显示对象导航，边界禁用；切换/关闭草稿保留明确丢弃确认，取消回到弹窗焦点。长内容内部滚动，标题导航/关闭保持可见。四列独立浅底、边框、标题色带/顶边与数量标记，已完成绿/已验收紫区分；高对比/强制颜色用实体边界而不只依赖颜色。手机/中宽仍按视口响应式，不由详情触发。

增加真实几何前后不变、真实:modal、Tab约束、取消/切换边界/关闭返回、全语言/明暗/390/768/1280居中无溢出及静态防回归。测试几何采用文档坐标，避免滚动点击底部卡片误报重排；不强点被模态遮住的背景，主题变化改用宿主事件。typecheck/build与78测试通过，scratch/workbench-clean-80fe96b405af44d0af5b1fdc4c135cd4干净npm ci/typecheck/build/78测试通过；72张浏览器截图及上述交互/几何断言通过，日志modal-board-tests.log、modal-board-browser-final.log、modal-board-clean.log。UI-SOURCES更新真实模态行为并保留原MIT许可。没有改后端、数据格式、权限/Agent逻辑，没有真实收费执行或安装。

PluginCheck/Pack通过32文件462966字节，SHA e16f9b7fa42f9e3af8daf2ce9229825abd1dd9dc524efcd15c87ac35849717ba；i18n 0 FAIL/2 REVIEW理由沿用command安装器纯字符串与STATE数据名。生成视觉入口workbench-0.6.11/index.html，但BrowserPreview后guest不可用、恢复一次仍不可用，未实际目视，不沿用0.6.10截图作为新版通过。最新只读MCP核对本机0.6.10 ready/enabled，0.6.11未安装/真实宿主复验。不总体verify/close。原有.pi/旧归档保留，本轮只在普通串行功能分支修复，不伪造受管git_verify。
