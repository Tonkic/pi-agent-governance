# 0.8.5 Git图显示降噪

- 用户反馈：常驻图例列出大量Agent分支归属组合，遮住提交图；本轮仅精简显示，不删除真实refs或受管工作区。
- 修改：图例固定主轴/分支两项，以多色小样提示侧线；常驻引用仅HEAD/实际主轴，其他分支名/标签/归属仍在零查询hover及键盘摘要。
- 保留：真实DAG、第一父链居中、分页、原生模态详情、关闭/回焦/滚动、离线及root/epoch/迟到保护，后端未改。
- 回归：真实108提交仓库原用例保留；增加40引用的受控快照，断言图例固定两项、窄屏紧凑、隐藏信息仍可读且hover不请求。演示引用不写真实仓库。
- 版本：0.8.4→0.8.5 patch，无新增权限/依赖；只同步源码和官方包，不市场/凭据/安装/npm/标签/Release。
- 实际提交 `0308cbb5658907c2528156007ea07c7cb49402c8` 执行 `npm run check -- --full --ci`：259测试0失败/0跳过、279截图、原10行为全部通过，原LF/CRLF预算与安全断言保留。此前定向Git浏览器24图通过，40引用/分页/窄屏图例限两项通过；首次新增预悬停造成测试时序干扰，标签检查移到既有聚焦场景后通过，未改产品逻辑/删断言。
- 官方PluginCheck/PluginPack：0.8.5、86文件、1066529字节，SHA256 `3ad4fb5e7289738dcdebacbe82247554e4205342898b54ace1e80381131afd70`；i18n0失败/12既有review，4既有权限警告，无依赖/权限变化。旧0.8.4包已核对原hash，从main62af470历史可取回。
- build:distributions完整源码/条目核对通过；通用包168781字节，SHA256 `10f97196eecd58ae08c1f2b51586cdac7f5a96fda1ba707dbf64a7f826433441`。update:plan --impact patch --check通过0.8.4→0.8.5、marketplaceRequired:false/mutation:false；release只读计划publish:false/mutation:false。
- main `9e4462df4397a4717ad3b884c1014ac9e635a19a` 与已测提交树相同，正常推送/远端SHA已核实；[CI39246651122](https://github.com/Tonkic/pi-agent-governance/actions/runs/39246651122) Linux/Windows全部步骤成功，各259测试0失败/0跳过及完整浏览器/10行为通过。
- 真实main HTTP/浏览器检查：100提交、图例恰为main/分支、端点恰为HEAD/main、hover零额外请求、原生弹窗/关闭回焦、0页面错误；refs/STATE/board逐字节不变。[桌面与手机截图](git-history-quiet-085-visual/index.html)保留；不宣称人工目视/安装宿主或物理触屏通过，原总体阻塞和旧市场待运营状态保留。
- 后续只提交STATE/看板/本证据与截图记录，按records快路检查，明确复用等同产品验证，不声称记录SHA重跑全套。
