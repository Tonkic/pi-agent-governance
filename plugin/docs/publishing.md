<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->
# 插件中心发布 / Publishing

Community ID: `io.github.tonkic.agent-governance`. Source repository: `Tonkic/pi-agent-governance`.

## 安装 / Installation

0.6.0 uses a new community ID. It is not an in-place update of `pi.agent-governance`. Back up STATE and `.governance/`, disable the old plugin to avoid duplicate tool/command registrations, then install and grant permissions to the new plugin. Keep project data and old packages for rollback.

0.6.0 使用新的社区 ID，旧 ID 不会跨 ID 自动升级。先备份项目 STATE 与 `.governance/`、停用旧实例，再首次安装新插件并授权。无需删除或迁移项目数据；回退前先停用新实例。

The panel reads the host locale on opening, with browser-language fallback: Chinese maps to zh-CN; other languages use English. Reopen after changing the app language. User content and raw backend diagnostics remain unchanged. Manifest command titles use a bilingual string for installer compatibility; runtime command titles follow the locale.

面板启动时读取宿主语言，失败时回退到浏览器语言；切换语言后重新打开面板。用户数据和底层诊断保留原文。清单命令标题为兼容安装器使用中英并列字符串，运行时命令标题按语言注册。

## 凭据 / Credentials

Store the token only in repository-root `.secrets/plugin-center.token` (UTF-8, single line). The root `.gitignore` excludes `/.secrets/`; verify with `git check-ignore .secrets/plugin-center.token` and ensure `git ls-files -- .secrets` is empty. Restrict the directory/file ACL to the current user on Windows; use directory 0700 / file 0600 on POSIX. Never put the token in manifest, source, documentation, command arguments, screenshots, logs, or an MCP config committed to Git. Rotate tokens exposed in chat.

凭据仅保存在仓库根 `.secrets/plugin-center.token`，不是插件目录。Windows 应限制为当前用户访问；不要依赖 Git 忽略代替访问控制。密钥泄露到聊天后应撤销并更换，替换本地文件即可，不修改源码。

## 发布命令 / Publisher CLI

Requires Node.js 20+, Git, an authorized GitHub repository, and an existing remote source commit. Run from the repository checkout:

```powershell
node scripts/plugin-center.cjs whoami
node scripts/plugin-center.cjs list_repositories
node scripts/plugin-center.cjs list_plugins
node scripts/plugin-center.cjs preview FULL_COMMIT_SHA RELEASE_NOTES_FILE
# Only after explicit authorization, checks, diff review and pushing the source commit:
node scripts/plugin-center.cjs create_plugin FULL_COMMIT_SHA RELEASE_NOTES_FILE --submit
```

The preview sends nothing and lists the payload files. Submission reads plugin files from that exact Git commit, not the mutable working tree. A fixed file allowlist excludes `.secrets`, repository State, old packages, and unrelated files. Manifest fields are copied from the same commit; the platform rebuilds manifest.json. The client sends credentials only to `https://plugins.aiuo.net/mcp`, rejects redirects, redacts token-like response text and never automatically retries mutations. If a request fails or times out, inspect `list_plugins` and platform status before deciding whether another submission is needed. `create_plugin` is for the first release only; later versions use the platform's documented `submit_version` tool, not another create call.

提交前运行 typecheck/build/test、浏览器检查、官方 i18n 门禁和 PI PluginCheck/PluginPack；审查差异、包与敏感信息。已批准更新按 [交付流程](releasing.md) 同步 GitHub、集成 main，主/次升级另提交市场；遵守授权和分支保护，不强推。安装包说明从 docs/ 生成并随已审查 SHA 提交。发布成功仍须读取平台状态确认，不等于真实宿主验收。

## 更新 / Updates

After approval and catalog publication, use PI-Desktop's plugin-page update controls. Updates require the same ID and a higher version; new permissions require confirmation. This plugin does not download or replace itself, and does not bypass host update/permission checks. Enabling the host's auto-update option is not a promise of an unattended background timer.

审核上架后使用宿主插件页检查更新或自动更新选项；同 ID 的更高版本才可更新。新增权限仍须确认。插件不实现自行安装、后台替换或绕过宿主的更新机制。

0.7.0 相比市场0.6.0新增 `desktop.control` 和只读 `models.list`，升级须由宿主确认；开启自动更新不代表可静默扩权。对应发布说明见 [0.7.0](https://github.com/Tonkic/pi-agent-governance/blob/main/notes/release-0.7.0.md)。

PI-Desktop 0.16.1 的本地MCP仅开放插件/市场查询，不开放安装、检查插件更新或应用更新；`updates/check` 是应用自身更新。宿主内部安装服务存在，但不能通过未登记operation调用。依据 [官方MCP边界](https://github.com/vastsa/PI-Desktop/blob/104c3613d3037bf0c600151d80e92a5cd73e161c/docs/adr/0203-local-mcp-control-plane.md)。发布到市场和安装到本机是不同动作。
