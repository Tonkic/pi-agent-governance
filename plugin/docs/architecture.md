<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->
# 架构

共享核心提供任务状态、项目看板、源码架构和Git协作；PI-Desktop图形适配器与本地stdio MCP复用同一实现和项目数据，不需要Web服务或数据库。

## 模块与代码入口

以下路径相对于 `plugin/`。阅读源码使用 `.ts`，不要修改生成的 `runtime/` 文件。

| 文件 | 职责 | 先看哪里 |
| --- | --- | --- |
| `main.ts` | 注册工具/面板；工具以可信调用会话绑定项目，面板跟随主工作区 | `onLoad`、`execute` |
| `tool.ts` | 定义工具动作及参数 | 动作与参数定义 |
| `core.ts` | 管理任务状态、验证、归档和文件锁 | `Governance.run` |
| `panel.ts` | 限定面板操作，检查确认与版本 | `panelInvoke` |
| `project.ts` | 保存看板、架构和源码指纹 | `ProjectData.run` |
| `git.ts` | 管理 worktree、范围和提交验证 | `GitGovernance.run` |
| `operations.ts` | 默认复用同项目会话，显式新建、身份/空闲校验与安全恢复 | `operationInvoke`、`localSession` |
| `behaviors.ts` | 安全读取行为正文、关联与本机验证状态 | `behaviorSnapshot`、`behaviorState` |
| `design.ts`、`renderer/design.ts` | 管理独立设计草案、追加基线及画板交互 | `ArchitectureDesign.run`、`designWrite` |
| `renderer/panel.ts` | 加载数据、展示状态、提交表单 | `load`、`mutate` |
| `renderer/graph-model.ts`、`graph.ts` | 计算图布局、绘制与交互 | 布局与渲染函数 |
| `renderer/i18n.ts` | 提供中英文界面文字 | 语言表 |

## 调用关系

```text
Agent 工具 → main.ts → core.ts → STATE.json
CLI → scripts/governance.ts → core.ts
MCP客户端 → mcp/server.ts → tool.schema校验 → core.ts
MCP资源/提示、PI Skill → plugin/skills/architecture-copilot/
面板 → 宿主桥接 → main.ts → panel.ts → core.ts
浏览器 → web/bridge.js → 127.0.0.1 web/server.ts → panel.ts → core.ts
面板任务 → main.ts → operations.ts → 宿主 session/agent API
core.ts → project.ts → .governance/
core.ts → git.ts → Git common directory
```

`project.ts` 复用 `core.ts` 提供的锁、状态和文件操作。面板写入使用动作白名单、确认和版本校验；Git 写入及任务关闭使用 Agent 工具或 CLI。

`mcp/server.ts`绑定显式绝对工作区或Claude官方启动项目环境；输入缓冲/Skill资源固定，每次调用创建新核心对象。`mcp/context-hook.ts`从官方Hook stdin读取session/cwd，仅向原会话返回当前项目状态；不持久化会话库、读历史或动态重绑MCP。两者不引用PI接口、不自动初始化或运行Agent，核心继续校验修订/锁/路径/Git。用法见 [MCP](mcp.md)。

`web/server.ts`仅监听loopback，固定工作区、随机会话凭据及Host/Origin检查后分发白名单面板动作；静态资源也用固定清单。复用renderer，不复制状态或Agent实现。独立网页允许人工基线确认，但不提供任意工具、Git写入或宿主会话控制。见 [本地控制台](web-console.md)。

## 数据位置

| 位置 | 保存内容 |
| --- | --- |
| `STATE.json` | 总目标、范围、检查条件、进度和阻塞 |
| `.governance/board.json` | 三栏工作项与保留的旧检查历史 |
| `.governance/architecture.json` | 模块关系、源码指纹及更新时间 |
| `.governance/architecture-design.json` | 独立设计正文/画板、当前草案和人工确认历史，不是源码事实 |
| `.governance/operations.json` | 项目 Agent 会话 ID、模型选择与运行状态 |
| `docs/behavior-bindings.json`、对应Markdown | 当前行为正文与场景/文件关联 |
| `.governance/behavior-evidence.json` | Git忽略的本机检查证据；不是获批任务或整体通过记录 |
| Git common directory 下的 `pi-governance/` | 本机受管任务、worktree 与提交验证登记 |

## 限制

- 已完成表示工作项结束，不自动证明覆盖范围外的检查；没有独立验收阶段。
- 测试由调用方运行，证据由调用方提交；插件不独立证明测试结果。
- 插件不拦截其他工具；仅在用户确认后发起固定 Agent 任务，不后台轮询。
- 锁和写前比较不能防御恶意并发修改。
- 外层窗口与安装更新由 PI-Desktop 管理。

构建与修改方法见 [开发](development.md)。动作参数见 [治理用法](governance.md)、[项目接口](project.md)，文档整理见 [文档维护](documentation.md)。

可选架构Skill及画板见 [架构设计](architecture-design.md)。功能按分层文档开发和测试，不强制先画图；没有额外流程协调器。
