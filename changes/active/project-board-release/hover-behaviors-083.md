# 0.8.3 — 悬浮导航与行为文档一级页

**源码与官方包已交付；市场0.8.3为 approved，等待运营发布，尚未 published。**

## 范围与授权

- 用户批准两项合并为0.8.3，并单次同步PI-Desktop插件市场；不改变长期自动发布规则，不自动安装/标签Release/npm。
- 默认64px图标栏；鼠标移入或键盘聚焦覆盖展开212px，正文不位移。移除按钮/展开偏好；窄屏五项导航可直接操作。
- 行为文档升级 `#behaviors-section` 一级页，按需只读、来源/六类证据状态、手动刷新；保留离线内容、错误手动重试、项目epoch/root/request迟到保护。
- 依赖、权限、后端API与原文档读取安全限制不变。市场相较0.7.0采用先前已批准的现行权限清单，移除models.list；安装时仍需用户授权。

## 实际检查

- 来源提交 `d0bb8b8148f614cefd532f3aac3b22f570664ed7` 实际执行 `npm run check -- --full --ci`：类型/一次构建、219测试、0失败/0跳过、251截图、原10行为通过。
- 截图组成：核心98、真实HTTP7、参考UI20、文档12、排版28、壳层60、行为页16、托管生命周期2、轻量入口8。键盘/触屏为浏览器模拟，不是实体触屏验收。
- 行为证据如实记录sourceCommit d0bb8b8、workingTree:true；构建生成文件随后用严格HEAD=index=规范化内容证明并刷新stat，实际源码无差异，未伪造干净证据。
- 官方i18n为0失败/12提示；PluginCheck/PluginPack通过，4条既有权限/转接入口静态警告，无新增权限。82条目逐一匹配源码，锁文件/manifest除版本外与0.8.2相同。
- 行为预算初次502408超限；40行历史阅读断言原样移到串行helper，无断言/绑定删除，最终498781/500000字符、27/60文件。
- 鼠标选页解除悬浮/焦点以免遮挡操作；默认收起改为真实pointermove激活。保留原首屏、18px排版、安全与迟到断言，不用force click。
- 分发首轮因生成文件stat噪音被干净门禁拒绝；严格证明后通过，未放宽门禁。`build:distributions`及`release:auto --plan`通过，publish:false/mutation:false。

## 交付与来源

- main `1a03e653d85746298c813b3972431db7c85dba86` 正常推送，远端完整SHA一致，内容树与已测d0bb8b8完全相同，不机械重跑本地全量。
- 实际 [CI 39213296229](https://github.com/Tonkic/pi-agent-governance/actions/runs/39213296229) 的plan、Ubuntu、Windows全部步骤成功；市场提交前再次核实同一SHA与全部步骤。JSON证据在本次scratch。
- 官方包 `plugin/dist/io.github.tonkic.agent-governance-0.8.3.piplug`：82文件、928983字节，SHA256 `fdb5aaf81bcecd8a175bc4303bdec42636a7603b4d83e930dd83307e520f22cf`。
- 通用包 `agent-governance-mcp-skills-0.8.3.tgz`：149799字节，SHA256 `dc669ba6d3b5392015de3cec0c3b92cc3a8a06df3de477ef38441b1de3af7539`。构建清单绑定来源d0bb8b8。
- 旧0.8.2包核对原SHA后仅替换当前目录，历史仍在Git。最终完成记录只走records快路，不重建产品或包；结果随最终提交登记。

## 市场：已批准待发布

- 只读核实拥有插件、绑定Tonkic/pi-agent-governance、无待审版本；check_version确认0.8.3 available:true/exists:false。
- 2026-10-19T07:09:35Z单次submit_version，绑定已推送main `1a03e653d85746298c813b3972431db7c85dba86`，81运行文件及完整manifest字段，不含manifest文件/项目数据/凭据。
- 提交与随后唯一一次plugin_status均返回 **approved**，blockers:0、findings:[]、reviews:0。平台提示：the release passed the automatic gate; an operator still has to publish it。
- 平台重建包929027字节，SHA256 `a5a9914db393480bbc10e261bef60c2057b1b9d0918c5629b2b09f6dcec248f4`；不是本地官方包字节，不声称已公开下载或已安装。
- 尝试日志 `.git/pi-governance/releases/io.github.tonkic.agent-governance-0.8.3.json`，payload SHA256 `8cc702d455e8bd69749b6cf35aab3e6bb44987197e6f179f0d497255678a9d28`；无覆盖、重复提交或市场pack预调用。
- 后续需市场运营发布；本轮停止市场写入，不自动安装、创建标签/Release或发布npm。

## 保留限制

- [最终截图](hover-behaviors-083-visual/index.html) 已保存；内置Browser再次报未进入当前会话前台，本次目视未完成，不把自动截图当人工验收。
- 原总体安装/宿主完整E2E/换行指纹/一次启动接续检查及暂停桌面保持，整体任务不close。
