# PI Agent Governance

让新 Agent 从仓库文件接手工作，不依赖聊天记录。PI-Desktop 插件，版本 0.2.0。

## 安装与使用

在 PI-Desktop 插件页安装 `plugin/dist/pi.agent-governance-0.2.0.piplug`，授权注册 Agent 工具；开发时加载 `plugin/`。

向 Agent 说：“使用 governance 初始化当前项目，保留已有文件，按 STATE 继续工作。”

新 Agent 先读 `AGENTS.md`、`STATE.json` 和本文件。有活动任务就继续；有已批准的 `followUp` 就启动；都没有则等待人工，不自行增加需求。

默认流程：`status → start（需要时）→ 开发与检查 → verify → close`。进度变化时使用 `progress`。具体参数见 [工具用法](plugin/README.md)。

## 人工调整

- 新任务或方向调整：编辑 STATE 的目标、验收条件、范围、限制或 `followUp`；也可让 Agent 按你的要求代写。
- 当前使用方式修正：编辑 README 或相关 Docs；未实现功能仍放在 State，不写成现有能力。
- Agent 定期同步 `current / next / blocked`，在继续写入前重读状态。
- Docs 只写用途和用法；必要的输入、限制、命令属于用法。Notes 与临时记录按需创建，不要求每次任务都写。

STATE 是唯一的当前任务定义。归档中的 closure.json 仅为完成记录，不作为新任务依据。

## 开发与检查

需要 Node.js 20+，无第三方运行时依赖。

```powershell
npm run build
npm test
'{"action":"status"}' | node scripts/governance.js
```

CLI 作用于当前目录；PI 工具作用于宿主当前工作区主根。`plugin/core.js` 是内核，`main.js` 是 PI 适配器，`tool.js` 定义参数。manifest 由 build 生成。打包使用 PI 的 PluginCheck 和 PluginPack。

## 必要限制

- 单活动任务；工具不会全局拦截其他 Agent 操作，也不会自动唤醒新 Agent。
- 测试与 Diff 审查必须实际执行后提交证据；插件不运行测试、不检查证据真实性、不自动发现漏报或删除文件。
- 验证覆盖提交文件、context 读过的文件，以及存在的根 README/AGENTS。其他文档变化需 Agent 自行发现并重新验证。
- 修改 State 的任务定义、进度或后续任务会使旧验证失效；status 返回有效状态，但不会自动重写人工文件。重新 verify 后落盘。
- 使用 Node fs，非宿主 fs 权限网关；拒绝越界、子路径符号链接与常见凭据路径。操作锁和写前比较不能防御恶意写入、硬链接或最后瞬间的并发编辑；人工改状态时应暂停正在运行的工具操作。
- 中断后重试 close，使用相同 knowledge 文本。遇到遗留锁、孤立 active 目录或归档与状态冲突，先检查再人工恢复，不直接覆盖。
- 旧版 STATE 可读取；旧验证必须重做。init 保留已有文件，不会替你更新旧 AGENTS 规则。旧五类 gate 和 route 仅作为可选兼容工具。
