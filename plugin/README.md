# Governance 工具用法

为当前仓库保存可接手的任务状态，并在验证后关闭任务。PI 注册名为 `governance`，宿主可能添加命名空间前缀。文件访问使用原生 Node fs；Git 操作通过 execFile 执行。不是全局 Agent 拦截器。

## 源码与构建

插件源码和测试使用 TypeScript；`npm ci` 安装开发依赖后，`npm run build` 分别编译主进程（CommonJS）和浏览器脚本（独立配置，无 require/exports），再生成 `plugin/manifest.json`。产物为源码旁的 `.js`，PI-Desktop 入口保持 `main.js`。Node 20 不直接执行 `.ts`，修改后须重新构建。

```powershell
npm run typecheck
npm run build
npm test
```

TypeScript 是开发依赖，不会进入插件运行时；PluginCheck 和 PluginPack 仍由 PI-Desktop 的插件工具负责生成 `.piplug` 安装包。

Git 分支/worktree、范围检查、提交验证、集成及恢复，见 [Git 协作用法](GIT.md)。写入型委派前先 git_create 分配工作区；插件不自动启动子代理。

## 可视化面板

在 PI-Desktop 命令面板搜索「Agent Governance: 打开治理面板」（governance.open），作用于宿主当前工作区主根。需要 ui.panel 权限；Agent 工具另需 agent.tool.register 授权。

面板展示目标、验收条件、范围、进度、阻塞，以及 Git 工作区、分支和验证有效性。未初始化时可创建缺失入口文件；待命时可创建任务；有活动任务时可更新进度。所有写入需确认，状态过期或项目切换时拒绝写入，保存进度使旧验证失效。测试、任务关闭和 Git 写入仍使用工具流程。

工作项看板和源码支撑的项目架构见 [项目数据用法](PROJECT.md)。面板可创建/编辑工作项、拖动或用按钮排序及迁移；总体治理流程图只展示有效状态及允许路径，不自动执行验收。

点击刷新同步外部修改；未保存表单需再次点击刷新才会丢弃。Git 不可用不妨碍任务状态操作。直接打开 renderer/index.html 为静态预览，不能操作项目。确认、owner 和测试证据仍是调用方声明，不是身份认证或安全沙箱。

## 接手与执行

依次调用，每段 JSON 是一个独立请求：

```json
{"action":"init"}
```

init 仅补齐 AGENTS.md、README.md、STATE.json，已有文件不覆盖。之后先读取 README，并调用：

```json
{"action":"status"}
```

有活动任务就按 current/next 继续；无活动任务但有已批准的 followUp，调用 `{"action":"start"}`；两者都没有则等待人工，不新增目标。

人工批准新任务后可调用：

```json
{"action":"start","id":"cache-fix","goal":"修正缓存一致性","criteria":["等价性测试通过"],"scope":["缓存模块"],"constraints":["不改变公共接口"]}
```

STATE 是任务定义的唯一来源。不生成 task.md、findings.md 或 delta.md 空模板。必要的临时探索可自行写入当前 changes/active/<id>/。

```json
{"action":"progress","current":"实现完成，待测试","next":["运行等价性测试"],"blocked":[]}
```

## 人工更新 State

可编辑 goal、criteria、scope、constraints、current、next、blocked。不要修改 task/change 等身份字段或伪造 verification/gate。修改目标后先 status，再重新验证。

`next` 是当前任务的执行步骤；`followUp` 是当前任务结束后的已批准任务，格式如下；没有任务就设为 null：

```json
{"id":"approved-next","goal":"人工批准的目标","criteria":["验收条件"],"scope":[],"constraints":[]}
```

将此对象写入 STATE.json 的 followUp 字段，关闭时会保留。可以在 idle 状态设置 followUp，无需聊天历史。任务 ID 不可重复使用。人工编辑时暂停正在运行的工具操作，避免竞争。

## 验证与关闭

先实际测试、检查 diff、完成必要使用文档更新，再提交：

```json
{"action":"verify","passed":true,"accepted":[true],"evidence":"实际命令、结果及日志位置","diffReview":"实际审查范围与结论","files":["README.md"]}
```

files 替换成真实变更文件；accepted 与 criteria 一一对应。README、AGENTS 和 context 读过的文件会加入验证指纹。总共最多 100 个现存文本文件，不支持删除文件证据。验证后改动受检文件会阻止关闭；改动任务意图会使验证失效。

```json
{"action":"close","knowledge":"已更新 README 的用法；没有需要保留的额外经验。"}
```

knowledge 必须说明已更新的使用文档，或说明为什么无需更新。无需固定五问，也不强制新增 Notes。关闭后保存 closure.json 到 changes/archive，State 保留 followUp；没有 followUp 则明确等待人工。

## 可选操作

- `context`：传 layer、files；非 docs 层附 reason。可跳过层级直接读取相关 source。Docs/Contract 使用 README、AGENTS 或 docs/；Notes 使用 notes/。每次最多 10 文件、40000 字符，单文件最多 1 MiB。
- `route`：传 features（files、modules、research、architecture 等），仅建议模型档位，不切换模型。
- `gate`：兼容旧流程，传 delta 和 behavior/contract/stableFact/pitfall/decision 五类 decisions，各含 changed、reason，changed=true 时含文档 path；之后可不带 knowledge 调用 close。

受检文档预算：AGENTS 60 行、README 150 行、overview 100 行、architecture 200 行、其他 docs 文件 100 行。Docs 只保留用途、用法和必要限制；Notes 可选。

工具不会验证证据真实性或知识语义，不会发现所有漏报文件。写前比较是尽力冲突检测，不是恶意并发写入的隔离保证。旧版验证记录需要重新 verify；旧文档和临时材料保留，不自动迁移或删除。中断后以相同请求重试 close；锁或状态冲突须检查后人工恢复。
