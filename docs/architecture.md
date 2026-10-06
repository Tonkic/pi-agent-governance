# 读代码与架构

## 心智模型

这是 PI-Desktop 本地治理插件，不是自主开发 Agent 或后台任务服务。把它理解成：入口接收操作 → 治理内核检查规则 → 状态/项目数据/Git 持久化 → 面板展示结果。没有 Web 后端、数据库或第三方运行时依赖。

```text
PI Agent 工具 ─ main.ts → core.ts ─→ git.ts → Git common directory
CLI ─ scripts/governance.ts ─┘    └→ project.ts → .governance/
面板 ─ renderer/panel.ts → 宿主桥接 → panel.ts → core.ts → STATE.json
                                     ↑
                         白名单、确认、版本与工作区校验
```

core 与 project 不是完全独立：core 分派项目动作，project 复用注入的 Governance 对象、锁和安全文件操作。图中箭头是调用/委派，不是自动工作流。宿主负责外层窗口与安装更新，插件不能靠 DOM 拖拽移动宿主窗口。

## 推荐阅读顺序

1. 根 README 与 STATE：分别看稳定用法和当前任务，不从历史记录猜目标。
2. `plugin/main.ts`：onLoad 注册工具/命令，execute 获取工作区；onPanelInvoke 转发面板操作。
3. `plugin/tool.ts`：动作参数契约。看一次 status、progress 或 board_move 请求长什么样。
4. `plugin/core.ts`：读 Governance.run 的分派，再读 state/save/locked；之后按动作读 start、verify、close。不要先逐行读完整文件。
5. `plugin/panel.ts`：看同一动作在面板中为什么需要确认与 revision，以及为何 Git/close 不在面板写入白名单。
6. 按兴趣选择 `plugin/project.ts`（看板/架构来源）或 `plugin/git.ts`（worktree、范围、提交绑定验证）。
7. `plugin/renderer/panel.ts` 的 load/mutate/renderBoard：读快照与渲染，再读事件。图布局在 graph-model.ts，DOM 绘制/交互在 graph.ts，语言表在 i18n.ts。
8. 对照 `test/*.test.ts` 中相应测试理解边界；通常先读成功用例，再读 stale/switch/path/confirmation 拒绝用例。

## 跟踪一次操作

面板“更新进度”：submit → mutate → 确认框 → governance.mutate → main.onPanelInvoke 获取当前工作区 → panelInvoke 校验 confirmed/action/revision → Governance.run 检查旧状态并保存 → load 重新读快照。

Agent“设置架构”：architecture_sources 读取安全路径与指纹 → 人/Agent分析源码 → architecture_set 检查 expectedRevision、引用文件指纹和图限制 → .governance/architecture.json → project_snapshot 检查 staleFiles → 面板显示。

Git“提交并验证”：git_create 隔离工作区 → git_diff 审查快照 → git_commit 拒绝范围外或过期快照 → 调用方真实测试 → git_verify 绑定 SHA → git_integrate 只合并登记 worker 到 coordinator。main 集成是另一个有授权的交付步骤，不是 git_integrate 的隐含行为。

## 三份数据不能混为一谈

| 数据 | 权威内容 | 存储 |
| --- | --- | --- |
| STATE | 总目标、范围、验收、当前进度、阻塞 | STATE.json |
| 项目知识 | 工作项、架构、来源指纹 | .governance/board.json、architecture.json |
| Git 登记 | 本机 worktree、范围、提交验证 | Git common directory/pi-governance/ |

工作项完成不代表总体 verify/close 通过。测试证据由调用方声明，插件不替你运行测试或证明证据真实；也不会拦截其他工具直接操作 Git。锁与写前比较不是防恶意并发的安全沙箱。

## 源码与运行产物

读 `.ts`，不要读生成 JS 来理解业务。`plugin/runtime/` 是可安装的产物，`build/` 是可删除的编译/测试目录；详见 development.md。手写 `.cjs` 是发布/构建/浏览器测试工具源码，不是 TS 的重复版本。
