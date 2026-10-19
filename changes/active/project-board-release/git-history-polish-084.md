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

## 进度

- 协调工作区git-history-polish-084、独立界面worker git-history-polish-ui，严格分文件，不并发写同一路径。
- 后端构建与29测试、更新计划7测试已执行；UI集成/真实浏览器/完整检查/官方包/main CI待完成后更新本记录。
- 原总体人工目视、安装宿主E2E、0.8.3市场approved待运营发布与暂停桌面保留，不整体close，不安装/标签/Release/npm。
