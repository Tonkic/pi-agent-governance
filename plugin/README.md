# Agent Governance 使用说明

PI 工具 `governance` 接受以下 JSON。按顺序调用，不要将整个示例当作一次请求。

## 1. 初始化与开始

```json
{"action":"init"}
```

```json
{"action":"status"}
```

```json
{"action":"start","id":"cache-fix","goal":"修正缓存一致性","criteria":["等价性测试通过"],"features":{"files":2,"modules":1,"debugging":true}}
```

生成 `changes/active/cache-fix/{task,findings,delta}.md`。暂时猜测、失败尝试写入 findings，不写入长期 Docs。任务 id 不可与活动或归档任务重复。

## 2. 上下文与进度

```json
{"action":"context","layer":"docs","files":["docs/overview.md"]}
```

```json
{"action":"context","layer":"contract","reason":"需要确认模块边界","files":["docs/architecture.md"]}
```

必要时继续到 notes，再到 source；每次最多升级一级。Docs 与 Contract 均从 docs/ 读取（也允许 AGENTS.md），Notes 从 notes/ 读取。Source 仍受路径及大小限制。每次最多 10 个文件、40000 字符；单文件最多 1 MiB。规则仅约束此工具的读取。

```json
{"action":"progress","current":"已修复，等待测试","next":["运行等价性测试"],"blocked":[]}
```

progress 会使旧验证和知识门禁失效。`route` 可独立调用，features 支持 files、modules、research、architecture、interfaceChange、unknownCause、debugging。输出仅建议，不自动切换模型。

## 3. 验证

先实际运行测试、审查 Git diff，并完成必要文档更新，再提交证据：

```json
{"action":"verify","passed":true,"accepted":[true],"evidence":"实际执行的命令、结果及日志位置","diffReview":"审查范围与结论","files":["docs/overview.md"]}
```

`accepted` 与任务 criteria 顺序及数量一致。`files` 应列出所有本次变更的现存文本文件，包括已修改的 Docs/Notes，最多 100 个。示例路径只是演示，请替换为真实变更路径。STATE.json 和 changes/ 不作为项目文件证据。删除文件目前不支持；插件不会自行发现遗漏文件或运行测试。

## 4. Knowledge Gate

```json
{
  "action":"gate",
  "delta":"经过验证的最终有效变化，不含探索流水账。",
  "decisions":{
    "behavior":{"changed":false,"reason":"对外行为不变"},
    "contract":{"changed":false,"reason":"接口不变"},
    "stableFact":{"changed":false,"reason":"没有新增稳定事实"},
    "pitfall":{"changed":true,"reason":"存在可复用的缓存失效经验","path":"notes/bugs/cache.md"},
    "decision":{"changed":false,"reason":"没有新增架构决策"}
  }
}
```

五类必须全部回答并说明理由。前三类 changed=true 时引用 docs/，后两类引用 notes/。先由 Agent 创建或修改这些文档，再提交 gate；插件只检查引用、预算及指纹，不自动把 findings 复制到长期知识。

纯内部实现变更可全部填 false；失败探索保留在 findings。预算：AGENTS.md 60 行、overview 100 行、architecture 200 行、其他 docs 文件 100 行。

## 5. 关闭

```json
{"action":"close"}
```

仅 verified → gate → ready 后可关闭。验证文件、知识文档或 delta 被更改时拒绝关闭；重新提交 verify/gate。成功后归档到 changes/archive，并将 STATE.json 清为 idle。归档后状态写入中断可重试 close。

## 安全与限制

文件访问使用原生 Node fs，宿主 fs 网关不介入。只使用当前工作区主根，无网络或 shell 执行。禁止路径穿越、子路径符号链接和常见凭据路径；不适用于恶意并发文件系统写入者。单活动任务；没有全局 Finish Hook、自动模型切换、自动测试、自动 Git diff 或多 Agent 权限隔离。验证证据为调用方声明，知识内容需人工或 Agent 审查。不要把工具级门禁误当作不可绕过的安全机制。

init 保留所有已有文件；已有 AGENTS.md 需人工合并上述流程。崩溃遗留锁只应在确认无操作运行后删除。任务创建中断可能留下孤立 active 目录，请先检查再人工恢复，不要直接覆盖。
