# pi-agent-governance

Repository-level agent engineering governance for PI-Desktop.

基于“Docs 保存当前事实、Notes 保存可复用经验、State 保存当前任务”的治理插件 **v0.1.0 MVP**。零运行时依赖，Node.js 20+。

## 已实现

- `init`：初始化 AGENTS.md、STATE.json、Docs，保留现有文件。
- `start / progress / status`：单活动任务状态机及临时 Change Workspace。
- `context`：Docs → Contract → Notes → Source 逐层读取，升级必须说明原因；限制文件数量及上下文大小。
- `route`：规则驱动的 L0–L3 复杂度、模型档位和审查建议。
- `verify`：要求验收项、测试证据、Diff 审查记录，记录所提交文件的 SHA-256。
- `gate`：逐项判断行为、接口、稳定事实、踩坑、决策；需要沉淀时必须提供现有 Docs/Notes 引用。
- `close`：校验门禁和指纹后归档，清空当前状态；支持归档后状态更新中断恢复。
- 文档行数预算、路径检查、原子文件替换及跨进程互斥锁。

## 安装

在 PI-Desktop 中安装仓库 `plugin/dist/` 下的 `.piplug` 文件；开发时加载 `plugin/` 目录。工具名称为 `governance`，宿主可能添加插件命名空间前缀。此插件没有独立 UI 面板。

安装后向 Agent 说：

> 使用 Agent Governance 插件初始化当前项目，保留已有文档。开始开发前读取状态，完成后提交验证证据并执行知识门禁。

详细参数和示例见 [插件使用说明](plugin/README.md)。

## 本地开发

```powershell
npm run build
npm test
'{"action":"route","features":{"modules":2}}' | node scripts/governance.js
```

CLI 以**当前工作目录**为目标仓库，从 stdin 接受一个 JSON 对象。`init` 会在该目录创建治理文件，请先确认位置。

打包使用 PI-Desktop 的 `PluginCheck` 和 `PluginPack`，不手工生成压缩包。`npm run build` 从 `plugin/tool.js` 生成 manifest，避免运行时工具参数与声明不一致。

## 安全与诚实边界

这是工具级工作流门禁，**不是宿主级安全沙箱**：其他工具仍能直接读代码、写文件或结束回复。未实现全局 Finish Hook、自动上下文注入、自动模型切换、多 Agent 调度或 worktree 隔离。

验证与 Diff 审查由调用方提交；插件不执行测试、不运行 Git，也不证明证据真实。指纹只覆盖显式提交的现存文本文件，不能发现遗漏文件、删除文件或未提交的变更。知识门禁检查结构和引用，不判断文档语义是否正确。文档预算仅检查提交验证或门禁引用的文件。

文件操作使用 Node fs，不经宿主 fs 权限网关。范围为宿主返回的当前工作区主根；拒绝路径穿越、子路径符号链接/junction 和常见凭据文件。不得用于有恶意并发文件写入者的目录；不是针对 TOCTOU 或硬链接攻击的安全隔离。无网络访问、无 shell 执行。

STATE 使用 JSON 而非 YAML，以保持零依赖。默认仅一个活动任务。已有 AGENTS.md 不自动追加规则，请人工合并工作流。任务创建中断时可能留下未关联的 active 目录；先检查并保留有用内容，再人工修复。进程崩溃遗留 `.governance.lock` 时，确认无运行中的操作后再移除。

## 目录

- `plugin/core.js`：可独立测试的治理内核。
- `plugin/main.js`：PI 工具注册适配器。
- `plugin/tool.js`：工具参数定义。
- `scripts/`：manifest 生成器及 CLI。
- `test/`：生命周期、安全路径、门禁、恢复及适配器测试。

## 后续方向（尚未实现）

宿主级生命周期 Hook、可信测试执行器与完整 Git diff 绑定、配置化模型路由、任务取消/恢复、多 Agent ownership 与 worktree 隔离。当前不引入 LangGraph。
