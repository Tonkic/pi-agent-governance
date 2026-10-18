# 开发

**小改定向测，公共改动全面测；合并看实际变化，不重复测试。** 需要 Node.js 22+。修改 TS 或规范说明后构建，不手改生成 JS、manifest 或包内说明。

## 简洁流程

1. 确认目标，说明“改什么、影响哪里、测什么”。小任务默认由一个 Agent 直接完成，不额外拆分。
2. 修改并补测试。开发中运行新增功能和直接受影响的旧测试；不要每调一行就全量。
3. 完成后审查差异，更新必要说明，运行选定检查，再提交、合并、交付。
4. 提交本身不要求重跑；合并时核对实际变化。无变化复用已测内容的证据，冲突解决/并行组合只补测受影响部分。
5. 公共/安全/依赖/构建/未知改动及大版本交付，最终完整检查一次。拿不准就扩大范围，不能用“无Git冲突”当通过证据。

## 检查命令

首次或锁文件变化后执行 `npm ci`，无需每轮重新安装。`check` 每轮仅构建一次；完整浏览器检查同时生成行为证据，不再重复核心场景。

```powershell
# 局部开发：选直接相关的范围，可用逗号组合 docs,reader,entry
npm run check -- --scope reader
npm run check -- --scope entry
npm run check -- --scope docs
# 仅完成记录：JSON结构与差异检查，无构建、依赖安装或产品测试
npm run check -- --scope records
# 公共/高风险/未知改动、大版本，或手动兜底；无参数也默认完整
npm run check -- --full
# 根据两个已提交的完整SHA自动选范围；不包含尚未提交的修改
npm run check:plan -- --base BASE_FULL_SHA --head HEAD_FULL_SHA
npm run check -- --base BASE_FULL_SHA --head HEAD_FULL_SHA
```

| 范围 | 自动识别与实际检查 |
| --- | --- |
| records | STATE、看板、notes/changes下的md/png/html；检查JSON与差异，不跑产品测试 |
| docs | 根说明、docs及包内生成说明；构建一次，检查布局/链接/说明生成与分发，不开浏览器 |
| reader | 仅文档renderer及其两个局部浏览器用例；文档只读/HTTP测试＋原阅读/排版/共享壳层浏览器回归 |
| entry | 仅PI轻量页HTML/CSS/JS及其浏览器用例；入口单元和浏览器回归 |
| full | 共享renderer、后端、安全、依赖、版本、包、检查脚本/CI、未知文件：类型、一次构建、全部测试及行为/浏览器 |

映射固定在 `scripts/check-plan.cjs`，不是智能依赖分析。自动范围取完整差异，改名两端均检查；缺基准/浅历史/异常一律full。显式scope仅用于已确认影响范围的本地开发，不等于完整交付证据。可直接运行构建后的某个测试进一步缩小迭代范围。

普通CI只监听main push、PR和手动执行：记录/文档/已知局部跑Linux，公共/未知跑Linux＋Windows；手动运行始终full。记录不安装依赖，其他范围使用npm下载缓存，需浏览器时才安装Chromium。`--ci`在构建后核对生成文件无差异；任一失败立即停止。大版本发布另强制双系统full，不因版本号小就免掉公共风险检查。

`npm test`兼容执行全部非浏览器测试，`npm run test:browser`执行完整浏览器及行为证据，`npm run check:behaviors`可单独检查行为。三者各自独立会构建；需要组合时只运行一次 `check --full`，不要串起来。局部检查不会刷新“全量行为通过”状态。

## 目录

| 路径 | 职责与相关测试 |
| --- | --- |
| plugin/*.ts | 主进程核心；任务/governance、project、git、operations等对应test；公共改动full |
| plugin/renderer/ | 共享浏览器TS/HTML/CSS；panel/browser及各局部用例；共享壳层full |
| plugin/entry/、entry-bridge.ts | PI同一轻量入口；entry单元/browser；bridge和manifest改动full |
| mcp/ | stdio和只读宿主Hook、客户端配置；真实SDK/EOF测试；非安装客户端E2E |
| web/、browser/workbench模块 | 同一HTTP服务/桥接/租约/打开器；web/workbench及真实HTTP浏览器回归 |
| plugin/behaviors.ts、scripts/check-behaviors.cjs | 行为绑定和来源证据；behaviors测试，完整检查共享一次核心浏览器 |
| scripts/、test/ | 手写工具和测试；发布/分发/检查入口属公共改动，full |
| docs/ | 当前说明唯一手写来源；layout检查生成一致、链接和100行上限 |
| plugin/runtime/ | 生成JS及web复制资产；宿主与发布使用，不手改 |
| plugin/manifest.json、main.js | 生成清单与固定转接入口，不手改 |
| plugin/README.md、plugin/docs/ | 从docs生成并提交的安装包说明 |
| plugin/dist/ | 当前官方包；旧包可从Git取回 |
| build/ | 忽略的编译中间文件、CLI/测试及分发产物 |

`build.cjs`清理固定build/runtime，编译并生成说明/入口；生成器拒绝链接或未知手写文件。不要在生成目录放手写内容；构建期间保持可信、独占。普通build不推送、发布或安装。

构建后状态读取：`'{"action":"status"}' | node build/scripts/governance.js`。首次浏览器检查可运行 `npx playwright install chromium`，本机可用 `PI_BROWSER`指向已有Edge/Chromium。浏览器/服务测试不等于安装后宿主交互、物理触控或付费模型验证。

本机`/.pi/`和既有`/changes/archive/redesign-governance-panel/`经批准忽略，保留内容；不扩大忽略或放宽dirty门禁。历史证据、许可、有效数据及暂停worktree保留。

## 交付与接续

按[交付流程](releasing.md)审查提交、同步main/GitHub；插件变更用官方PluginCheck/PluginPack，不用shell自制包。证据来源和合并复用规则见[Git协作](git.md)。

PI-Desktop“自动化”手动任务“接续项目：已批准待办”在独立宿主会话读取AGENTS/STATE/看板，连续处理获批范围，完成/真实阻塞/需新授权时停止。不是定时唤醒；不自动安装、改权限或递归创建会话。本机配置不随clone迁移；启动前结束同项目其他写入，不重复点击。
