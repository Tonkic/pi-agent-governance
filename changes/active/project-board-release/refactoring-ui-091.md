# 0.9.1 — Refactoring UI展示层重构

## 结果与边界

- 用户授权直接重构；基于0.9.0 main `ffd887b4e94a0ae691e26d54535159342fbb5c8a`，受管分支agent/refactoring-ui-091。
- 去掉常驻欢迎、大统计卡和永久概览侧栏；任务全宽，统计紧凑，项目概览默认收起，低频宿主工具通过原生details显示。
- tokens → 基础控件 → shell → 业务视图 → 阅读器，各有样式归属；shell.ts仅负责导航、折叠与已载入快照投影，不调用API/写数据。
- 保留五页、64/212px悬浮导航、键盘/触屏、18px安全阅读器、只读真实Git及原生详情模态。
- 不换框架、不动SSH和写入/确认/修订/锁/离线/epoch保护；未新增权限或依赖。书籍仅作原则参考，不分发PDF、摘录或素材。
- 0.9.1为patch：不提交市场，不重试0.9.0拒绝；不自动安装/npm/标签/Release。

## 实际检查

- 干净npm ci后开发构建；最终 `npm run check -- --full` 全部通过：280测试、零失败/跳过，279截图、10行为。
- 完整检查覆盖类型/生成一致性、核心/SSH/HTTP安全、两类分发fixture、五页/中英/明暗/响应式、文档链接/Git模态、断网/迟到响应/跨项目隔离。
- 新布局断言：320/390/768/1280/1672px中英明暗任务区顶部<520px；概览默认收起且不占任务宽度；键盘展开仅使用已有快照，无额外查询。
- 修复开发中发现的首屏占高：连接帮助移页尾并默认折叠，架构后续提醒放任务区之后；保留顶部错误/离线/切换提示。未放宽断言。
- VM fixture补齐不存在元素及before语义；兼容工具测试通过真实summary点击，不强制点击隐藏控件。原会话/模型/确认/隔离断言保留。
- WS-001来源补充shell.ts及编译产物；500000原始字符/60文件预算未改，绑定与断言未删。
- 官方i18n gate：0 fail / 12 review（命令纯字符串、品牌及轻量入口静态fallback等提示）；不影响安装校验。
- PluginCheck/PluginPack通过：103文件，1886208字节；SHA256 `aa9be0204375f267212888c07a129cce619d4745e5798bc3c1e7f9c24c3f3aea`。
- 官方包：`plugin/dist/io.github.tonkic.agent-governance-0.9.1.piplug`。原有权限风险/转接入口未使用提示4条，无新增权限。
- [代表截图](refactoring-ui-091-visual/index.html)来自真实HTTP临时演示项目；完整日志/截图在会话scratch的ui091-final目录，不含私有URL。

## 交付状态

- 产品提交 `2cc36dcbf2af0404c8a2b4ce92d38b23212ea20e`；正常合并main `3a028cfe49560e0cb025cba3d9fda3a4d6f4dbae`，内容树完全相同，已推送并核对远端SHA。
- main实际构建与HTTP页面探测通过：五页切换、390px无整页溢出、概览额外请求0、页面错误0；STATE/看板/Git引用不变。主目录缺依赖及manifest临时占用已恢复，未改源码。
- [CI 39783999993](https://github.com/Tonkic/pi-agent-governance/actions/runs/39783999993)在上述main SHA上Linux/Windows全部步骤成功，各280测试、0失败/跳过、279截图和10行为；不是等价SHA冒称实际执行。
- 干净产品提交上两类分发核对通过：通用包315571字节，SHA256 `b0066be89e91f1df89a467a46b927c145b3cfc88669d67c616ce34e9a8357266`；官方PI包与上文哈希一致，来源绑定2cc36dc。
- 只读语义计划确认0.9.0→0.9.1、patch、versionMatches=true、marketplaceRequired=false，未执行任何发布写入。
- 本轮工作项移到已完成；后续仅STATE/看板/本记录收尾，产品内容与官方包不变，按records检查而非重复全量。
- 内置Browser再次返回未进入当前会话前台，未声称人工目视或真实安装宿主/物理触屏验收通过。
- 总体STATE仍working，原宿主/目视/0.9.0市场拒绝阻塞保留；暂停的原生桌面未动。
