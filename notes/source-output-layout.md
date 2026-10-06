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
