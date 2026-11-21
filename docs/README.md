# Agent Governance 文档 / Documentation

按问题直接查对应文档，不必顺序通读。每篇先给结论与操作步骤，参数与限制放在末尾章节。

Shared read-only workbench for Antigravity, PI-Desktop, Codex, Claude Code and Pi. Operate and maintain Docs in the original host session.

## 1. 快速开始（`start/`）

| 要解决的问题 | 先读 | 深入章节 |
| --- | --- | --- |
| 接入 Antigravity、Codex、Claude Code、Pi | [MCP 与 Skill](start/mcp.md) | 客户端配置、安全与排错 |
| 打开或独立启动浏览器工作台 | [浏览器工作台](start/web-console.md) | 从宿主打开、生命周期与切换 |

## 2. 协作工作流（`guides/`）

| 要解决的问题 | 先读 | 深入章节 |
| --- | --- | --- |
| 人面向文档提需求、完成开发与测试 | [面向文档开发](guides/doc-driven.md) | [切换与只读隔离](reference/behavior-workspace.md) |
| Agent 同轮同步更新文档 | [文档维护](guides/documentation.md) | 行数预算、自动生成与检查 |
| 分配 worktree、审查差异与合并 | [Git 协作](guides/git.md#原则) | 浏览器提交图、冲突与恢复 |
| 绑定 GitHub 权威分支与多端提交 | [权威协作](guides/collaboration.md) | 选择与故障、未知结果与边界 |

## 3. 架构与接口参考（`reference/`）

| 要解决的问题 | 先读 | 深入章节 |
| --- | --- | --- |
| 查模块职责、调用链与数据文件位置 | [系统架构](reference/architecture.md) | 模块入口表、数据位置 |
| 启动任务、更新进度、验证与关闭 | [治理用法](reference/governance.md#接手与执行) | 验证与关闭、可选操作 |
| 管理三栏工作项与源码架构指纹图 | [项目接口](reference/project.md#工作项) | 三栏工作台、可选源码架构 |
| 发起可选架构草案与 ASCII 基线 | [架构设计](reference/architecture-design.md) | 数据与接口 |

## 4. 开发与交付（`ops/`）

| 要解决的问题 | 先读 | 深入章节 |
| --- | --- | --- |
| 本地构建、按范围运行测试 | [开发](ops/development.md) | 检查命令、目录 |
| 语义升版与 GitHub Release 交付 | [交付流程](ops/releasing.md) | [产物与安装](ops/publishing.md) |
| 查看 UI 设计参考与开源许可证 | [UI 来源](ops/ui-sources.md) | MIT License |

## 写作与目录约定

遵循 [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/welcome/) 与 [Top 10 tips](https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice)：结论先行、短句、主动语态、列表与表格优先，方便快速扫读。

- **单一事实源**：`docs/` 按 `start / guides / reference / ops` 四目录组织（业务项目推荐 `docs/<业务域>/` 与 `src/<业务域>/` 对齐）；单篇不超过 100 行，不建空模板。
- **按需历史**：[Notes](../notes/README.md) 仅记录有追溯价值的 1–4 行变更或踩坑，日常无需通读。
- **自动同步**：`plugin/README.md` 与 `plugin/docs/` 由构建脚本从 `docs/` 自动生成，禁止手改。当前任务授权仅以 `STATE.json` 为准。
