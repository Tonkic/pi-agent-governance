# 项目工作项与架构数据接口

日常开发只用三栏：待办 → 进行中 → 已完成。根据功能文档实现并运行相关测试，通过后完成；没有独立人工或Agent验收。STATE保存当前目标和范围，卡片状态不自动证明测试通过。

## 调用顺序

CLI在所选工作区执行，向 `node <插件仓库>/build/scripts/governance.js` 标准输入传一个JSON对象。先构建、`init`（不覆盖已有文件），再调用`project_snapshot`。项目写入携带该快照的`expectedRevision`，成功后重读；版本绑定工作区、STATE和项目数据，过期或切换拒绝写入。

### 工作项

- `board_create`：id（小写字母、数字、连字符，最多64字符）、title（160字符）、可选description、criteria（最多20条，每条1000字符）、已登记gitTaskId、architectureImpact。创建时记录当前taskId，不随以后任务改绑。
- `board_update`：id、title、description、blocker，可选criteria和architectureImpact。省略条件/标识保留旧值；描述/阻塞省略按空处理。内容变化使旧历史检查失效，不产生新的验收流程。
- `board_move`：id、stage（todo/doing/done）、position（目标列从0开始）。同列排序或相邻列迁移；有阻塞不能进入done。需要继续修改时从done退回doing。
- 完成前实际运行功能文档中的检查并报告结果。不增加单独确认环节，不把移动卡片或会话结束当成测试证据；失败则保持进行中并修复。
- 最多100项，序列化不超过1MiB；超限拒绝并保留原文件。保存`.governance/board.json`，不替代STATE检查或Git提交验证。

`board_accept`和新accepted迁移已移除。旧accepted项在快照/界面显示为done，旧检查记录保留只读；读取不迁移文件、不删除历史。再次编辑或移动该项按三栏处理，不批量重写其它旧项。

architectureImpact为unassessed/none/affects，缺省未评估。完成且影响架构的项只提示需要时手动复核，不启动Agent、不强制设计或重画。架构是可选工具，不是完成前置条件。

面板`governance.project`读取快照；`governance.workitem`只允许创建、更新、移动三个动作，参数`{args, revision, confirmed:true}`。取消不写入；失败重读，不用乐观位置假装保存成功。安全写入确认不是功能验收。

## 三栏工作台

界面按左侧导航、欢迎区与统计卡、三栏看板和项目摘要组织。统计取当前项目已加载数据，不把筛选后的可见数量当总数；空数据或读取失败不伪造状态。完成比例只是工作项分布，不等于测试通过。无来源的成员、优先级、Agent在线或Git增长指标不展示。

点击对象打开居中详情，不压缩看板；背景暂不可操作，Tab在弹窗内，返回/Escape关闭并返回对象焦点。上一项/下一项浏览当前对象，切换未保存草稿仍需确认。新建ID自动生成，检查条件在详情中，历史检查记录折叠查看，不提供验收按钮。

已完成默认只展示近期5项，点击「查看全部」打开可搜索表格；全局搜索能匹配全部完成项，不受5项限制。最近按真实completedAt排序，旧项可用明确标示的历史检查日期，没有日期的显示未记录并沿用保存顺序，不批量回填。重新进入done才记录新日期，同栏排序不改变；退回doing清除当前完成时间。历史不删除；表格查看不写盘。

右键、长按、更多按钮或Shift+F10打开菜单。菜单提供详情、编辑、指导、排序和相邻栏移动；方向键/Home/End选择，Enter执行，Escape返回。指导Agent仅生成可复制文本，不启动执行。拖动排序，`/`聚焦搜索，筛选时暂停拖动。

写入需安全确认。关闭或切换未保存表单时确认丢弃；取消保留草稿。离线暂停写入，恢复不重放；错误不自动重试。刷新先提示未保存内容，再次点击才丢弃重读。

浏览器固定绑定项目。PI工作区切换关闭旧服务，重新明确打开新项目；旧标签页不重定向，迟到请求不能进入新项目。草稿仅在原标签页内存，可复制，不自动跨页恢复。未初始化项目仍须确认启用。

## 可选项目Agent操作

开发、分析和文档维护在原宿主会话执行，保留已有历史/模型/思考设置，不复制聊天或建立上下文库。浏览器不再提供模型列表、新建/停止会话、分析进度控制或文档Agent按钮；HTTP同样拒绝这些操作。旧operations记录/兼容实现保留，不自动重放或删除。

PI的governance和governance_ui工具用可信ctx.sessionId、有界session/get核对原项目；缺失、外来、远程、隔离worktree、定时或只读会话拒绝，不回退前台项目。显式浏览器命令只读宿主可见项目。desktop.control仅用于身份元数据，不执行Agent/create/prompt/abort。

MCP使用显式绑定项目或Claude官方启动项目；Codex Hook只读注入当前状态，不动态重绑普通MCP。不把roots/最近聊天当活动项目，不读私有数据库、凭据或transcript。切换项目需重建正确的MCP连接。

共用governance_ui只接受open/close/status及confirmed；open/close需明确用户意图后confirmed:true，不接受路径或URL。同项目复用服务，切换/卸载/断开/页面租约到期回收，只返回安全origin和状态，不向聊天输出私有链接。详情见 [浏览器工作台](web-console.md)。

分层文档开发见 [功能开发](doc-driven.md)；架构共创仅在需要开发方向或图时使用，见 [可选架构设计](architecture-design.md)。

## 可选源码架构

1. architecture_sources携带选定files，返回文本和SHA-256 fingerprints；最多60文件、180000字符，单文件沿用1MiB限制。
2. 阅读源码后只描述已核对职责和关系，接口不自动理解依赖，也不证明设计正确。
3. architecture_set提交当前project_snapshot版本和graph：

```json
{
  "title": "示例项目",
  "source": "已阅读 src/app.ts；只描述入口",
  "nodes": [{"id":"app","title":"入口","description":"组装应用","files":["src/app.ts"]}],
  "edges": [],
  "fingerprints": {"src/app.ts":"architecture_sources返回的64位SHA-256"}
}
```

最多40节点、100关系、每节点1–10路径。关系格式from/to/label，不允许自环、重复或悬空关系；引用需精确指纹，源码变化拒绝写入。保存`.governance/architecture.json`，独立于设计方案。

源码指纹按原始字节计算，包含换行；CRLF/LF切换可能需重新核对。不能盲目刷新指纹隐藏差异。正常快照不扫描源码；checkSources:true或手动核对来源才比较，不改图，不证明架构语义变化。

图支持平移、缩放、适应和上下游追踪。循环依赖同层，长边绕开中间层；核心图一般3–5职责，不自动穷举文件。标签区分代码调用、回调和概念关系。任务流程图只显示当前STATE技术记录，不是必经开发阶段。

## 权限与恢复

复用安全路径、敏感文件/符号链接限制、项目锁和临时文件重命名。只选择可信非敏感项目；模型可能处理项目内容。遗留锁确认进程退出后再处理，锁不防恶意并发写入或硬链接。

坏数据保留报错，先备份再人工修复，不删除“恢复默认”。无STATE或无效STATE拒绝写入。接口不自动运行测试、关闭任务或集成Git；实际检查记录继续沿用原技术接口，不增加人工验收门槛。
