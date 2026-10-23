# GitHub权威协作 0.10.0

## 范围与结果

- 用户批准：绑定GitHub项目，以指定分支为权威；无绑定时有明确SSH上下文则SSH，否则本地。本地和SSH都可提交同仓库。
- 安全解释：首次绑定验证失败不保存绑定；已绑定后网络/权限/分支失效与配置损坏不降级。后续绑定成功立即GitHub优先，不自动上传已有修改。
- 新增collaboration-cli / collaboration / 自包含collaboration-program：authority、bind、inspect、read、publish、reconcile；不新增网页shell/API或框架。
- GitHub指定分支的提交对象提供只读文档；本地/SSH工作副本编辑、正常检查提交，再把干净且expectedHEAD匹配/包含权威历史的提交推唯一agent分支。普通push，不自动stage/commit/merge/pull/reset或覆盖文件。
- 权威分支与执行位置分开。临时GitHub令牌只stdin/SSH/网络子进程环境，不保存；隔离网络Git配置及HOME/netrc，保留源副本正常换行规则。
- unknown推送日志及SSH客户端日志阻止重放；reconcile仅核对实际目标SHA。敏感路径扫描覆盖待推送合并提交；不是全面秘密检测或恶意仓库沙箱。
- 既有0.9.2和全部功能保留；旧暂停桌面/未合并工作区不动，原宿主/目视/SSH市场阻塞保留。

## 实际检查

- npm ci、首次typecheck/build通过。新增10项Git夹具通过；新增真实SSH后19项协作+原SSH通过。
- 完整 `npm run check -- --full`：291测试/0失败/0跳过、279浏览器截图、原10行为通过。完整命令本身PASS；同shell前置看板缺ID失败导致外层exit1，后已用最新revision+显式id成功登记，未削弱保护。
- 一次只读审查指出网络HOME/netrc及merge-only敏感路径两项；新回归旧代码确实2失败，修复为隔离HOME/USERPROFILE/CURL_HOME/XDG与git log -m。
- 最终重新构建与typecheck通过；协作/SSH/远端协议/layout/distributions/MCP补测58/58、0跳过，含新两项red/green。未声称修复后SHA本地全量重跑，未改UI，复用上述UI证据。
- 测试使用真实临时Git/bare仓库与真实本机SSH，GitHub地址仅在测试传输层替换。CLI秘密argv拒绝、dirty/stale/权威失败/只读树/合并路径/unknown不重放均有断言。
- 最终真实GitHub只读：临时项目绑定Tonkic/pi-agent-governance/main，读取4f98ee8a2203310c2fe11819ea0abbcb72006976的docs/remote.md，7242字节，未使用令牌、未改远端。本地草稿字节保持不变。
- 官方PluginCheck/Pack通过110文件/1944993字节，SHA256 `c64f11072db0d4ee7295cc3e394a4cc7f4f52c40140e52c65939101fe6388fe2`；逐项110文件LF归一源码匹配，权限无变化，原4项权限警告保留。
- 本轮源码/测试/指南均已审查；包生成只用官方工具。未安装、未调用市场、未发布npm/标签/Release；未声称真实用户SSH服务器或私库Token认证验收。

## 日志与待交付

- 会话scratch：github0100-{install,typecheck,build,tests-first,tests-second,ssh-tests,ssh-repro,ssh-green,full,review-red,final-build,final-typecheck,final-supplement,live-read}.log；完整截图github0100-full-shots。
- 发布版本0.10.0，原0.9.0动态SSH执行市场拒绝原因仍存在，不重试同类市场包。源码GitHub连接已恢复；下一步受管提交、正常main集成/推送及实际双OS CI核对。
- 当前总体仍working；原安装宿主/Browser目视阻塞不以截图或夹具验收替代。
