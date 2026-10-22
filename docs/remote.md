# 可迁移 SSH / Portable SSH

**0.9.0 提供 Agent 优先的 SSH CLI，不新增网页终端或远程管理页。** Linux/Windows远端均需已有SSH密码认证服务及PATH中的Node.js 22+；本地需Node.js 22+和Git执行凭据保护检查。不安装/修改系统SSH、凭据库、Agent或远端服务。

## 工作目录自包含

```text
工作目录/
  AGENTS.md
  .gitignore
  .remote-local/             # 整个目录私有，不提交/普通发布
    connections.json         # 主机、端口、用户、OS、可选远端目录
    credentials/             # 默认加密，可明确选择明文
    known-hosts.json         # 已明确确认的SSH服务器指纹
    journals/                # 写入结果与待备份/未知状态
    backups/                 # 不覆盖旧版本的只读JSON快照
    latest/                  # 最近成功快照的相对路径
    tool/                    # 可选：把通用包解压到这里
```

在Git项目中先将 `/.remote-local/` 加入 `.gitignore`。配置/使用密码前检查该目录未跟踪且已被忽略；已提交过的密码仍需更换并处理历史，忽略不是访问控制，也不约束网盘。

默认AES-256-GCM＋scrypt，解锁口令至少12字符、不保存密钥；错误口令/篡改/把凭据搬给别的主机身份均拒绝。明文需显式选择；文件权限尽力收紧，Windows ACL由用户控制。连接密码不进入argv或正常输出；不要把密码/口令写进聊天或提交的请求文件。

复制整个工作目录后，配置、信任和快照无需重建；所有本地持久化路径相对工作目录。加密模式需输入原解锁口令，且目标机须满足运行环境和网络条件。临时锁不应随迁移复制；有锁时先确认原任务已结束，不自动清锁。运行时纯JS随包提供，不依赖系统SSH客户端或用户主目录配置。

## 首次配置与信任

通用包解压到 `.remote-local/tool/` 后，SSH CLI可独立使用，无需安装MCP依赖；源码开发先 `npm ci`、`npm run build`。PI包也包含同一 `runtime/remote-cli.js` 和SSH运行时，可把插件目录复制到工作目录内的tool位置使用，不从浏览器执行。

```powershell
node .remote-local/tool/build/plugin/remote-cli.js --workspace D:/work/project --action configure
node .remote-local/tool/build/plugin/remote-cli.js --workspace D:/work/project --profile server-a --action fingerprint
node .remote-local/tool/build/plugin/remote-cli.js --workspace D:/work/project --profile server-a --action trust
node .remote-local/tool/build/plugin/remote-cli.js --workspace D:/work/project --profile server-a --action sync
```

配置向导询问主机、端口、用户名、远端OS（`linux`/`win32`）、可选目录和隐藏密码。默认加密；只有输入YES才明文。远端目录可不保存，由AGENTS上下文决定，并在每次请求的 `root` 提供。

`fingerprint`只握手取SHA256指纹、不发密码，也不自动信任。通过服务器控制台/管理员独立核对后，`trust`明确确认；指纹变化拒绝认证，需人工检查项目内known-hosts后处理，不能自动接受新值。

## Agent调用

CLI参数仅 `--workspace`、`--profile`、`--action`；请求JSON走stdin，最多2MiB。不要把秘密放在参数、shell历史或版本化文件里。加密模式非交互请求需由可信调用方通过stdin提供 `passphrase`；向导和有默认目录的交互sync可隐藏输入口令。

| action | stdin字段 / 行为 |
| --- | --- |
| configure | `profile:{id,host,port,username,platform,directory?},password,passphrase?,plaintext?,confirmed:true`；新ID，不覆盖旧配置 |
| profiles | 无；返回无密码的连接配置 |
| fingerprint / trust | 前者无；后者 `fingerprint,confirmed:true` |
| probe | `root?,passphrase?`；核对真实目录、OS及Node版本 |
| read | `path,root?,passphrase?`；返回文本与原始字节SHA256 |
| write | `path,text,expectedHash,confirmed:true,root?,passphrase?`；仅Markdown，新增时hash为null |
| exec | `file,args:[],confirmed:true,root?,passphrase?`；指定可执行文件及字面argv，shell:false、cwd固定远端目录 |
| sync | `root?,passphrase?`；只拉取快照，不执行旧修改 |
| offline | `root?,path?`；离线列快照/读文件，不解密密码、不联网、不上传 |
| resolve | `root?,confirmed:true`；人工核实远端结果后解除unknown，不重做操作 |

Windows远端示例目录 `D:\work\project`，Linux为 `/home/user/project`。本地路径按当前OS写绝对路径。每次probe核对真实目录；多主机/多目录快照独立分区，不混用。profile ID仅小写字母开头，可含数字和连字符。

可在AGENTS中加入：

> 远端连接由 `.remote-local/connections.json` 发现；使用本目录tool中的remote-cli，不读取/打印credentials。先读远端最新STATE/README及相关文件，再在已批准范围修改。远端成功后由CLI拉备份；本地offline只读。未知结果先read核实，再明确resolve，禁止自动重复写入。目录以本文列出的实际远端路径为准。

## 修改、备份与恢复

- write先核对expectedHash、确认及独占协议锁，再同目录临时文件原子替换；不自动建父目录，不直接改STATE/看板JSON。治理写入用exec调用远端已有治理CLI，保留其修订/锁/确认保护；不会自动部署CLI。
- exec是受用户授权的Agent命令入口，不是网页API。可执行文件可能访问工作目录外或启动子进程，不宣称OS沙箱；只在可信主机/任务使用。最长30秒、总输出1MiB，超时/信号导致结果不明时保留unknown；自行启动的后台程序不由SSH功能接管。
- 每次write/exec结果确认后自动拉取本地快照。返回 `remoteSaved:true,backupPending:true` 表示远端已执行、仅备份失败；只补sync，不重放。exec的非零退出码在result.code中明确返回，不代表命令没有产生修改。
- 连接/响应丢失把操作日志保留unknown，禁止后续修改。允许read/sync检查，但不会自动清unknown；人工核对后resolve。断线不自动降级为本地写入，也不自动重试。
- 快照限根说明/STATE、docs/notes/changes下Markdown及看板/架构/设计/行为JSON；不含.git、源码、图片、系统配置、SSH凭据和敏感命名文件。500文件/4000扫描条目/8层/每256KiB/总8MiB，超限明确partial，不冒充完整项目备份。
- 快照为只读CLI数据，保存原字节哈希、来源和时间，不能当成本地真实仓库的Git/架构/行为验证。备份文件本身未加密，可能含项目私有内容；保护整个目录。备份保留历史、不自动删除；按磁盘容量人工管理，恢复到远端需单独批准write/exec。
- 外部编辑器/Agent修改远端后手动sync。没有永久连接、后台轮询、双向同步或离线编辑上传；每次任务按需SSH，同一次操作复用连接，结束关闭。
- 本功能只操作可信目录；拒绝链接、越界、别名和预算异常，不是恶意服务器/并发文件替换沙箱。没有真实远端凭据时仅能验证本地SSH夹具；用户主机仍需首次连接验收。
