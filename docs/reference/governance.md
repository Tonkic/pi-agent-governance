# Governance 工具用法

保存当前仓库的任务状态，跟踪执行进度，并在检查通过后验证归档。社区插件 ID：`io.github.tonkic.agent-governance`（从旧 ID `pi.agent-governance` 升级见 [产物与安装](../ops/publishing.md)）。

## 接手与执行

每次调用传入一个独立 JSON 对象：

1. **初始化项目**（仅补齐缺失的 `AGENTS.md`、`README.md`、`STATE.json`，不覆盖已有文件）：
   ```json
   {"action":"init"}
   ```
2. **读取当前状态**：先读 `README.md`，再查询状态：
   ```json
   {"action":"status"}
   ```
   - 有活动任务：按 `current` / `next` 继续执行。
   - 无活动任务但有获批 `followUp`：调用 `{"action":"start"}` 启动。
   - 两者皆无：等待人工指令，不自行发明需求。
3. **启动人工批准的新任务**：
   ```json
   {"action":"start","id":"cache-fix","goal":"修正缓存一致性","criteria":["等价性测试通过"],"scope":["src/cache/"],"constraints":["不改变公共接口"]}
   ```
4. **更新执行进度**（修改进度会自动使旧验证记录失效）：
   ```json
   {"action":"progress","current":"实现完成，待测试","next":["运行等价性测试"],"blocked":[]}
   ```

## 人工编辑 STATE.json

人工可直接编辑 `goal`、`criteria`、`scope`、`constraints`、`current`、`next`、`blocked`（编辑前暂停正在运行的工具操作，勿手改 `task`/`change`/`verification` 内部字段）。

如需预设下一项已批准任务，在 `STATE.json` 中写入 `followUp`（无后续任务设为 `null`，任务 ID 不可重用）：

```json
{"id":"approved-next","goal":"人工批准的目标","criteria":["测试条件"],"scope":[],"constraints":[]}
```

## 验证与关闭

完成实际测试、审查差异并同步更新相关 `docs/` 后，登记验证并关闭归档（不设额外二次人工验收）：

1. **登记技术检查结果**（`accepted` 与 `criteria` 一一对应，`files` 填写最多 100 个真实变更文本文件）：
   ```json
   {"action":"verify","passed":true,"accepted":[true],"evidence":"实际测试命令与结果","diffReview":"差异审查范围与结论","files":["README.md"]}
   ```
2. **关闭任务并归档**（`knowledge` 必填，说明已更新哪篇文档或为何无需更新）：
   ```json
   {"action":"close","knowledge":"已同步更新 docs/guides/cache.md 用法；无额外踩坑。"}
   ```

关闭后自动归档至 `changes/archive/<id>/closure.json`，并保留预设的 `followUp`。验证后若受检文件或任务意图再次变化，系统会阻止直接 `close`，须重新验证。

## 可选操作与行数预算

- **`context`**：按需读取上下文文件（`layer` 为 `docs`/`contract`/`notes`/`source`，非 `docs` 层附 `reason`；单次最多 10 文件、40,000 字符）。
- **`route`**：根据 `files`、`modules`、`architecture` 等特征给出模型档位建议（仅供参考，不自动切换宿主模型）。
- **`gate`**：兼容旧版五问知识门禁接口。
- **文档行数上限**：`AGENTS.md` ≤60 行、`README.md` ≤150 行、`docs/reference/architecture.md` ≤200 行、其余 `docs/` 专题 ≤100 行。

## 相关指南与限制

- 浏览器只读工作台打开方式见 [浏览器工作台](../start/web-console.md)；看板与架构数据操作见 [项目接口](project.md)；分支与 worktree 管理见 [Git 协作](../guides/git.md)。
- 测试证据与确认标记由调用方如实声明；文件锁用于防止常规误覆盖，不充当恶意并发沙箱。
