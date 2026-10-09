# Agent 入口

1. 先读 STATE.json 和 README.md；用 governance status 获取有效状态。
2. 有活动任务就继续 current/next；无活动任务但有已批准 followUp 则 start；都没有就等待人工，不发明需求。
3. STATE 是当前任务唯一来源。人决定目标、范围、验收；Agent 在范围内实现、检查和修复。
4. 按问题读取 docs/README.md 中的专题，不要求逐层打卡。docs/ 是当前说明唯一手写来源；notes/ 简记增删改、结果和踩坑，历史证据在 notes/archive/ 或已有 changes/。TS 是修改入口，runtime/build/安装包说明是产物。
5. 进度变化写回 current/next/blocked。写入前重读状态，不能覆盖人工的新意图。
6. Docs 采用 Microsoft 标准和渐进式披露：结论在前、短句、动作明确；索引→专题→必要细节，原则上每篇不超过100行。Notes 每次通常4–8行，不贴日志或重复计划。规则见 docs/documentation.md。
7. 完成前实际运行 npm run build、npm test，审查 diff，更新必要用法，verify 后 close。
8. 插件变更用 PluginCheck/PluginPack 更新安装包。参数与流程见 docs/development.md、docs/publishing.md。
9. 所有修改通过 Git 留痕。先检查工作区；写入型子任务用 git_create 分配独立分支/worktree，明确 cwd 和 allowedPaths 后再委派。只读审查不必分支。
10. 用 git_status 接手已有 Git 子任务；State 管总体目标，Git 登记表管任务工作区。共享 STATE/AGENTS 由协调 Agent 修改。
11. 提交前审查 git_diff；提交后实际测试并 git_verify。子任务只合并到受管协调分支，集成后重新检查。主分支合并和远端推送须人工授权；禁止自动 stash、reset、强推或丢弃用户改动。
12. Git 功能不自动启动宿主子代理；写入委派必须使用返回的 worktree。具体操作见 docs/git.md。
13. 每次已批准更新按 docs/releasing.md 交付：小更新同步GitHub并合并main，集成重测/推送后只清理已合并临时分支；主/次升级另检查并提交市场。用户持续授权此流程，保留发布追溯与未合并工作；不绕过保护、强推或自动安装。新增权限/规则变化需批准，不为发布自行升版本。
14. 受管工作区创建被用户改动阻塞时，保留文件并报告，不通过stash/reset/删除绕过，不伪造受管验证。既有未跟踪目录不是本次交付内容。仍有总体验收阻塞不能close；同一任务的检查结果更新既有记录，不为每次测试新建文档。
15. 本项目已批准一次启动后连续接续待办：每个回合先核实STATE和看板，完成一项后重读并处理下一可执行项，不等待重复“继续”。只能执行当前授权范围；没有活动任务/获批followUp、工作完成、真实外部阻塞或新授权需求时停止。宿主手动自动化入口见docs/development.md，不自行增加定时任务或递归创建对话。
