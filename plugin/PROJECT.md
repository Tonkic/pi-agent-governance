# 项目工作项与架构数据接口

这些接口由开发源码中的 governance 工具和 CLI 提供。现有 0.4.0 安装包和面板尚未接入这些功能；不能把工作项完成视为总体任务验收。

## 调用顺序

CLI 在所选工作区执行，向 `node <插件仓库>/scripts/governance.js` 标准输入传入一个 JSON 对象。先 `init`（不覆盖已有文件），再调用 `project_snapshot`。所有项目写入必须带上该快照返回的 `expectedRevision`，每次成功写入后重新读取快照。版本绑定工作区绝对路径、STATE 和两份项目数据；工作区切换、人工修改或其他写入均使旧版本失效。

### 工作项

- `board_create`：`id`（小写字母、数字、连字符，最多 64 字符）、`title`（最多 160 字符）、可选 `description`、可选已登记 `gitTaskId`。创建时记录当前总体任务 `taskId`，没有活动任务则为 null。
- `board_update`：`id`、`title`、`description`、`blocker`。未传描述/阻塞按空字符串处理；完成项须先退回 doing 才能添加阻塞。
- `board_move`：`id`、`stage`（todo / doing / done）、`position`（目标列从 0 开始的插入位置，不含被移动项）。只允许同列排序或相邻列迁移，有阻塞不能进入 done。
- 最多 100 项。记录保存在 `.governance/board.json`，不修改 STATE 验收或 Git 登记状态。历史工作项保留创建时关联的总体任务，不随新任务改绑。

面板通道 `governance.project` 读取快照；`governance.workitem` 仅允许上述三个写入动作，参数为 `{args, revision, confirmed: true}`。取消时不得调用写入；失败后重新读取，不以本地乐观位置假装成功。该确认是调用方声明，不是身份认证。

### 项目架构

1. `architecture_sources` 携带明确选定的 `files`，返回源码文本和 SHA-256 `fingerprints`。一次最多 60 个文件、180000 字符，单文件沿用内核 1 MiB 限制。
2. Agent 阅读返回内容，仅描述已核对的职责与关系。接口不会证明 Agent 理解了源码，不会自动生成依赖图。
3. `architecture_set` 携带最新 `expectedRevision` 和 `graph`：

```json
{
  "title": "示例项目",
  "source": "已阅读 src/app.ts；仅描述入口，不包含运行时调用监控",
  "nodes": [{"id":"app","title":"应用入口","description":"组装应用服务","files":["src/app.ts"]}],
  "edges": [],
  "fingerprints": {"src/app.ts":"替换为 architecture_sources 返回的 64 位 SHA-256"}
}
```

节点最多 40 个，每节点 1–10 个源码路径；边最多 100 条，格式 `{from, to, label}`，不允许自环、重复边或悬空端点。所有引用都需要精确指纹，源文件变化时拒绝写入。保存位置 `.governance/architecture.json`，包含来源和更新时间。

`project_snapshot` 返回工作区、revision、board、architecture 及独立错误字段；无架构返回 null，损坏数据返回错误，不提供固定插件图作为替代。架构引用源码变化或丢失时 `staleFiles` 列出需重读的文件。指纹只证明内容一致，不证明关系语义；来源说明应明确覆盖范围。

## 权限、恢复与限制

沿用 Node fs、工作区相对路径限制、敏感路径和符号链接拒绝策略；不读取仓库外文件，不发送源码到网络。请只选择非敏感源码，路径过滤不是完整的秘密扫描。项目写入复用 `.governance.lock`，使用临时文件重命名；遗留锁需确认原进程已退出后再人工移除。锁不防御不遵守协议的恶意并发写入或硬链接。

数据损坏时保留原文件，先备份再人工修复；不要删除用户数据“恢复默认”。工作项损坏会拒绝工作项写入；架构可通过重新核对源码并提交最新版本替换。没有 STATE 或 STATE 无效时拒绝写入。工作项不是自动调度器，也不允许通过此接口 verify、close 或 Git integrate。
