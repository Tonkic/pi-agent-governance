# Backend checkpoint — incomplete delivery

Approved contract remains `.pi/goal/完成项目任务看板-项目架构图与发布验证-并安装到本机-pi-desktop-20261003-1402.md`. This is an intermediate evidence record, not acceptance or closure.

Implemented: project_snapshot, board_create/update/move, architecture_sources/set; revision bound to workspace/State/data; persisted source hashes; panel confirmation whitelist; API usage in plugin/PROJECT.md. Renderer has not been connected and still shows the old fixed plugin graph.

Observed checks before checkpoint commit:
- npm run typecheck: passed.
- npm run build: passed.
- npm test: 45/45 passed (40 retained existing tests, 5 new tests).
- New tests exercise persistence/reload, sorting, illegal transitions, blockers, unchanged governance State, stale/cross-workspace writes, confirmation cancellation, privileged action rejection, two distinct temporary projects with isolated graph update/reload, changed source rejection and corrupt/unsafe data.
- Existing real temporary Git repository tests pass: worktrees, scope, commit-bound verification, managed integration, conflicts and recovery.
- PluginCheck: passed, 25 files; high-risk agent.tool.register permission warning. No new package produced or installed.
- Reviewed source changes and generated build routing/schema; git diff --check passed. No existing test assertion removed.

Unmet contract criteria:
1. Backend only; no drag/keyboard board UI.
2. Source-backed backend and two-project tests done; panel graph loading not done.
3. Dynamic architecture/workflow renderer not done.
5. Browser interaction matrix and six screenshots not done. Screenshot tool returns `plugin pi.browser did not answer call`.
6. No clean-copy dependency/build/test validation, CI fix or new versioned package yet.
7. No supported installation/upgrade/reload tool or host UI control found through tool search. Browser is scoped to work-panel guest; `Target.getTargets` returns `CDP method not allowed: Target.getTargets`. Existing page is a static file preview, not real installed-plugin validation. Do not modify host installation/permissions databases to bypass this.
8. Overall verification/closure/archive is intentionally not claimed. Keep task working with blocked/next recorded in STATE.

Resume by restoring supported host install/reload control and screenshot capture, then complete renderer, release checks and real-host isolated-workspace verification. No remote push, main merge or public release authorized.
