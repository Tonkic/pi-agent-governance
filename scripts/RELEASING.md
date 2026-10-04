# 自动发布 / Automatic releases

本仓库已获持续授权：相对插件中心最新 `published / stable` 版本，主版本或次版本增加时，在检查齐全后自动推送 `release/plugin-center-VERSION` 并调用 `submit_version`，无需逐次再询问。相同主/次版本的补丁保持本地，例如 0.6.0 → 0.6.1 跳过，0.6.x → 0.7.x 或 1.0.0 符合规则。预发布、版本回退、首次创建不自动发布。不得为了触发发布擅自升级版本。

This is release-time repository automation, not a plugin self-updater, background service, Git hook or hosted CI job. The agent invokes it at the end of an approved version delivery. Ordinary build/test never publishes. Patch delivery still uses PI PluginCheck/PluginPack locally; the release command only skips publication, it does not build a patch package.

## 交付步骤

1. 完成已批准版本改动及发布说明。按 `plugin/PUBLISHING.md` 实际运行干净构建、类型/测试/浏览器检查、官方国际化门禁、PI PluginCheck/PluginPack，审查源码、包内容与敏感信息。不得使用 shell 自制 piplug。
2. 将源码、生成 JS、manifest、匹配版本的包、发布说明和必要状态一起审查并提交；留下无关用户目录不动。打包后如插件内容有变化，重新打包验证。仅更新仓库发布脚本时无需重打未变化的插件包。
3. 在 session scratch 写下方格式的检查记录，`sourceRef` 使用最终完整提交 SHA；`packageSha256` 是该提交内安装包的 SHA256。证据是调用方对实际检查的声明，不是工具生成的签名或独立验收。记录必须准确，不可为绕过检查填 true。
4. 用 `npm run release:auto -- FULL_SHA COMMITTED_NOTES_PATH RECEIPT_ABSOLUTE_PATH` 执行。凭据仍只放 `.secrets/plugin-center.token`，不传命令行参数。需要本地 Node 20+、Git、可用的 Playwright/PI_BROWSER、插件中心凭据及 GitHub 推送权限。
5. 命令会再次实际运行 typecheck、test（包含 build）和 test:browser；检查 HEAD/工作区未变化、提交和包指纹、权限、远端身份、版本占用及待审核版本，扫描可达 Git 历史中的本地凭据和常见密钥标记，然后只推指定发布分支。扫描是防误传补充，不代替敏感信息审查。
6. 提交后只读查询发布状态。若不是 published，报告尚未确认并停止；稍后查询状态，不重新投递。保持整体项目未通过的真实宿主/目视验收限制，不因发布成功而宣称全部完成。

```powershell
# 只读预览当前已提交版本；不运行测试、推送或提交版本
npm run release:auto -- --plan

# 版本交付末尾（替换三个参数）；补丁版本查询后直接跳过
npm run release:auto -- FULL_SHA changes/active/TASK/release-notes.md C:\path\to\scratch\release-receipt.json

# 查询已提交版本，绝不自动重投
node scripts/plugin-center.cjs plugin_status
node scripts/plugin-center.cjs check_version 0.7.0
```

检查记录示例（所有值均须替换为真实结果）：

```json
{
  "sourceRef": "FULL_40_HEX_COMMIT_SHA",
  "packageSha256": "PACKAGE_SHA256",
  "checks": {
    "pluginCheck": { "passed": true, "evidence": "实际校验结果及日志位置" },
    "pluginPack": { "passed": true, "evidence": "实际打包路径、文件清单与哈希；与本提交插件内容一致" },
    "i18n": { "passed": true, "evidence": "官方门禁实际结果，REVIEW项逐一处理" },
    "diffReview": { "passed": true, "evidence": "实际审查范围与结论，包含包和发布说明" },
    "secretReview": { "passed": true, "evidence": "源码、历史和包敏感信息检查实际结果" }
  }
}
```

## 安全边界与恢复

- `scripts/release-policy.json` 中 `enabled: false` 可关闭。主/次版本规则、仓库、分支范围或权限策略变更需重新获批，不能通过改 JSON 扩大授权。
- 相比已发布版新增权限，或 fs/net 权限范围变化时停止。此时重新人工审批，再使用明确授权的手动流程，不能改记录绕过。
- 不覆盖版本、不自动 supersede、不强推、不合并 main、不安装、不创建计划任务。保留 Git pre-push hook；hook 失败即停止。只接受固定 GitHub 仓库，拒绝多个 push URL。
- 发布互斥锁与提交尝试记录在 Git common directory 的 `pi-governance/releases/`。提交前先持久化 attempted 记录；超时、断网、进程崩溃后不自动重试变更请求。先查平台版本和远端分支，确认运行进程已结束，必要时由人工恢复锁/记录；不得自动删除 attempted 记录以重投。
- 数据/网络返回结构未知、已有待审核版本、发布分支指向其他 SHA、证据缺失或工作区改动均停止。无关未跟踪 `.pi/` 和现有 redesign archive 保留，不进入发布载荷。
- 宿主安装更新仍走 PI-Desktop 原生机制；平台发布成功不等于所有本机已自动升级。此流程无后台定时更新承诺。

手动首次发布继续使用 `create_plugin`；手动后续版本支持 `node scripts/plugin-center.cjs submit_version FULL_SHA NOTES_FILE --submit`，需要单独授权，不替代自动流程的检查。
