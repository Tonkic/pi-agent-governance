# 0.8.4 Git图交互与加载修正

## 用户授权

- 删除受管工作区网页与自动查询，保留Agent底层Git/worktree安全API与既有数据。
- main固定居中、分支可辨，节点不铺常驻说明；hover/键盘聚焦看摘要，点击弹出二级详情模态，关闭回原节点。
- 本轮交互/性能修正升0.8.4，不访问/提交PI市场；后续已批准产品更新自动语义判级升版，功能/不兼容大更新在完整验证/官方包/main双OS CI后Agent提交市场一次。原未知写入/待审/安装边界保留。

## GitHub研究

- 实际读取Gitgraph.js `ed72d11d1e50ccd208326d9ded551f719cfa2b3a` 的branches-order.ts与SVG实现，MIT；VS Code Git Graph `d7f43f429a9e024e896bac9fc65fdc530935c812` web/graph.ts，MIT。
- 借鉴显式主分支排序、固定颜色、真实父边和hover概念，未复制代码/资产、未打包库、不新增依赖/资源。规范来源见[UI来源](../../../docs/ui-sources.md)。

## 性能与安全

- 同一真实仓库main `d9a3cc60acdc387fda4f0e76c5b0b6aa4a7a2ff0`，100提交读取旧实现三次2496/2601/2452ms，各110进程；新实现341/332/338ms，各13进程。本机约7倍，非整页加载承诺。
- list采用大小预检和有界cat-file批次，按对象声明字节长度解析帧；每批1MiB、每元数据256KiB、单命令10秒/请求30秒仍不变，超大提交保留有界前缀路径。
- 新mainline数据是真实main第一父链，最多5000；无main明确master/origin/main/master或HEAD后备，分页快照绑定HEAD/refs/浅边界。
- 新性能/主线2回归实际先red：旧110进程及缺失mainline；修复后后端29/29通过，原路径/注入/无写入/浅克隆/环境隔离/SHA256等保留。
- update-plan新增7/7通过：patch不市场、feature/breaking需市场、记录不升、未知待评估、严格版本/SHA、CLI不写入。脚本只读计划，Agent按真实目标补判，非任意语义自动理解。

## 验证与交付

- 界面worker `cd02f88da8dbd7917e07cddb8b6bada7c68e194e` 经受管审查/提交/验证后无冲突集成；main中轴使用新mainline，侧线保留真实父边/当前引用身份。节点44px命中区、零额外查询tooltip、原生showModal详情/关闭/Escape/背景/回焦滚动通过；无受管UI/自动governance.git。
- 集成源码 `6f614441086c77a8e17beafb79df8e85b58c5e86` 实际执行一次 `npm run check -- --full --ci`：259测试、0失败/跳过、279截图、原10行为全部通过，包含真实LF/CRLF的500000字符硬预算回归。
- 官方PluginCheck/PluginPack：0.8.4、86文件、1065669字节，SHA256 `766609afd0f19cb12cf2b0d434b9704947caad03b523a910b0ffdc2908125bae`；i18n 0失败/12既有review，官方4既有权限警告，无新增权限或依赖。
- 最终产品/包提交 `1fc8bff0a8d87c8f60e9affc6494b2565e16d646`，仅比已测集成增加根README规则修正及官方包替换。build:distributions核对全部包条目/版本/来源通过；通用包168707字节，SHA256 `7d96b87635afaed2d76d6ceddc75b7e95bb0562ec4b8d3418cd6e09bf217e7a2`。旧0.8.3包由main历史d9a3cc6可取回。
- update:plan按实际已批准交互/性能修复 `--impact patch --check`：0.8.3→0.8.4、marketplaceRequired:false、mutation:false。只读release计划publish:false/mutation:false。没有市场/凭据访问、安装/npm/标签/Release。
- main `1a09abf7688e2b9269efdd5497856c4e28ee84f3` 与最终产品提交树相同，正常推送/完整远端SHA已核实；[CI39240834305](https://github.com/Tonkic/pi-agent-governance/actions/runs/39240834305) Linux170秒/Windows520秒全部步骤成功，各259测试/0失败/0跳过、279截图、原10行为通过。
- 真实项目整页Git入口实测：集成代码429ms、main代码421ms，100提交/一次list、hover零额外调用、点击原生modal/关闭回焦、无受管调用/页面错误、STATE与board逐字节不变。首次探针把图最上节点误当HEAD，已改为核对真实HEAD节点与main轴；未改产品排序。
- [截图对照](git-history-polish-084-visual/index.html) 保留真实main图/tooltip/dialog与手机/英文暗色fixture。BrowserPreview已请求，截图仍报当前会话未前台；不宣称人工目视、安装宿主或物理触屏通过。
- 当前后续仅STATE/看板/本证据与截图记录，复用上述等同产品检查，不冒称记录SHA重跑全量；记录快路通过后同步main。原总体安装宿主E2E、人工目视、0.8.3市场approved待运营及暂停桌面保留，不整体close。
