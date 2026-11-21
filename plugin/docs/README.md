<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->
# Agent Governance 文档 / Documentation

先按问题定位专题，不必顺序读完。每篇先给用途与常用操作，参数和限制在后面的具名章节；可直接搜索动作名。

One read-only workbench shared across Antigravity, PI-Desktop, Codex, Claude Code and Pi. Humans direct work via Docs and STATE; Agents implement, test and maintain Docs in the original host session.

| 要解决的问题 | 先读 | 需要深入时 |
| --- | --- | --- |
| 人面向文档提需求、Agent同步维护文档 | [文档开发](doc-driven.md) | [文档维护](documentation.md) |
| 接手目标、更新进度、验证关闭 | [治理用法](governance.md#接手与执行) | 同页“验证与关闭” |
| Antigravity、Codex、Claude Code、Pi 接入 | [MCP 与 Skill](mcp.md) | 同页“客户端配置”“安全与排错” |
| 所有宿主统一打开/关闭浏览器工作台 | [浏览器工作台](web-console.md) | 同页“从宿主打开”“生命周期与切换” |
| GitHub权威文档与本地独立分支提交 | [权威协作](collaboration.md) | 同页“选择与故障”“工作与提交”“未知结果与边界” |
| 三栏工作项、完成与历史记录 | [项目接口](project.md#工作项) | 同页“三栏工作台” |
| 可选架构方向与可视化 | [架构设计](architecture-design.md) | 同页“数据与接口” |
| 切换项目与只读隔离行为说明 | [切换项目说明](behavior-workspace.md) | [文档开发](doc-driven.md#说明与检查证据) |
| 分支、worktree、提交和集成 | [Git 协作](git.md#原则) | 同页“冲突与恢复” |
| 代码职责与数据位置 | [架构](architecture.md) | 表中的 TS 入口 |
| 构建、测试与双宿主开发流程 | [开发](development.md) | 同页“目录” |
| 多目标构建与稳定主/次版本GitHub交付 | [交付流程](releasing.md) | [安装与发布](publishing.md) |
| UI 参考与许可 | [来源](ui-sources.md) | 同页 MIT 许可 |

## 写作与位置

采用 [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/welcome/) 和 [Top 10 tips](https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice)：结论在前、短句、动作明确、方便扫读。中文不机械套用英文格式。

- `docs/` 是当前功能、架构与用法的唯一事实源。每轮自主判断影响；大改最小更新对应专题，小改只补必要一句，无实质变化不写。专题不超过 100 行，不建空模板。
- [Notes](https://github.com/Tonkic/pi-agent-governance/blob/main/notes/README.md) 仅保存有追溯价值的 1–4 行历史，日常不必读；不重复聊天、计划或测试日志。
- 根 README/AGENTS 仅保留必要入口与执行红线。安装包的 `plugin/README.md` 和 `plugin/docs/` 从这里构建生成，不手改。
- `changes/` 保留机器关闭记录和截图等证据；`.pi/` 是宿主数据，不迁移。当前授权只看 STATE，不从旧记录猜目标。
