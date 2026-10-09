<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->
# 文档索引

先按问题定位专题，不必顺序读完。每篇先给用途与常用操作，参数和限制在后面的具名章节；可直接搜索动作名。

| 要解决的问题 | 先读 | 需要深入时 |
| --- | --- | --- |
| 接手目标、更新进度、验证关闭 | [治理用法](governance.md#接手与执行) | 同页“验证与关闭” |
| 看板、工作项验收、架构重分析 | [项目接口](project.md#工作项) | 同页“项目架构” |
| 更新当前项目文档 | [文档维护](documentation.md) | [项目 Agent 操作](project.md#项目-agent-操作) |
| 分支、worktree、提交和集成 | [Git 协作](git.md#原则) | 同页“冲突与恢复” |
| 代码职责与数据位置 | [架构](architecture.md) | 表中的 TS 入口 |
| 构建、测试与安装包生成 | [开发](development.md) | 同页“目录” |
| GitHub 和市场交付 | [交付流程](releasing.md) | [安装与发布](publishing.md) |
| UI 参考与许可 | [来源](ui-sources.md) | 同页 MIT 许可 |

## 写作与位置

采用 [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/welcome/) 和 [Top 10 tips](https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice)：结论在前、短句、动作明确、方便扫读。中文不机械套用英文格式。

- `docs/` 是当前说明的唯一手写来源，不写每次测试的长日志。专题原则上不超过 100 行；变长时按独立问题拆分并回链索引，不建空模板。
- [Notes 索引](https://github.com/Tonkic/pi-agent-governance/blob/main/notes/README.md) 提供简短变更、决策和踩坑摘要；只在需要追溯时读取归档。
- 根 README/AGENTS 仅保留必要入口与执行约束。安装包的 `plugin/README.md` 和 `plugin/docs/` 从这里构建生成，不手改。
- `changes/` 保留机器关闭记录和截图等证据；`.pi/` 是宿主数据，不迁移。当前授权只看 STATE，不从旧记录猜目标。
