<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->
# GitHub 权威协作 / GitHub authority

**权威优先级：已绑定的 GitHub 分支 > 明确选定的 SSH 项目 > 本地。** 权威是已接受的项目文档版本，不是执行命令的位置。CLI 不自动提交文件、合并、切换分支或覆盖两端工作目录。

## 选择与故障

- `bind` 明确指定 `owner/repo` 和现有权威分支；成功核实后将无秘密配置保存到 `.remote-local/github.json`。不猜最近项目、不自动绑定 origin，不创建 GitHub 仓库或默认分支。
- 首次绑定失败不保存绑定；有明确 SSH profile/root 时仍使用 SSH，否则本地。绑定成功后立即优先 GitHub，不自动上传原有修改。
- 已绑定后，断网、权限失效、分支删除或配置损坏均报错，不降级、不把缓存或工作副本称作权威。`authority` 只解析配置，`available:unchecked` 不代表已联网成功；`inspect` 才验证实际分支 SHA。
- 无 GitHub 时，`--profile` 明确选择 SSH，`root` 可覆盖该 profile 的默认目录；无 profile 不猜远端。Github 模式中的 profile 仅选择执行位置，不改变权威源。
- 两端需 Node.js 22+、Git 和已有可信工作副本；远端还需原 SSH 配置及指纹信任。先将整个 `/.remote-local/` 忽略，拒绝已跟踪私有目录。绑定随整个工作目录迁移，但普通 clone 不包含私有绑定，另一入口需显式绑定同仓库/分支。

## 调用

源码构建后使用 `build/plugin/collaboration-cli.js`；PI 包使用 `runtime/collaboration-cli.js`，通用包目录结构与源码相同。CLI 不依赖 MCP 安装；SSH 运行时随包提供。

```powershell
# 此示例不含秘密；真实 token 不应写入命令历史或聊天。
'{"repository":"owner/repo","branch":"main","confirmed":true}' | node build/plugin/collaboration-cli.js --workspace D:/work/project --action bind
'{}' | node build/plugin/collaboration-cli.js --workspace D:/work/project --action authority
'{"path":"docs/guide.md"}' | node build/plugin/collaboration-cli.js --workspace D:/work/project --action read
'{"path":"docs/guide.md"}' | node build/plugin/collaboration-cli.js --workspace D:/work/project --profile server-a --action read
```

参数仅 `--workspace`、`--action`、可选 `--profile`。JSON 最多64KiB，使用标准输入。GitHub 仅支持 github.com HTTPS 仓库；不接受任意URL、URL密码或仓库内的网络重写配置。

| action | stdin 字段 / 行为 |
| --- | --- |
| authority | `root?`；仅返回所选权威，不联网、不测试可用性 |
| bind | `repository,branch,confirmed:true,token?`；本地入口验证后新建绑定，不覆盖旧绑定 |
| inspect | `root?,token?,passphrase?`；验证 GitHub 分支，或无绑定时探测 SSH/本地 |
| read | `path,root?,token?,passphrase?`；读取所选权威；GitHub 返回提交SHA、正文SHA256及只读正文 |
| publish | `expectedHead,target,confirmed:true,root?,token?,passphrase?`；将选定工作副本已提交的HEAD推到新协作分支 |
| reconcile | `root?,token?,passphrase?`；只核对上次推送目标SHA，不重放推送 |

`token` 为临时 GitHub HTTPS 令牌，只经 stdin/SSH 加密通道和 Git 子进程环境传递，不保存到文件、argv或输出。不读取或修改系统凭据库；私库读取需读取权限，推送需仓库内容写权限。`passphrase` 仅解锁本项目已有 SSH 凭据。不要把秘密放进提交的JSON文件；由可信调用方在内存构造stdin。

## 两端工作与提交

1. 先 `authority` / `inspect` / `read`，确认权威分支与SHA。GitHub正文来自提交对象，不读取本地同名草稿；允许根说明和 `docs/`、`notes/` Markdown，单文件256KiB，拒绝敏感路径、链接对象、二进制和非法UTF-8。
2. 本地或 SSH 端在各自正常 Git 工作副本编辑、运行相关检查、审查差异并提交；这些仍是草稿。保留现有受管Git/确认/修订门禁；CLI不替代它们，也不自动 stage/commit。
3. 获取该端完整HEAD，调用 `publish`。`target` 为 `agent/任务名` 前缀，工具添加128位随机后缀并返回实际分支名；两端使用不同前缀便于辨认。工作区必须干净、HEAD匹配、历史包含最新权威SHA，待推送历史不得包含私有目录/常见敏感路径。
4. 根据返回分支在 GitHub 创建、审查和合并 PR。工具不创建PR、不写main、不自动重放或解决冲突。只有合入权威分支才成为新权威；push成功不等于合并或测试通过。
5. 两端之后按正常 Git 获取、审查并合并已接受内容。工具不自动pull/rebase/reset，不覆盖脏工作区，不后台双向同步；离线草稿不是权威。

推送只使用普通 Git push，不强推；网络操作在临时 bare 仓库执行，不改源工作副本的分支、索引和文档。源副本的正常换行规则保留；只用于可信仓库，不宣称恶意配置/并发进程沙箱。Git每命令20秒、输出有界；fetch会下载对象，磁盘/仓库大小不由单文档限额保证，大仓库应预留容量。

## 未知结果与边界

- 发起push前持久化unknown日志；丢失连接/响应或超时后禁止再推，先 `reconcile`。目标分支SHA恰好匹配才标记成功；不匹配继续unknown，不换新分支偷偷重试。
- SSH两端都有日志。即使服务器已完成而客户端未收到回执，也先核对，不重放。若远端尚未建立推送日志，人工检查远端日志/目标分支与仓库后，再用原remote-cli的显式 `resolve` 处理客户端unknown；不自动清除。
- 本功能不做自动解除/更换绑定。需要迁移仓库或改变权威分支时，先协调所有端、解决未推送和unknown状态并备份，再人工审查私有配置；不要以删配置绕过断网或未知状态。
- 浏览器与普通治理接口仍展示当前工作副本的数据，不是实时GitHub阅读器；本功能为Agent/CLI入口，不新增网页远程shell或后台同步。共享 `STATE.json` 仍需单一协调者，不允许两端独立认领同一个任务后互相覆盖；也可由人使用Issues/Projects协调。
- GitHub绑定不赋予任何新任务/主分支合并/公开发布权限；正常权限、分支保护和审查不变。敏感路径检查不是全面秘密检测，推送前仍须审查全部待推送提交。
