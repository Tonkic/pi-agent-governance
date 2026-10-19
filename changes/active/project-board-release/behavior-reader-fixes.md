# 行为读取与内部文档跳转修复

## 根因与授权

- 用户报告行为页Operation rejected及项目Markdown链接无法跳转；本次只修复两项，不升版本/自动安装/覆盖已批准市场0.8.3。
- 真实main50bb27e直接读取报Behavior contract exceeds read budget：原始500607字符，构建工作区498781；归一化LF内容同为492453。生成panel.js的CRLF差异触发500000上限。
- 新真实仓库回归先失败：全CRLF为502835字符。原始预算包含CRLF，不能以构建工作区通过代替实际签出检查。
- 链接此前设计为纯文本；新增浏览器回归先失败0个内部链接，预期3个。

## 修复

- 独立历史UI测试62行原样移至串行helper，所有断言/行为绑定和原500000字符、60文件限额不变；不是提高预算或隐藏行为实现。
- 新回归读取当前仓库全部关联源文件，分别构造LF/CRLF并实际调用behaviorContract/behaviorSnapshot；超限原始内容仍拒绝。
- HTTP仅对已认证行为读取的固定预算错误给出安全双语说明，不回显路径/参数/令牌；其余错误继续通用拒绝。
- Markdown相对链接只解析到已列出的文档，经过原只读接口加载；支持同文件/跨文件标题、中文编码和重复标题后缀，键盘可用。
- href恒为内部工作台路由，源路径不成为浏览器URL。外部/脚本/越界/双重编码/查询/缺失目标保持文本；图片/HTML不加载。沿用项目epoch/root/request隔离及离线限制。
- 新链接测试通过已有documents-browser串行入口执行，局部reader检查和完整检查都覆盖且不重复。

## 检查与交付

- 定向18项行为/HTTP测试与4图内部链接浏览器断言通过；覆盖真实LF/CRLF、原预算超限、路径/协议拒绝、标题/键盘/离线/迟到及无项目写入。
- 最终源码4012c7b9ffe6d563fae030f98cdfe38676bef7df，main f2dc852d5b0508357cd64b17640531062e2dd649树完全相同、正常推送且远端SHA一致。真实[CI39221478181](https://github.com/Tonkic/pi-agent-governance/actions/runs/39221478181)两OS全部步骤成功，各222测试/0失败/0跳过，原10行为及255截图断言通过。
- 本地4ae23bc实际执行类型/一次构建及全222测试，其中221通过、1个新文档示例路径错误；8aafec4修正文档及重生成官方包，补测layout/distributions/behaviors共29项通过。4012c7b仅调整旧“所有链接为0”断言为精确合法内部链接/危险资源拒绝，未改产品；后续完整浏览器255图通过。已通过类型/其他单元明确复用，未冒充最终SHA重新全量运行；最终CI提供完整新SHA证据。
- 原10行为/core98图在8aafec4通过；docs/web/managed/entry其余157图在4012c7b通过。原62行history测试逐字比较一致且串行执行。首轮完整检查的文档失败、direct-node分发测试缺npm_execpath、旧链接断言失败均已如实保留日志并定向补测，未弱化安全条件或重复宽泛审查。
- 真实main构建前原始预算495877，LF487784、全CRLF498105；保留27个绑定文件和500000上限。实际HTTP行为读取200、7条说明可见，旧证据stale是正常的来源变化提示，不伪造绿色。
- 实际main浏览器通过README“开发”链接键盘跳转docs/development.md，路由保持documents-section，无STATE/看板写入；[两张真实截图](behavior-reader-fixes-visual/index.html)已保存。短时服务已关闭；主仓库本地build已更新并严格证明HEAD=index=规范化生成内容，未重复本地产品全量。
- 官方i18n0失败/12既有提示、PluginCheck/PluginPack通过（4条既有权限/转接入口警告）；修复版0.8.3包82文件938188字节，SHA256 `39f4acdc2f60dbafba75896da2525861c861e897ca39d5038996d5f60cf154de`，82条目均匹配来源。版本、manifest权限与依赖不变。
- 通用包150800字节，SHA256 `82bc0233da8eb1405b1dae619bb8a67f9083acd40189dff43e395abf415608b2`，分发清单绑定4012c7b；release:auto --plan通过、publish:false/mutation:false。纯完成记录另走records快路，不重新生成包或跑产品全套。
- 此前市场approved包来源1a03e65、平台SHA a5a9914d…、本地旧包SHA fdb5aaf8…保持历史记录；本轮不调用市场，未覆盖/重提。修复包不能冒充已更新市场版本。最终记录提交/CI由受管git_verify绑定实际结果。

## 限制

- 不自动安装/重启用户已有服务，不恢复暂停桌面或收费任务。旧浏览器服务需关闭并重新启动，才能加载修复后的资源。
- 自动浏览器不等于实体触屏、人工目视或已安装宿主完整E2E；总体任务保持working及原阻塞。
