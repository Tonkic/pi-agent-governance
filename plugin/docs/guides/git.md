<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->
# Git 协作

为协调任务与写入型子代理分配独立分支和 worktree，严格校验修改范围、差异快照与提交证据。需 Git 2.31+ 且已完成初始提交。

## 浏览器提交图

工作台「Git」页面按真实父子关系以只读方式展示本地提交图（上新下旧）：

- **主轴居中**：优先以本地 `main`/`master`（或 `origin/main`）第一父链作为中心主轴；常驻仅标记主轴与 `HEAD` 标签，其余分支与标签在悬停或键盘聚焦浮层中展示。
- **提交与差异详情**：点击节点或按 `Enter` 打开模态框，查看完整提交说明、父提交及相对第一父提交的文件差异（二进制、敏感路径与超 128 KiB 差异不预览）。关闭弹窗自动恢复原焦点与滚动位置。
- **按需分页**：进入页面才读取，每页 100 条（上限 5,000 提交、64 条并行线），纯本地读取不触发联网 `fetch`。

## 原则

- **全流程留痕**：写入型委派必须先调用 `git_create` 分配独立 worktree；只读分析无需建分支。
- **范围隔离**：`STATE.json` 与 `AGENTS.md` 仅由协调 Agent 维护；并行 worker 的 `allowedPaths` 必须互不重叠且包含在协调任务范围内。
- **安全红线**：worker 仅允许合入所属 coordinator；合入 `main` 与推送远端必须经人工授权。严禁自动执行 `stash`、`reset`、强推或清理用户未提交改动。

## 标准操作四步

1. **查询与分配 worktree**（工作区须干净，`allowedPaths` 填精确文件路径或以 `/` 结尾的目录前缀）：
   ```json
   {"action":"git_status"}
   {"action":"git_create","id":"feat-x","role":"coordinator","owner":"coordinator","goal":"获批目标","criteria":["测试通过"],"allowedPaths":["src/","docs/"],"expectedHead":"当前完整SHA"}
   ```
   委派子代理时，**必须将返回的 `worktree` 路径显式设为子代理工作目录（`cwd`）**。
2. **审查差异并提交**（工作区或暂存区再次变动会使 `snapshot` 立即失效）：
   ```json
   {"action":"git_diff","id":"feat-x"}
   {"action":"git_commit","id":"feat-x","expectedDiff":"刚审查的snapshot哈希","message":"feat: implement x"}
   ```
3. **运行检查并登记验证**（绑定提交后的完整 `HEAD` SHA；未改动代码内容的合并可说明等同依据复用测试结果）：
   ```json
   {"action":"git_verify","id":"feat-x","expectedHead":"提交后完整SHA","passed":true,"accepted":[true],"evidence":"实际执行的检查命令与结果","diffReview":"审查范围与结论"}
   ```
4. **合入子任务**（非快进合并，源与目标 worktree 均须干净）：
   ```json
   {"action":"git_integrate","id":"feat-x","source":"feat-x-worker","expectedHead":"协调当前SHA","sourceHead":"已验证worker完整SHA"}
   ```

## 冲突与恢复

- **解决合并冲突**：冲突保留在协调 worktree 中；人工或协调者解决冲突并暂存后，重新执行 `git_diff` → `git_commit` → `git_verify`。
- **中断恢复**：若合并已完成但登记中断（或已手动 `git merge --abort`），可在干净工作区调用 `{"action":"git_recover","id":"feat-x","expectedHead":"当前完整SHA"}` 同步登记表。
- **本机登记位置**：任务表与 worktree 位于 Git 公共目录 `pi-governance/` 下（单命令限时 60 秒、输出上限 4 MiB，自动禁用 Git hooks 与外部 diff 扩展）；遗留 `operation.lock` 仅在确认无运行进程后手动移除。
