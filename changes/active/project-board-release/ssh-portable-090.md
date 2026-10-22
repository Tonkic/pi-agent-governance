# 0.9.0 工作目录内可迁移SSH

## 授权与范围

- 用户批准直接开发升版本并同步GitHub；Linux/Windows、用户名密码、工作目录内全部持久化、默认加密/显式明文、Agent按上下文连接，远端唯一写入、本地只读备份。
- 新增完整能力判为minor 0.9.0；按现有授权在完整检查/官方包/main双OS CI后核对市场并提交一次，不覆盖待审/已用版本、不重试未知写入。不自动安装/npm/标签/Release。
- Agent优先CLI，不新增SSH网页终端/管理页，不向现有HTTP/MCP白名单开放任意远程命令。远端须已有SSH密码服务与Node22+，不安装或修改系统配置。

## 实现

- remote-store：配置/凭据/已确认指纹/日志/历史快照全部.remote-local相对路径；AES256GCM+scrypt口令不落盘，明文需显式授权；Git必须整目录忽略且无跟踪文件。快照不含.git/源码/图片/系统或SSH秘密，不冒充完整仓库/验证。
- remote-ssh：纯JS SSH运行时固定入包、许可保留，不依赖系统SSH/Agent/HOME；先指纹确认、密码认证、probe实际OS/目录。固定启动命令与stdin请求，不插入用户路径/密码/命令。
- remote-program：自包含Node固定协议、路径/链接/别名/UTF8/体积预算、原始字节hash和确认写入；exec显式字面argv/cwd/超时/输出限额，仅可信Agent使用，不宣称OS沙箱。
- write/exec确认结果后拉本地版本化只读快照；远端成功/备份失败单独报告，只补sync；响应丢失先记unknown、阻止后续修改，人工核实resolve，不自动重放。
- remote-cli：隐藏交互密码或受限stdin，参数不收秘密；offline不解密/联网/上传。可把工具和全部配置一起迁移；无永久连接或后台轮询，外部修改后手动sync。

## 已执行检查与失败修复

- 当前Windows实际19/19 SSH定向测试通过：加密/错误口令/篡改/主机绑定/整目录复制、明文、Git忽略/已跟踪、链接/junction/越界/敏感/预算/旧hash/锁、BOM/CRLF/中文、真实SSH密码往返与cmd启动、hostkey变化认证前拒绝、远端先写/备份失败/丢响应未知不重放、独立无node_modules/HOME/SSHAgent握手。
- 本地SSH服务器夹具产生临时RSA主机密钥在内存，非用户主机；分别在当前OS执行协议，Linux另交CI；不宣称真实两台异机连接已验收。
- 首次cmd夹具重复转义导致Unterminated string，verbatim原命令最小复现旧fail/newpass；服务端连接误用destroy导致lost-response测试异常/清理挂起，改end后19tests正常退出。临时诊断仅scratch，无放宽产品重试/确认。
- 整目录忽略回归先红Missing expected rejection，修正前只查connections，后查整个目录；远端额外字段不再覆盖本地只读/来源。发布扫描新增.remote-local路径拒绝。
- 新增前51项相关布局/分发/发布/SSH检查通过；最终更改后19SSH检查通过，完整回归/官方包/main/市场待执行。日志ssh090-*.log在session scratch。
- 原总体人工目视/安装宿主/旧市场待运营与暂停桌面保留；未读或创建用户SSH密码，未连接用户远端。默认模型写子代理未配置，Task被拒后由主Agent完成，未冒称委派结果。

## 最终来源与交付

- 最终SSH定向21/21通过；增加了加密凭据整目录迁移后真实SSH连接、无node_modules独立工具和SSH格式解析/固定私钥移除检查。构建对固定ssh2 1.17.0自检改为内存随机密钥，格式分隔符等价转义；匹配数量改变即阻塞，未修改/关闭凭据扫描或增加例外，许可记录构建适配。
- 完整检查实际在ce3272f运行：类型/构建/280单元中279通过，旧MCP分发夹具缺新增许可旁车失败。d7e02ae仅修正夹具清单，MCP8/8补测和核心98截图/10行为通过。Git浏览器离线即时aria断言时序失败后保留全部断言、增加有界离线状态等待；web/managed/entry补测通过，共279截图。最终e617b2b另改运行前提说明及对应包，布局/行为23检查通过；没有冒称本机finalSHA全量重跑。
- 官方最终PluginCheck/PluginPack：0.9.0、99文件、1898430字节，SHA256 `e54c4cba8fc45b65a7868cef0a542bdfc8e791edd2595e5047868d6ddfe7bbf2`；i18n0失败/12既有review、4既有权限警告，无新增宿主权限。旧0.8.5包原hash核实，Git历史7376220可取回。中间开发包未提交市场/未冒充最终来源。
- 最终产品/测试/包来源 `e617b2b8bea2835c5846febe49a7f623206d178a`；build:distributions99条目/源码/版本核对通过，通用包318088字节 SHA256 `57d8cef26d293a629d76379c1425afa5604149b1d43def0ef3a54f5731d27113`。update计划0.8.5→0.9.0/minor/marketplaceRequired:true/mutation:false，通过；GitHubRelease计划publish:false/mutation:false。
- main `32199784f9920adfa9cf779b06b34c9bea501de7` 与e617b2b树完全相同，正常推送/完整远端SHA核实，真实main CLI help与随包SSHClient加载通过。[CI39746714903](https://github.com/Tonkic/pi-agent-governance/actions/runs/39746714903) Linux/Windows全部步骤成功，各280测试0失败/0跳过、完整279截图/10行为通过；日志明确加密迁移连接在两OS均通过。Windows安装/浏览器下载较慢，watch超时后只读恢复状态，未重跑CI。
- 市场只读核对：0.8.3现已published（publishedAt2026-10-19T07:10:08Z），无待审；版本0.9.0空闲、仓库归属有效。通过main精确SHA/双OS每步/官方包/完整manifest与98运行文件/i18n门禁后，单次submit_version被平台明确拒绝：`remote-ssh.ts:6: dynamic or remote code execution: eval()`。之后仅查一次plugin_status，0.9.0未创建/未发布，未覆盖旧版或自动重试/混淆绕过。
- 尝试日志 `.git/pi-governance/releases/io.github.tonkic.agent-governance-0.9.0.json`，phase:refused；payload1942146字节 SHA256 `19b1d4835edfe14ce62fdffebe850c43c4f5c0044c131ad5e6cff6236cd90a5e`。token仅内部读取，未输出/复制/上传；完整市场结果保留scratch/ssh090-market-result.json。
- 交付边界：源码/官方包/GitHub完成；市场受平台动态执行规则阻塞，需平台处理或另行批准兼容方案。看板保持进行中并标阻塞，不总体close。未自动安装/npm/建标签/Release，未连接用户真实远端；原宿主/人工目视与暂停工作保留。后续仅记录变化走records检查并同步main，复用上述等同产品检查，不冒称记录SHA全量重测。
