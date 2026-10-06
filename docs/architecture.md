# 架构

插件为 PI-Desktop 提供任务状态、项目看板、源码架构和 Git 协作。所有入口复用治理内核，不需要 Web 服务或数据库。

## 模块与代码入口

以下路径相对于 `plugin/`。阅读源码使用 `.ts`，不要修改生成的 `runtime/` 文件。

| 文件 | 职责 | 先看哪里 |
| --- | --- | --- |
| `main.ts` | 注册 Agent 工具、命令和面板桥接 | `onLoad`、`execute` |
| `tool.ts` | 定义工具动作及参数 | 动作与参数定义 |
| `core.ts` | 管理任务状态、验证、归档和文件锁 | `Governance.run` |
| `panel.ts` | 限定面板操作，检查确认与版本 | `panelInvoke` |
| `project.ts` | 保存看板、架构和源码指纹 | `ProjectData.run` |
| `git.ts` | 管理 worktree、范围和提交验证 | `GitGovernance.run` |
| `renderer/panel.ts` | 加载数据、展示状态、提交表单 | `load`、`mutate` |
| `renderer/graph-model.ts`、`graph.ts` | 计算图布局、绘制与交互 | 布局与渲染函数 |
| `renderer/i18n.ts` | 提供中英文界面文字 | 语言表 |

## 调用关系

```text
Agent 工具 → main.ts → core.ts → STATE.json
CLI → scripts/governance.ts → core.ts
面板 → 宿主桥接 → main.ts → panel.ts → core.ts
core.ts → project.ts → .governance/
core.ts → git.ts → Git common directory
```

`project.ts` 复用 `core.ts` 提供的锁、状态和文件操作。面板写入使用动作白名单、确认和版本校验；Git 写入及任务关闭使用 Agent 工具或 CLI。

## 数据位置

| 位置 | 保存内容 |
| --- | --- |
| `STATE.json` | 总目标、范围、验收、进度和阻塞 |
| `.governance/board.json` | 工作项 |
| `.governance/architecture.json` | 模块关系、源码指纹及更新时间 |
| Git common directory 下的 `pi-governance/` | 本机受管任务、worktree 与提交验证登记 |

## 限制

- 工作项完成不代表总体验收通过。
- 测试由调用方运行，证据由调用方提交；插件不独立证明测试结果。
- 插件不拦截其他工具，也不自动调度 Agent。
- 锁和写前比较不能防御恶意并发修改。
- 外层窗口与安装更新由 PI-Desktop 管理。

构建路径和修改方法见 [开发](development.md)。动作参数见 [工具用法](../plugin/README.md)。
