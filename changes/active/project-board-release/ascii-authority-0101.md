# 0.10.1 — ASCII权威与可视化一致

## 范围与根因

用户要求以ASCII文本为准，再转换可视化。旧实现从JSON分别生成ASCII和画板，保存会覆盖ASCII编辑。修复仅针对设计方案的数据源和身份对应，不修改源码事实图/SSH/GitHub协作或权限。

受管ASCII方框确定ID/标题，箭头确定端点/标签；固定有界解析后保存结构并生成snapshot.graph，浏览器只读取该graph。描述与安全路径按ID补充；新增ID缺说明时用标题，files为空。Nodes v2转义反斜线以保持可逆。旧Nodes/无图记录只读兼容，原文件及确认指纹保留；无块旧调用仅初始化一次。

## 已执行

- 基线b784dbb；新回归4项先失败：新节点被旧数据覆盖、模型为空、无效ASCII未拒绝、无解析器。
- 修复后定向test/ascii-authority.test.cjs及design.test.cjs：15通过、0失败/跳过。覆盖分叉/汇合/循环/孤立节点、只改ASCII、方向/标签、转义、拒绝坏结构保留文件、旧基线与确认/任务/修订隔离。
- npm ci与首次build通过。日志ascii0101-red/green/build/install.log位于本会话scratch。

## 完整检查与官方包

- 一次限范围审查发现旧无图大基线派生ASCII超20k不可读；新增40节点/100边旧指纹夹具复现Invalid ASCII budget，再修复。仅已校验旧图只读派生解析上限200k，新保存正文/ASCII仍20k；其余限额不变。
- 首轮full：299项中297通过，提示词固定措辞及CRLF预算506072失败；恢复停止措辞，103行独立旧记录浏览器场景逐行等同提取并原位置await，全部断言/行为绑定/500000预算保留。
- 最终npm run check -- --full通过：类型/单轮构建/299测试、0失败/跳过，279截图检查及原10行为场景。CRLF来源499286字符。实际SVG端点/箭头/节点ID跟随ASCII，旧JSON故意保留反向关系。
- 官方i18n 0失败/12既有review；PluginCheck/PluginPack通过，110文件1955273字节，SHA256 284ad9efe62cd7ee8870db467120ecd32b8828f934bc70cd1a6cb5e40be599a0；4既有权限警告，未新增权限。
- 日志ascii0101-full-final.log、review-red.log、i18n.log和ascii0101-shots位于本会话scratch；最终交付与CI见下节。
- 产品提交8cf12a2，main9f50ed4等同树；普通push/远端SHA核对、main17设计测试通过。分发源8cf12a2，通用326059字节SHA9f41698d24b5076c040225105dbbd3371739e44f14fb7f60d5cfbc110f363ef9；updateplan patch/marketfalse、releaseplanfalse通过。
- CI40279476997：Linux完整通过；Windows299测试/10行为及ASCII浏览器场景通过，随后en320阅读首屏958px失败。临时探针延迟ResizeObserver复现939px；原测试只等已是light的主题值，先于折叠文件库事件测量。补两行等待实际响应式details状态，不改产品或阈值；相同延迟探针28图及阅读/链接/排版/壳层104图补测通过。官方包SHA未变，最终CI待核对。

## 最终交付

- 补修提交74a0c52，正常合入main f3732eb128e737d6c8c6f60233de9f5026ee015f，树等同且普通push/完整远端SHA核对通过。产品及官方包仍等同8cf12a2；未重跑等同内容的本地全套。
- 实际完整CI [40280774929](https://github.com/Tonkic/pi-agent-governance/actions/runs/40280774929) Linux/Windows全部步骤success；完整日志核对两套各299测试、299通过、0失败/跳过、279截图/原10行为。自动局部run40280766389被同分支手动full按并发策略取消，不冒充通过；原失败run保留。
- 最后只更新STATE/看板/本证据，按records检查后提交；不重构建/打包、不把记录SHA冒充产品全量运行。仅本工作项完成，总体working及原市场/宿主/目视阻塞保留；无后续获批可执行项。

## 限制

固定Nodes v2/Relationships语法，不识别任意手绘布局，不新增自环/同端点多边契约。旧确认记录不自动迁移；修订须明确草案及人工确认。自动截图不代表人工目视或安装宿主验收。0.10.1 patch不市场，不自动安装/npm/标签；原总体宿主/目视与SSH市场阻塞保留。
