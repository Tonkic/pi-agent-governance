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
