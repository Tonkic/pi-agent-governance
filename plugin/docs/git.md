<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->
# Git 协作

为协调任务和写入型子任务分配独立分支/worktree，检查修改范围、提交和集成。需要 Git 2.31+、已有初始提交、有效 user.name/user.email；仅在可信仓库根目录使用。

## 原则

- 所有修改通过 Git 留痕；写入型子代理先分配 worktree，再启动。只读审查不需要分支。
- 人批准总体目标；协调 Agent 分配子任务范围。STATE/AGENTS 由协调 Agent 维护，worker 不得修改。
- 每个 worktree 同时只能有一个写入者；提交、验证和集成期间暂停写入。
- 审查 diff 后提交，在该提交上实际测试，再登记验证。集成后重新测试。
- 只将 worker 合并到其受管 coordinator；主分支合并、远端推送需人工授权。
- 不自动 stash、reset、强推、删除分支或清理用户修改。

## 1. 接手与分配

调用 `{"action":"git_status"}`，读取根 head、dirty、任务 worktree、错误、pendingMerge、verificationValid。先继续已有任务，不重复分配。

基准工作区必须干净。State 的任务启动会修改文件，应先在已授权开发分支提交这些接手文件，再分配协调 worktree。插件不替你初始化 Git、配置身份或提交未知用户改动。

```json
{"action":"git_create","id":"feature-x","role":"coordinator","owner":"coordinator","goal":"已批准的功能","criteria":["项目测试通过"],"allowedPaths":["src/","test/","README.md","STATE.json","AGENTS.md","changes/"],"expectedHead":"根工作区当前完整SHA"}
```

```json
{"action":"git_create","id":"feature-x-worker","role":"worker","parent":"feature-x","owner":"agent-a","goal":"实现子模块","criteria":["模块测试通过"],"allowedPaths":["src/module-a/"],"expectedHead":"协调worktree当前完整SHA"}
```

allowedPaths 只允许准确相对文件名或以 `/` 结尾的目录前缀，不接受通配符。worker 范围必须包含在父任务内，活动 worker 范围不得重叠。

**委派时必须明确传入返回的 worktree 作为 cwd，并传入 allowedPaths、目标和验收条件。** 宿主 Task 不会因调用 git_create 自动切换目录；无法指定工作目录时，不启动写入型委派。插件不会自动启动子代理或拦截绕过插件的委派。

## 2. 审查与提交

```json
{"action":"git_diff","id":"feature-x-worker"}
```

审查返回的 patch（相对任务基准）、workingPatch（相对 HEAD）、stagedPatch（暂存区）、status、files 和 untracked；新增文件内容须在该 worktree 另行读取，二进制文件须单独检查。变更范围包括相对任务基准的净变化、本次已暂存/未暂存变化及未跟踪文件；不按历史逐个提交审查。

```json
{"action":"git_commit","id":"feature-x-worker","expectedDiff":"刚审查的snapshot","message":"feat: implement module a"}
```

文件或暂存区变化会使 snapshot 失效。支持新增、修改、删除和改名；拒绝越界、符号链接/junction，以及超过 10 MiB 的变更文件。提交所有本次范围内变更，不支持部分暂存提交；不要混入个人修改。

## 3. 验证与集成

在返回的实际提交上运行测试、审查结果，再调用：

```json
{"action":"git_verify","id":"feature-x-worker","expectedHead":"实际测试的完整SHA","passed":true,"accepted":[true],"evidence":"实际命令与结果","diffReview":"实际审查结果"}
```

accepted 与任务 criteria 一一对应；要求工作区干净。测试证据由调用方提交，插件不会执行测试或证明证据真实。

```json
{"action":"git_integrate","id":"feature-x","source":"feature-x-worker","expectedHead":"协调分支当前完整SHA","sourceHead":"已验证worker完整SHA"}
```

采用非快进合并。源、目标必须干净且属于登记的父子关系；过期验证拒绝集成。集成完成后协调任务的旧验证失效，必须重新测试和 git_verify。已集成 worker 不再通过工具修改，后续工作创建新任务。

## 4. 冲突与恢复

合并冲突保留在协调 worktree。解决后明确暂存解决结果，重新 git_diff、git_commit，再测试验证。不确定解决方式时询问人。

若合并已成功但登记中断，或人明确执行 `git merge --abort` 后，调用 `git_recover`，提供 id 和已检查的 expectedHead；只在干净工作区恢复登记，不修改文件。不明确的提交关系会拒绝恢复。

登记表位于 Git common directory 的 `pi-governance/tasks.json`，worktree 位于同目录 `workspaces/<id>`。这是本机运行信息，不进入项目提交；新 Agent 在同一仓库可接手，重新 clone 不会自动恢复这些本地工作区。完成记录可按需写回 State/归档。

若创建 worktree 后登记写入失败，使用 `git worktree list` 检查，保留文件并人工修复登记；不要重复创建或删除已有工作区。遗留 operation.lock 只在确认无操作运行后移除。插件不自动清理 worktree。

## 安全限制

Git 通过 Node execFile 执行，不使用 shell 拼接，也不经过宿主命令网关；插件会禁用其命令中的 hooks、签名、fsmonitor、外部 diff/textconv。仍需信任仓库配置及 attributes：过滤器、merge driver 可能执行程序，必要的 hooks 检查请显式运行。原有配置文件不会被改写。

路径范围是工具提交/集成门禁，不是操作系统沙箱或身份认证；owner 仅为标签。并发外部写入、Git 配置、忽略文件、恶意改写登记表不在安全保证内；任务操作期间保持独占。Git common directory 可能位于打开的 linked worktree 之外。所有 Git 输出有 4 MiB 上限、命令 60 秒超时；超时后先检查实际状态再重试。
