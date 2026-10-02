# PI Agent Governance

让新 Agent 从仓库文件接手工作，不依赖聊天记录。PI-Desktop 插件，版本 0.3.0。

## 原则

- **人定目标，Agent 在范围内执行。** 人决定目标、范围和验收条件；没有活动任务或已批准的后续任务时，Agent 等待指令，不自行增加需求。
- **从仓库接手，不依赖聊天记录。** 新 Agent 先读 AGENTS、STATE 和 README。STATE 是唯一的当前任务定义；归档仅作完成记录，不作为新任务依据。
- **尊重人工调整，及时同步状态。** 写入前重读状态，不覆盖人的新意图；进度变化同步 `current / next / blocked`。
- **文档只写用途和用法。** 保留必要输入、限制和命令；不堆积历史、临时计划或重复解释。Notes 按需创建，不强制逐层阅读文档。
- **修改通过 Git 留痕，写入任务隔离。** 写入型子任务使用独立分支/worktree；只读审查不必分支。不自动 stash/reset 或丢弃用户修改；主分支合并和远端推送须人工授权。
- **实际检查后才能完成。** 审查差异、运行检查、更新必要用法，再验证和关闭任务；Git 验证绑定具体提交，集成后重新检查。

## 安装与使用

在 PI-Desktop 插件页安装 `plugin/dist/pi.agent-governance-0.3.0.piplug`，授权注册 Agent 工具；开发时加载 `plugin/`。

向 Agent 说：“使用 governance 初始化当前项目，保留已有文件，按 STATE 继续工作。”

默认流程：`status → start（需要时）→ 开发与检查 → verify → close`。进度变化时使用 `progress`。具体参数见 [工具用法](plugin/README.md)。

## 人工调整

- 新任务或方向调整：编辑 STATE 的目标、验收条件、范围、限制或 `followUp`；也可让 Agent 按你的要求代写。
- 当前使用方式修正：编辑 README 或相关 Docs；未实现功能仍放在 State，不写成现有能力。

## Git 协作

用 `git_status` 接手已有任务。写入型子任务先用 `git_create` 创建独立分支/worktree，再把返回目录明确交给子代理。先审查 `git_diff`，再 `git_commit`，实际测试后 `git_verify`，最后 `git_integrate` 到协调分支并重新检查。

支持范围检查、过期验证拒绝、冲突保留与登记恢复。State 管总体目标，Git 本地登记表管工作区任务。使用要求与参数见 [Git 协作](plugin/GIT.md)。

## 开发与检查

需要 Node.js 20+，无第三方运行时依赖。

```powershell
npm run build
npm test
'{"action":"status"}' | node scripts/governance.js
```

CLI 作用于当前目录；PI 工具作用于宿主当前工作区主根。`plugin/core.js` 是内核，`main.js` 是 PI 适配器，`tool.js` 定义参数。manifest 由 build 生成。打包使用 PI 的 PluginCheck 和 PluginPack。

## 必要限制

- State 保持单总体任务，Git 可管理多个隔离子任务；工具不会全局拦截操作、自动唤醒 Agent 或自动给任意宿主委派分支。
- 验证证据由调用方提交，不独立执行测试。State 验证依赖提交的文件清单；Git 验证检查真实 worktree 变化、提交和验收记录，但不是语义审查。
- 验证覆盖提交文件、context 读过的文件，以及存在的根 README/AGENTS。其他文档变化需 Agent 自行发现并重新验证。
- 修改 State 的任务定义、进度或后续任务会使旧验证失效；status 返回有效状态，但不会自动重写人工文件。重新 verify 后落盘。
- 使用 Node fs，非宿主 fs 权限网关；拒绝越界、子路径符号链接与常见凭据路径。操作锁和写前比较不能防御恶意写入、硬链接或最后瞬间的并发编辑；人工改状态时应暂停正在运行的工具操作。
- Git 动作用 Node execFile 执行，不经过宿主命令网关。登记表和工作区位于 Git common directory；linked worktree 的该位置可能在当前目录之外。仅使用可信 Git 配置，详见 Git 协作安全限制。
- 中断后重试 close，使用相同 knowledge 文本。遇到遗留锁、孤立 active 目录或归档与状态冲突，先检查再人工恢复，不直接覆盖。
- 旧版 STATE 可读取；旧验证必须重做。init 保留已有文件，不会替你更新旧 AGENTS 规则。旧五类 gate 和 route 仅作为可选兼容工具。
