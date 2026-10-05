# Agent 入口

1. 先读 STATE.json 和 README.md；用 governance status 获取有效状态。
2. 有活动任务就继续 current/next；无活动任务但有已批准 followUp 则 start；都没有就等待人工，不发明需求。
3. STATE 是当前任务唯一来源。人决定目标、范围、验收；Agent 在范围内实现、检查和修复。
4. 需要更多信息时只读相关文档或源码，不要求逐层打卡。
5. 进度变化写回 current/next/blocked。写入前重读状态，不能覆盖人工的新意图。
6. Docs 只写用途和用法；不写历史、临时计划或无用解释。Notes 和临时文件按需创建。
7. 完成前实际运行 npm run build、npm test，审查 diff，更新必要用法，verify 后 close。
8. 插件变更用 PluginCheck/PluginPack 更新安装包。参数与流程见 plugin/README.md。
9. 所有修改通过 Git 留痕。先检查工作区；写入型子任务用 git_create 分配独立分支/worktree，明确 cwd 和 allowedPaths 后再委派。只读审查不必分支。
10. 用 git_status 接手已有 Git 子任务；State 管总体目标，Git 登记表管任务工作区。共享 STATE/AGENTS 由协调 Agent 修改。
11. 提交前审查 git_diff；提交后实际测试并 git_verify。子任务只合并到受管协调分支，集成后重新检查。主分支合并和远端推送须人工授权；禁止自动 stash、reset、强推或丢弃用户改动。
12. Git 功能不自动启动宿主子代理；协调 Agent 必须把插件返回的 worktree 作为写入目录。具体操作见 plugin/GIT.md。
13. 每次已批准更新交付末尾执行 `scripts/RELEASING.md`。用户持续授权：小更新也必须审查、提交、测试并推送 GitHub 专用非main源码分支；主/次版本升级在全部发布检查通过后另提交插件市场。补丁只不发布市场，不是只留本地。优先按插件 git_status/create/diff/commit/verify 使用受管工作区；遇用户改动阻塞不得 stash/reset/删除来绕过，应保留并明确报告，不冒称受管验证。新增权限或发布规则变化需重新批准。不为发布自行升版本，不挂普通 build/test，不自动安装或合并main。
14. 用户已授权完成的更新走功能分支→审查测试→合并main→集成后重测→普通推送main→清理已合并临时分支。此授权替代第13条旧的禁止main集成限制；源码同步命令仅负责发布来源同步，交付还须完成main集成。不绕过分支保护/必需检查、不强推；删除前核对远端main已包含全部提交且无活跃worktree/受管任务。保留发布追溯分支及未合并工作；仍有总体验收阻塞不宣称close通过。
