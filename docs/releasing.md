# GitHub 交付 / Checked delivery

仅稳定主/次版本标签 `vX.Y.0`（X≥1，Y≥0）各自动创建一次 GitHub Release，例如 `v1.0.0`、`v1.1.0`、`v1.2.0`、`v2.0.0`。当前版本为 **0.8.1**，用户已批准补丁升级并同步源码与安装包，明确不创建标签/Release；0.x、补丁非0、预发布、构建后缀或版本分量有前导零均不发布。标签必须与 package 版本完全一致；策略为 `stable-major-minor-tag-only`，取代仅主版本 `vN.0.0` 和旧PI市场自动提交规则。

No npm publishing, marketplace calls, automatic installation or tag creation. Version bumps require explicit approval (0.8.1 is approved); a bump alone never authorizes a Release. The user creates an approved release tag separately. Ordinary build/test does not push or publish.

## 开发与源码交付

1. 读取 STATE、README，调用 governance status/git_status；写入委派按 [Git 协作](git.md) 使用独立受管 worktree。
2. 完成 typecheck、build、test、check:behaviors、test:browser、差异与敏感信息审查。插件变更执行官方 i18n、PluginCheck 和 PluginPack，见 [产物与安装](publishing.md)。
3. 审查 git_diff → git_commit → 实际提交后测试 → git_verify。集成后重新测试。共享 STATE/AGENTS 由协调 Agent 维护；整体宿主/目视阻塞不得假报完成。
4. 已授权的普通源码 main 集成和推送由治理流程执行，**不再由 release:auto 推送来源分支**。遵循保护，不 stash/reset/强推；只清理已合并且无活动工作的临时分支，保留旧发布追溯。

```powershell
# 只做本地/CI计划：检查已提交来源、工作区、远端URL、可达历史；不运行测试
npm run release:auto -- --plan
# 运行完整检查后返回同一计划；仍不推送、不发布
npm run release:auto
# 可显式绑定完整40位SHA；必须是当前干净HEAD
npm run release:auto -- --plan FULL_SHA
```

`release:auto` 从 tag CI 环境识别标签；无标签时结果为不发布。符合标签时另外核对 package 版本、标签实际提交和 origin/main 祖先关系。`--gate` 仅供 Action 输出资格，不等于通过发布检查。

## Action 合约

- `.github/workflows/release.yml` 只监听标签 push。脚本精确匹配上述稳定主/次版本规则；不合格或 package 版本不符的标签不能进入后续 job。
- 全量 checkout，绑定解析后的提交 SHA；Linux/Windows 干净 npm ci、类型、构建、单元、行为和 Chromium 浏览器检查全部通过才构建产物。
- 使用 Node 22、锁定的实际运行依赖。浏览器从 Playwright 安装 Chromium；不依赖 Ubuntu 的 Edge。可本地用 `PI_BROWSER` 指定浏览器。
- `npm run build:distributions` 构建通用 MCP/Skills tgz，核对并复制官方 PI piplug；另产出 `asset-manifest.json`、`SHA256SUMS`，绑定版本、来源 SHA、大小和哈希。缺任一产物即停止。
- 仅最终 release job 授予 `contents:write`；其他 job 为 `contents:read`。最终 job 只从环境使用 GITHUB_TOKEN，不读取本机市场凭据。
- 发布前通过固定 GitHub HTTPS API 再查标签和 main 祖先关系；不存在的标签不会被创建。只将明确 GET 404 视为未发布，其他错误一律停止。
- 已有Release经标签/源码、完整附件大小与SHA-256核对一致后，只读跳过；部分或不可核对则报错，绝不写入。新发布只POST创建一次，各附件上传一次；不覆盖、不改latest、不删除、不自动重试。并发按标签串行，重新运行attempt不得发布。
- 创建前写 attempted journal，并保存为 Action artifact。超时/未知响应或上传失败保留部分 Release 和记录，人工只读核对，不自动恢复上传。不要删除重建已使用的标签或 Release。
- Actions 沿用本仓库 v4 引用约定，不声称其为不可变 SHA pin。须在真实仓库运行后才能声称 Action 通过。

## 保留的安全门禁

- 只允许固定 `Tonkic/pi-agent-governance` 和正常 Git push URL；多个 URL、带凭据 URL 或其他仓库拒绝。脚本本身不 push。
- 完整 SHA、干净已跟踪文件；仅容许既有无关 `.pi/` 和 redesign archive 未跟踪目录。不得为过门禁删除用户文件或修改忽略规则。
- 扫描可达 Git 历史的秘密路径、令牌与私钥标记；不读取秘密文件。环境中实际提供的凭据优先拦截，不因夹具例外豁免。
- 唯一历史例外仍为 blob `d2c45515b924a1f69d92ef00b771e77b7318bbfe` 的两条已批准合成测试令牌；其他内容仍拦截，不重写历史。
- Windows 构建仅有 stat/换行状态时，只对已知生成文件核对规范化工作区哈希与 HEAD、index 全部相同后刷新索引 stat；真实、已暂存或未知修改拒绝。
- 旧 notes/releases、Git 发布记录及本地 token 文件保留；旧 marketplace 传输和提交能力已移除。密钥扫描仅为辅助，仍需人工审查。
