<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->
# 项目工作项与架构数据接口

通过 `governance` 工具管理三栏工作项（待办 → 进行中 → 已完成）与源码架构图。功能按文档实现并通过实际测试后即完成，不设独立二次验收。

## 调用顺序与工作项

### 工作项

先调用 `{"action":"project_snapshot"}` 获取最新 `revision`；所有写入动作必须携带 `expectedRevision` 防止并发覆盖：

| 动作 | 必填与常用字段 | 说明 |
| --- | --- | --- |
| `board_create` | `id`, `title`, `expectedRevision`, `description?`, `criteria?`, `gitTaskId?`, `architectureImpact?` | 新建卡片（`id` 小写字母/数字/连字符 ≤64 字符；自动绑定当前 `taskId`） |
| `board_update` | `id`, `title`, `description`, `blocker`, `expectedRevision`, `criteria?`, `architectureImpact?` | 更新卡片内容；省略 `criteria`/`architectureImpact` 时保留原值 |
| `board_move` | `id`, `stage` (`todo`/`doing`/`done`), `position`, `expectedRevision` | 同栏排序或移入新阶段；存在 `blocker` 时禁止移入 `done` |

- **容量上限**：最多 100 张卡片，`.governance/board.json` 序列化不超过 1 MiB。
- **架构影响标记**：`architectureImpact` 取值为 `unassessed`（默认）、`none` 或 `affects`；标记 `affects` 的卡片完成后会在看板底部提示按需复核架构图。
- **历史兼容**：旧版 `accepted` 阶段自动映射显示为 `done`，历史验收记录只读保留不丢失。

## 三栏工作台

浏览器工作台仅只读展示项目数据（HTTP 层拒绝一切 `governance.workitem` 写入）：

- **顶部指标与比例**：实时统计总数、进行中、已完成、影响架构数量与完成百分比（搜索过滤不改变全局总数）。
- **卡片详情弹窗**：点击或按 `Enter` 打开居中模态详情，支持 `‹` / `›` 切换上下项，按 `Escape` 关闭并返还焦点。
- **完成历史表格**：已完成栏默认展示最近 5 项，点击 **「查看全部」** 打开可搜索的完整历史表格（顶部搜索框同样匹配全部历史完成项）。

## 可选项目Agent操作

开发、代码分析、架构设计与文档维护均在原 AI 宿主会话（Antigravity、PI-Desktop、Codex、Claude Code、Pi）内完成，直接复用原会话上下文与模型设置。

- **PI-Desktop**：通过可信 `sessionId` 核实本地会话身份，缺失或跨项目会话直接拒绝。
- **MCP 宿主**：通过启动参数 `--workspace`（或 Claude 官方 `CLAUDE_PROJECT_DIR`）固定绑定项目；切换项目需更新连接配置。
- **工作台启停**：统一通过 `governance_ui`（`open` / `close` / `status`，启停需 `confirmed: true`）管理本地浏览器页面，详见 [浏览器工作台](../start/web-console.md)。

## 可选源码架构

按以下步骤生成绑定真实源码字节指纹的模块架构图（保存在 `.governance/architecture.json`，独立于设计草案）：

1. **读取源码与指纹**：调用 `{"action":"architecture_sources","files":["plugin/core.ts"]}`（最多 60 个文件、总计 180,000 字符）。
2. **保存核实后的模块图**：携带最新 `project_snapshot.revision` 调用 `architecture_set`（最多 40 节点、100 条有向边，禁止自环或悬空引用）：
   ```json
   {
     "action": "architecture_set",
     "expectedRevision": "当前快照revision",
     "graph": {
       "title": "核心模块图",
       "source": "已核对 src/app.ts 直接调用关系",
       "nodes": [{"id":"app","title":"应用入口","description":"初始化服务","files":["src/app.ts"]}],
       "edges": [],
       "fingerprints": {"src/app.ts":"64位SHA256指纹"}
     }
   }
   ```
3. **按需核对变更**：普通快照不重复扫描磁盘源码；传入 `checkSources: true` 或在页面点击 **「核对源码来源」** 时比对最新文件哈希（注意 CRLF/LF 换行变化会影响原始字节指纹）。

## 权限与恢复

- 复用治理内核的路径白名单、敏感文件拦截、符号链接拒绝与原子重命名锁。
- 若 JSON 文件损坏，系统直接报错保留现场，请先备份再人工修复，不会静默重置覆盖数据。
