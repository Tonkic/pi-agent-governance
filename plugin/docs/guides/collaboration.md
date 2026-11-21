<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->
# GitHub 权威协作 / GitHub authority

**权威优先级：已绑定的 GitHub 分支 > 本地工作区。** 权威指已合入目标分支的项目文档版本。CLI 不自动暂存、提交、合并、切分支或覆盖本地工作目录；已移除内置 SSH 运行时，多机均在各自本地 Git 工作区接入同一 GitHub 仓库。

## 选择与故障

- `bind` 明确指定 `owner/repo` 和现有权威分支，验证通过后将无秘密配置写入 `.remote-local/github.json`。不猜最近项目、不自动绑 `origin`，也不覆盖已有绑定。
- 首次绑定失败不落盘，继续按本地工作区处理；绑定成功后立即以 GitHub 分支为权威，不自动上传本地已有草稿。
- 已绑定后，若断网、权限失效、分支缺失或配置损坏均直接报错，**绝不静默降级为本地文件**。`authority` 仅解析配置（`available: "unchecked"`），`inspect` 才联网核对真实分支 SHA。
- 需 Node.js 22+ 与 Git；先将 `/.remote-local/` 加入 `.gitignore`，若该私有目录已被 Git 跟踪则拒绝执行。普通 `git clone` 不含 `.remote-local/`，新机器按同一仓库/分支显式 `bind` 即可。

## 调用

源码构建后运行 `build/plugin/collaboration-cli.js`（PI 包内位于 `runtime/collaboration-cli.js`），不依赖 MCP 服务启动：

```powershell
# 示例不含秘密；真实 token 仅经内存通过 stdin 传入，勿写入聊天或历史记录
'{"repository":"owner/repo","branch":"main","confirmed":true}' | node build/plugin/collaboration-cli.js --workspace D:/work/project --action bind
'{}' | node build/plugin/collaboration-cli.js --workspace D:/work/project --action authority
'{"path":"docs/guide.md"}' | node build/plugin/collaboration-cli.js --workspace D:/work/project --action read
```

CLI 参数仅限 `--workspace` 与 `--action`；请求 JSON（最多 64KiB）与临时 GitHub HTTPS `token` 只走标准输入，不进命令行参数或文件。仅支持 `github.com` HTTPS 仓库。

| action | stdin 字段与行为 |
| --- | --- |
| `authority` | `{}`；仅解析当前权威源（`github` 或 `local`），不联网 |
| `bind` | `repository, branch, confirmed:true, token?`；联网核实分支后创建绑定 |
| `inspect` | `token?`；核实已绑定的 GitHub 权威分支最新 SHA（未绑定时返回本地状态） |
| `read` | `path, token?`；读取已提交的权威 Markdown 正文、提交 SHA 与 SHA256（未绑定时读本地受限文档） |
| `publish` | `expectedHead, target, confirmed:true, token?`；将干净本地已提交 `HEAD` 推送至全新独立协作分支 |
| `reconcile` | `token?`；仅核对上次 `unknown` 推送的目标分支 SHA，不重放推送 |

## 工作与提交

1. 先执行 `authority` / `inspect` / `read` 确认权威分支 SHA 与最新文档（仅限根说明及 `docs/`、`notes/` 下 ≤256KiB 的普通 UTF-8 Markdown，不读本地未提交草稿）。
2. 在本地工作区按正常受管 Git 修改、运行测试、同步更新 `docs/` 并审查提交。
3. 拿到干净工作区的完整 `HEAD` 后调用 `publish`：`target` 必须以 `agent/` 开头（工具自动追加 128 位随机后缀防冲突），历史须包含权威分支 SHA 且不含 `.remote-local`、`.secrets`、`.env` 或私钥路径。
4. 在 GitHub 发起、审查并合并 PR；只有合入权威分支后才成为新权威。之后各端用正常 Git 拉取更新。

所有网络 Git 命令均在 `.remote-local/` 下的临时隔离 bare 仓库内执行（屏蔽用户 HOME/netrc 凭据与 hooks，禁用强推，单命令限时 20 秒），不改动源工作区的分支、索引和文件。

## 未知结果与边界

- `publish` 推送前先写入 `unknown` 日志；若网络中断或回执丢失，后续推送会被拦截，必须先运行 `reconcile` 核对远端目标分支 SHA（一致则标为 `saved`，不一致则人工核查，严禁换分支盲目重推）。
- 如需迁移仓库或更换权威分支，先完成 `reconcile`、清理未决状态并备份后，再由人工处理 `.remote-local/github.json`。
- 浏览器工作台与常规 `governance` 接口仍读取当前本地工作副本，不是实时 GitHub 网页阅读器；共享 `STATE.json` 仍由单一协调者维护。
