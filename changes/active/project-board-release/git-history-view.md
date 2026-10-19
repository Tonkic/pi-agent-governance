# 只读Git提交图与二级详情

## 结果与范围

- 用户明确批准实施：最新在上、早期在下，真实分支/合并连线，节点进入二级提交详情/文件差异，返回保留图位置。
- 默认“提交历史”，保留“受管工作区”与原验证卡片；不执行checkout/merge/reset/fetch/push，不联网，不升版本/重提市场/自动安装。
- 独立 `git-history.ts`、`renderer/git-history.ts`，固定 `governance.gitHistory` list/detail/diff。原写入登记不变。
- 每页100提交、最多5000/64并行线；HEAD/refs/浅边界快照绑定，变化须手动刷新。未加载/浅克隆不冒充仓库起点。
- 第一父差异、根对空树、重命名D/A；textContent显示，敏感/链接/二进制/超大内容不预览。缓存16详情/8差异。

## 来源与修复

- 后端worker `2421a0a2fb1ae5c911ba086b62f7587425cd5b3c`，26真实Git测试、type/build通过并受管验证；仅写分配的3文件，无merge/push。
- 协调UI提交 `c821d85d9f35dde77f94005c1fa1da2a92d3a949`；受管集成 `8db71a4b5e589637afbe258de6d170f7d95fe2c0`。无同路径并发写入。
- 最终产品/测试/官方包来源 `010d6307f9285752e1979493df0fd490219324ca`。
- 真实浏览器暴露桥接自动附加workspace而严格后端拒绝；适配层先验证身份后剥离传输字段，HTTP同工作区/外工作区回归与原浏览器red→green。
- 一次只读审查另发现浅仓库deepen保持shallow=true仍改变历史；新增请求间/请求中浅边界回归先实际失败，再把有界只读边界集合纳入revision，转绿。
- 同次修复空patch空白行；测试选择器限定详情父按钮，避免误计SVG父边。无提高预算或删除安全断言。

## 实际检查

- 集成定向53测试通过；最终后端27＋HTTP6＝33通过，原真实LF/CRLF及500000硬预算2测试通过。
- `010d630` 提交后 `npm run check -- --full --ci` 成功：双TS检查、一次构建、250测试，0失败/0跳过，原10行为全部通过。
- 完整浏览器共279截图：主目录269＋受管服务2＋轻量入口8；其中新增Git图24张，真实108提交/分页、分支merge双父/tag/root、中文patch/保护内容、返回scroll/focus、键盘tabs、离线缓存/错误/无重放/迟到/epoch全通过。
- [截图节选](git-history-visual/index.html)。BrowserPreview已请求，截图工具仍报calling session未前台；未完成本轮人工目视，不以自动截图代替。
- 官方i18n：0 fail/12 review；PluginCheck/PluginPack：86文件、原4项权限/转接入口warning，manifest/权限/依赖/版本不变。
- `build:distributions` 核对官方包完整清单及源码成功；`release:auto --plan` 为publish=false、mutation=false，无发布写入。
- Windows生成stat仅通过现有严格HEAD=index=normalized-working-content证明刷新；未丢弃修改。

## 产物与交付

- 官方0.8.3：1043231字节，SHA256 `eb6a0f543bb34667f62e20ccdb03a54124971a06a34c2295d39174457429cc20`，官方工具真实生成。
- 通用MCP/Skills：165495字节，SHA256 `2caf06655b48c4a60876fe0718b9afa384ee100cf7a3b2a815449a141ad04bcf`；asset-manifest绑定来源010d630。
- 被替换reader修复包 `39f4acdc2f60dbafba75896da2525861c861e897ca39d5038996d5f60cf154de` 可从历史dd8d518取回；当前包也不是此前市场approved包。
- 首次main `303edaa98ccb4ffe7a0c5555d8367c916df9aed8` 文件树与协调记录提交7f52586一致；与已全测010d630仅STATE/证据/截图不同。正常push且远端SHA核对。
- 真实main HTTP/浏览器探测：100提交、HEAD、详情、README文本diff、返回成功，0页面错误，STATE/看板字节不变；[实际图](git-history-visual/actual-graph.png)和[详情](git-history-visual/actual-detail.png)保存，短测试服务已关闭。
- 首次CI39233866988：Linux全通过；Windows249/250，新增HTTP夹具临时根含RUNNER~1短名，未满足真实路径契约。未把失败记为通过。
- 本机用真实8.3短名复现同一409，两个新夹具改native realpath；短名环境6HTTP＋Git24截图回归转绿。生产源码/包未变，不重复本地全量。
- 测试修正来源 `42bdca2f908a6cf8d8fa2e4801592ba1b65f0e51`；main `385ae4aefde29f7d1002e201898d2f552c452c82` 树完全一致，正常push/远端核对成功。最终CI [39234951619](https://github.com/Tonkic/pi-agent-governance/actions/runs/39234951619) 全步骤成功：Linux160秒/Windows494秒，各250测试、0失败/0跳过，279截图/原10行为通过。
- 完成记录仅STATE/看板/本证据，不改产品/包/测试输入；本地records检查通过，最终记录同步走轻量CI，不冒称记录SHA重新执行产品全量。

## 边界

- 仅可信仓库；Git配置/对象与外部并发不是OS沙箱。差异需Git支持 `--attr-source=<提交>`，不作不安全降级。
- 历史不初始化/写治理文件或锁；旧受管查询可能创建本机登记目录，职责分离。
- 自动交互不等于实体触屏、人工目视或已安装宿主完整E2E；原总体阻塞和暂停桌面保留，整体任务不close。
- 市场此前approved待运营发布状态保留；本轮未查询、覆盖或重提，未自动安装/标签/Release/npm发布。
