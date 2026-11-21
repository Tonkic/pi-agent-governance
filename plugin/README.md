<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->
# Agent Governance 文档总览 / Documentation

按阅读意图分四个子目录，3 秒定位所需文档，不必顺序通读。

One read-only workbench shared across Antigravity, PI-Desktop, Codex, Claude Code and Pi. Docs are organized into four intent-driven folders (`start/`, `guides/`, `reference/`, `ops/`).

## 1. 快速开始（`start/` · 初次接入与日常查看）

| 要解决的问题 | 入口文档 | 说明 |
| --- | --- | --- |
| Antigravity、Codex、Claude Code、Pi 接入 | [MCP 与可移植 Skill](docs/start/mcp.md) | 合并客户端配置、复用原会话与 Skill |
| 打开与使用四页只读工作台 | [统一浏览器工作台](docs/start/web-console.md) | 看板、架构、Git、分类文档阅读器与安全边界 |

## 2. 协作工作流（`guides/` · 人提需求与 Agent 同步维护）

| 要解决的问题 | 入口文档 | 说明 |
| --- | --- | --- |
| 人面向文档提需求、完成测试闭环 | [面向文档的功能开发](docs/guides/doc-driven.md) | 人与 Agent 四步闭环、业务域垂直切片与行为证据 |
| Agent 同轮最小更新文档 | [更新项目文档](docs/guides/documentation.md) | 四目录归属、行数预算与构建自动同步规则 |
| 受管分支、worktree、审查与合并 | [Git 协作](docs/guides/git.md#原则) | 独立 worktree、快照提交验证与本地提交图 |
| 多端共享 GitHub 权威文档分支 | [GitHub 权威协作](docs/guides/collaboration.md) | 权威分支绑定、防静默降级与独立分支推送 |

## 3. 架构与接口参考（`reference/` · 查模块职责与工具参数）

| 要解决的问题 | 入口文档 | 说明 |
| --- | --- | --- |
| 六边形核心结构、代码入口与数据文件 | [系统架构](docs/reference/architecture.md) | 双宿主入口、五大核心上下文与存储位置 |
| 任务启动、进度、验证与关闭参数 | [Governance 工具用法](docs/reference/governance.md#接手与执行) | `STATE.json` 状态机与验证归档 |
| 三栏看板、完成历史与源码指纹图参数 | [看板与架构数据接口](docs/reference/project.md#工作项) | `board_*` 与 `architecture_*` 调用规范 |
| 可选架构方案草案与 ASCII 画板转换 | [可选项目架构设计](docs/reference/architecture-design.md) | Architecture Copilot 与稳定基线规则 |
| 切换项目与只读隔离契约 | [切换与只读项目](docs/reference/behavior-workspace.md) | 跨项目迟到请求拦截与零写入保证 |

## 4. 开发与交付（`ops/` · 修改与发布本仓库时查阅）

| 要解决的问题 | 入口文档 | 说明 |
| --- | --- | --- |
| 本地构建、定向 `--scope` 与浏览器测试 | [开发与检查](docs/ops/development.md) | 单次构建、按范围检查与目录职责 |
| 语义升版、安全扫描与 GitHub Release | [GitHub 交付](docs/ops/releasing.md) | `update:plan`、`release:auto` 与标签策略 |
| 通用 MCP 包与 PI-Desktop 官方包校验 | [产物与安装](docs/ops/publishing.md) | `mcp-skills` 构建与 `PluginPack` 边界 |
| 前端设计来源与开源许可 | [UI 来源与许可](docs/ops/ui-sources.md) | 设计参考与 MIT 许可证原文 |

## 架构与写作约定

采用 [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/welcome/) 与 [Top 10 tips](https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice)：结论在前、短句、动作明确。

- **轻量限界上下文 + 四目录文档**：不套用繁琐多层战术 DDD；工具项目按 `start / guides / reference / ops` 分区，业务项目推荐在 `docs/<业务域>/` 与 `src/<业务域>/` 一一对齐，人改业务文档、Agent 同步维护同域代码与文档。
- `docs/` 单篇 ≤100 行，构建自动生成 `plugin/README.md` 与 `plugin/docs/`（禁止手改）；[历史记录](https://github.com/Tonkic/pi-agent-governance/blob/main/notes/README.md) 仅按需记 1–4 行简史，阅读器默认折叠 `notes/archive/`。
