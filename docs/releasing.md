# 更新交付 / Checked delivery

用户持续授权：每次小更新也要提交并推送 GitHub；主/次版本升级另提交插件市场。以插件中心最新 published/stable 版本为市场基线：0.6.0 → 0.6.1 只同步源码，0.6.x → 0.7.x 或 1.x 发布市场。不为发布自行升版本；预发布、回退、首次创建不自动发布。

This is repository delivery automation, not a plugin self-updater, background service or hosted CI job. Ordinary build/test never pushes or publishes. Completing approved work triggers this documented flow.

## 开发与交付

1. 调用 governance status/git_status，按 STATE 工作。依照 [Git 协作](git.md) 分配工作区；写入委派使用返回目录。审查 git_diff → git_commit → 提交后测试 → git_verify，集成后重测。总体验收有阻塞不得关闭。
2. 根工作区有用户改动导致受管创建失败时，保留用户目录并明确报告，不自动 stash/reset/删除/改忽略来绕过，不伪造受管验证。必要的串行普通 Git 提交仅纳入已批准范围并明确记录此限制。
3. 完成构建、typecheck、test、test:browser、差异和敏感信息审查。插件变更按 [发布检查](publishing.md) 执行干净构建、官方 i18n 门禁、PI PluginCheck/PluginPack；不使用 shell 自制 piplug。未改变插件的脚本变更无需重打包。
4. 提交已审查源码、JS、manifest、匹配包及说明。提交后重测。每次小更新末尾执行 `npm run release:auto`：读取已提交 HEAD，运行 typecheck/test/test:browser，检查工作区、扫描可达历史中的凭据和常见密钥标记，只推 `release/source-VERSION-FULLSHA` 到固定仓库。相同版本的不同更新用不同 SHA 分支，不覆盖旧分支，不推 main。没有市场提交或发布重投记录。
5. 主/次版本升级需下方证据记录、已提交发布说明和全部发布检查；执行 `npm run release:auto -- FULL_SHA COMMITTED_NOTES_PATH RECEIPT_ABSOLUTE_PATH`。只推 `release/plugin-center-VERSION`，调用 submit_version 后查询状态。发布未确认则停止，后续只读查询，不自动重投。

凭据只存在本地忽略文件 `.secrets/plugin-center.token`，不传命令行。需要 Node 20+、Git、Playwright/PI_BROWSER、插件中心读取凭据与 GitHub 推送权限。小更新也读取市场基线以确定是否符合发布条件；平台不可用则停止，不猜测或降级检查。

```powershell
# 只读预览；不运行测试、推送或提交版本
npm run release:auto -- --plan
# 小更新：检查后推送源码，不提交市场
npm run release:auto
# 主/次版本：三个参数替换成真实值
npm run release:auto -- FULL_SHA notes/release-notes.md C:\path\to\scratch\release-receipt.json
# 发布结果不明时只查询，不重投
node scripts/plugin-center.cjs plugin_status
```

## 市场发布证据

在 session scratch 写记录，绑定最终完整提交 SHA 和该提交中安装包 SHA256。证据是调用方实际检查的声明，不是独立签名或自动验收；不得为绕过门禁填 true。

```json
{
  "sourceRef": "FULL_40_HEX_COMMIT_SHA",
  "packageSha256": "PACKAGE_SHA256",
  "checks": {
    "pluginCheck": { "passed": true, "evidence": "实际结果与日志" },
    "pluginPack": { "passed": true, "evidence": "包清单与哈希，内容匹配提交" },
    "i18n": { "passed": true, "evidence": "官方门禁及REVIEW处理" },
    "diffReview": { "passed": true, "evidence": "源码、包、说明的实际审查" },
    "secretReview": { "passed": true, "evidence": "源码、历史与包敏感信息审查" }
  }
}
```

## 边界与恢复

- `scripts/release-policy.json` 的 enabled:false 关闭自动交付。仓库、规则、分支策略变更需重新批准；新增权限或 fs/net 范围变化拦截市场发布。
- 只接受固定GitHub仓库，拒绝多个push URL；保留pre-push hook，不强推、不推标签、不安装。release:auto只推明确来源分支，main由下面的集成步骤处理。来源分支指向其他SHA时拒绝替换；推送结果不明先用ls-remote核对。
- 市场提交互斥锁和持久化 attempted 记录在 Git common directory 的 pi-governance/releases/。提交前持久化；超时、断网、崩溃不得盲目重试、supersede 或删除记录。人工检查远端状态及存活进程后恢复。
- 只允许保留既有无关未跟踪 `.pi/` 与 redesign archive；不纳入提交。其他未跟踪内容或已跟踪修改均停止交付。密钥扫描只是辅助，不代替人工敏感内容审查。
- 发布成功不等于真实宿主/目视验收完成，也不等于本机自动安装成功。保留未完成的总体标准。
- 首次 create_plugin 和手动 submit_version 仍需要对应授权与完整检查。

## main 集成与分支清理

用户已授权完成更新后合并main、集成重测、普通推送，再清理已合并临时分支。release:auto只负责源码/市场交付；Agent须完成集成步骤，不能以来源分支同步代替交付完成。

合并前获取并核对远端main，保留其提交，用普通merge（建议--no-ff保留功能历史）。集成提交实际运行typecheck/build/test/browser后再推送；分支保护要求PR/CI时遵循保护，不绕过。仅当远端main已包含临时分支全部提交、无活跃worktree/受管任务时，才普通删除远端临时分支及本地已合并分支（git branch -d，不用-D）。保留市场发布来源分支和仍有未合并工作的分支。整体真实宿主/目视阻塞仍需诚实保留，不因合并而close。
