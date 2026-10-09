# 0.7.0 — Workbench and documentation maintenance / 工作台与文档维护

A minor release collecting the reviewed improvements since marketplace 0.6.0. Same community ID: `io.github.tonkic.agent-governance`; project data remains in the workspace.

## Highlights / 主要变化

- Four work-item stages: To do → In progress → Completed → Accepted. Acceptance records bind evidence to the item's current content and task; completed Agent turns are not an automatic pass.
- Centered modal details keep the board geometry stable. Previous/next navigation, draft-discard confirmation, keyboard focus return, search and contextual actions preserve object-level workflows.
- Confirmed project analysis, architecture analysis, item review and documentation-maintenance tasks run in dedicated project-bound sessions. Select an enabled host model and supported thinking level for the new session only; inspect, open or cancel recorded tasks without background polling.
- “Update docs” maintains the currently open project's `docs/`, `notes/` and necessary root entry links, not plugin versions or functional code. Concise Microsoft-style topics use progressive disclosure; Notes summarize additions, removals, changes and lessons. Packaged documentation is generated from the canonical `docs/` sources.
- Independent light/dark-following palette with optional host colors, clearer column boundaries, native host drag-chrome compatibility, separated TypeScript/runtime outputs and project rendering before slower Git reads.

四列看板新增明确证据验收；居中详情不挤压看板，保留对象切换、草稿确认与键盘操作。顶部任务支持独立会话、单次模型设置和运行记录；新增「更新文档」。当前说明集中到 docs，简短变更与踩坑集中到 notes，旧历史原文归档。配色、列边界、宿主拖动兼容、构建目录及加载响应一并整理。

## Permissions and upgrading / 权限与升级

Relative to marketplace 0.6.0, this release adds `desktop.control` and read-only `models.list`. The publisher explicitly approved both for 0.7.0. End-user grants remain controlled by PI-Desktop.

- `desktop.control`: after confirmation, create task sessions, send prompts, read bounded progress/results, open and cancel recorded sessions. Models may incur charges; documentation tasks may write current-project docs/notes and necessary root entry links.
- `models.list`: read available model metadata and thinking levels. No host default changes or credential access.

从市场0.6.0升级须确认两项新增权限；自动更新不得静默扩权。相同社区ID的数据继续保留。旧 `pi.agent-governance` ID仍需停用旧实例后首次安装新ID；回退前备份 STATE、`.governance/` 和旧包，旧版本不支持 accepted 阶段。

## Verification and limits / 验证与限制

The release uses clean dependency-install/type/build checks, 83 regression tests, a real isolated Chromium run producing 74 screenshots, bilingual responsive/theme visual review, i18n validation and official PluginCheck/PluginPack. Browser checks use simulated host/model APIs and a real temporary project backend, not paid Agent execution or full installed-host acceptance. Publication checks and exact package/source evidence are recorded separately; publication is not overall task completion.

验证覆盖干净构建、83测试、74图隔离浏览器回归和双语三尺寸/明暗目视，另执行国际化及官方安装包检查。真实宿主完整交互、物理触屏和收费模型执行未完成，不以发布成功替代。

Source fingerprints include raw disk bytes and line endings; a CRLF/LF-only change can require rereading and verifying the referenced sources. Prompt restrictions, locks and caller-attested evidence are not a security sandbox. Canceling an Agent task does not roll back files already written.

源码指纹包含换行，CRLF/LF切换可能要求重读核对；不能盲目刷新指纹。PI-Desktop 0.16.1 implements plugin install/update internally but does not expose those mutations through its local MCP catalog. This plugin does not install or update itself, read local MCP tokens, or bypass host permission checks.
