# 启动器与工作面板轻量入口

用户明确批准ui.panel/ui.view，仅用于同一轻量入口页；真正业务工作台仍只在浏览器。Alt+空格启动器依赖ui.panel，右侧工作面板插件列表依赖contributes.views（ui.view）；不是左侧聊天/项目栏，不修改PI本体或安装文件。官方源码核对固定vastsa/PI-Desktop ddaa4148437f58f8db65026e8793bafed7ee10b1，Hello及内置Browser示例、ADR0072/0104和API桥接文档。

## 实现与检查

- 同一entry/index.html用于两个声明。仅当前项目、连接状态、刷新和显式打开按钮，中英文/明暗/键盘/窄屏，遵循v2原生chrome占位。无iframe、看板、聊天、地址输入或自动跳转。
- onPanelInvoke仅允许governance.entry的status/confirmed open，版本哈希绑定可见项目与epoch；打开前后重核对，缺失/相对项目/过期/切换拒绝。仅回传workspace/open/revision，无origin、私有URL或原始异常。其它治理/Agent/模型动作不开放。
- 入口加载只读状态，view:open/pageshow恢复/项目切换不打开；迟到状态忽略，错误不自动重试，不持久化链接或聊天；服务仍用原manager及生命周期。命令和可信调用会话工具语义不变。
- npm ci0漏洞、类型/构建及完整188/188零跳过通过；新增4桥接用例验证显式/错误参数/跨项目代次/开服失败清理。真实Edge入口8图（双语/明暗/独立窗口及停靠模拟）、显式打开真实HTTP、重复/键盘/恢复/迟到/失败守卫通过；系统浏览器打开器用stub，没有实际安装后E2E声明。
- main桥接使行为绑定读取500144字符略超500000。仅抽出独立完成历史种子数据到history-fixture.cjs，原调用点串行执行所有历史/行为断言，WS/AD守卫和有效绑定不删、不提高预算；498404字符及原10场景重跑通过。最终类型/构建/188测试零跳过和98+7+2+8图（115图）完整浏览器回归通过。
- 官方PluginCheck/PluginPack已实际通过，77文件820278字节，SHA256 dda680e71eda233856c67a18985e1d4706c7551a3da093b1e19b4434b5eeb1b2；入口由宿主声明挂载所以ui.panel静态unused提示保留，固定main转接的工具/浏览器调用实际在runtime中。最终提交后/main/CI结果继续更新。版本仍0.7.8，不自动安装/升版/建标签/市场/npm/Release发布；原总体阻塞、暂停桌面及未合并工作保留。

## 交付

- 实现413eef87cfec2283ff649a30683cab4af02ab8e4提交后类型/构建、188测试零跳过、115图和原10行为全部通过。两目标分发/readAssets四资产通过；通用包保持133443字节SHA264d367bcd9df2f74d4033e32a8643e000015302301890962b9d55d3d2da7a9a，官方77条目与源码归一化匹配。release:auto -- --plan为publish:false/mutation:false；受管git_verify已登记。
- main集成eb7be14e461afff6ce0f64186d353cec04937d29，重新干净npm ci（0漏洞）、类型/构建/188测试、115图/10行为、分发/readAssets及只读发布计划通过，正常push后ls-remote完整SHA一致。
- 实际[Tests39033694625](https://github.com/Tonkic/pi-agent-governance/actions/runs/39033694625)对应该main，Ubuntu与Windows全部步骤success，生成物无差异、完整测试、行为及浏览器通过。平台Node/runner迁移提示非本次失败，不扩展升级范围。
- 仅本工作项完成，总体仍working，原外部检查保留。这里验证公开声明/真实DOM/编译适配器/HTTP；宿主启动器与停靠框架模拟，系统打开器stub，不等于用户安装后端到端或目视。用户仍需手动更新/重载该包并授予两项入口权限。
- 无新增依赖、版本或自动安装/收费模型/市场/npm/标签/Release动作，不触碰PI安装文件或暂停桌面。后续无新可执行followUp时停止；只清理本次已合并且无工作区占用的授权分支，其它追溯/占用分支保留。
