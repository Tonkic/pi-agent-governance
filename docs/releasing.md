# GitHub 交付 / Checked delivery

GitHub Release仍仅由稳定主/次版本标签 `vX.Y.0`（X≥1，Y≥0）各创建一次；标签由人另行创建。当前 **0.8.5** 是Git图显示降噪补丁，仅同步源码和官方包，不提交市场、不建标签/Release。0.x/非0补丁/预发布等不触发GitHub Release，策略 `stable-major-minor-tag-only` 不变。

2026-10-19用户授权后续已批准产品更新自动识别语义影响并升版本：修复、交互及性能优化为patch，不提交市场；新增完整能力为minor，不兼容改动1.x起major、0.x为minor。大更新完整检查、官方包、main双OS CI通过后，由当前Agent自动核对市场版本与待审状态并提交一次，不再逐次询问；未知写入不重试，不覆盖待审/已用版本，不自动安装/npm/建标签。日常build/CI不调用市场，市场与GitHub Release分开。

## 开发与源码交付

1. 读取STATE/README、status/git_status；小任务默认直接实现，确需写入委派才按[Git协作](git.md)分配独立worktree。
2. 说明改动/影响/测试，按[开发范围](development.md#检查命令)执行定向检查。公共/高风险/未知改动与大版本运行一次 `npm run check -- --full`；它包含类型、一次构建、全部测试和一次行为/浏览器执行，不再串联旧入口。保留差异与敏感信息审查。
3. 审查git_diff→git_commit→git_verify；登记当前HEAD并区分实际执行/内容等同复用。提交或无变化合并不机械重跑；冲突解决、并行组合或新增变化只补测影响部分。main最终CI按范围执行；纯完成记录只走轻量检查，不触发产品全套。复用必须核对实际内容、测试输入与环境，不能把旧SHA冒充新SHA执行。
4. 插件内容变化执行官方i18n、PluginCheck/PluginPack和包来源核对；不因打包再重跑已通过的功能测试。已授权main集成/正常推送不由release:auto执行；不stash/reset/强推。只清理已合并且无活动工作的临时分支；共享STATE/AGENTS由协调Agent维护，原整体宿主/目视阻塞保留。

## 更新级别与版本核对

- 每次产品交付都更新package/lock/生成manifest，不再复用同版本装不同源码。纯记录不升版；测试范围按风险，不按patch大小缩小。
- Agent先根据获批目标与行为/契约判级，提交使用 `fix:`/`perf:`/`feat:`/`!`；不按文件数或代码行数猜大小。`npm run update:plan -- --base FULL_SHA --head FULL_SHA --check`核对版本与市场要求，只读且不发布。
- 非标准提交或混合改动不清晰时计划返回needs-assessment；Agent审查实际差异后以 `--impact patch|minor|major`登记理由并核对，不能假称脚本理解任意语义。0.x升级稳定1.0需明确稳定契约目标，不为了行数自动跳1.0。
- 市场所需凭据仅用于通过门禁的大更新，缺凭据/已有待审/未知提交结果如实阻塞；不打印或上传令牌。先写一次性attempt记录，提交与只读结果核对各一次，区分approved和published。

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
- 全量checkout并绑定解析后SHA；Linux/Windows干净npm ci后运行 `npm run check -- --full --ci`，一次构建、全部单元/行为/Chromium浏览器通过才构建产物。正式发布不能使用局部或记录范围。
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
