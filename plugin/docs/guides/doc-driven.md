<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->
# 面向文档的功能开发

**人管 `docs/` 与范围授权，Agent 改代码、跑测试并同轮维护 `docs/`。** 架构设计可选，仅在需要明确方向或画图时使用 [架构Skill](../reference/architecture-design.md)；测试通过即完成，不设独立人工或 Agent 二次验收。

## 人与 Agent 协作闭环

1. **人定文档与范围**：先在只读工作台看现状；新需求或变更直接在对话或对应 `docs/<专题>.md` 明确“做什么、输入输出、边界与检查条件”，并在 `STATE.json` 批准 `goal`/`criteria`/`scope`。
2. **Agent 按索引读现状**：启动先查 `status`，从 [文档索引](../README.md) 只读相关专题与源码，不读旧 Notes 猜现状。
3. **实现并同步回写 Docs**：完成代码与测试后，同一轮最小更新受影响的 `docs/*.md`（见 [维护规则](documentation.md)），运行检查自动同步 `plugin/docs/` 并校验死链与百行上限。
4. **审阅闭环**：人只审代码/文档差异与实际测试结果；`verify`/`close` 必须写明已更新哪篇文档或为何无需更新。

## 按需分层与推荐目录架构

- **阅读意图四分区（通用项目）**：`docs/start/`（快速上手）、`docs/guides/`（日常协作）、`docs/reference/`（架构与接口字典）、`docs/ops/`（构建与交付），配合根 `docs/README.md` 路由，人类不翻长列表。
- **轻量限界上下文切片（中大型业务项目）**：推荐吸收战略 DDD 边界，在 `docs/<业务域>/` 与源码 `src/<业务域>/` 一一对齐（统一业务语言），避免传统 Entity/Repository 多层样板套娃。
- **单篇三要素**：用户能做什么（功能层）、输入输出与失败边界、检查条件；小功能一篇说明即可，不建空模板。

文档变化本身不自动授权范围外修改；范围外需求先由人更新 STATE。

## 说明与检查证据

功能和架构说明统一放在 Docs，在“项目文档”阅读；不再有独立“行为文档”页。以下证据状态供开发检查按需查询：

- 未验证：没有本机检查记录。
- 关联隔离浏览器场景通过：全部关联场景已执行，检查成功，文档及关联文件内容仍匹配。
- 覆盖不完整 / 检查失败：关联场景缺失、跳过或失败，旧通过记录不能遮盖它。
- 内容已变 / 进行中：文档、配置、实现或测试已变，或检查未完成，不能沿用上次结果。

通过仅涵盖列出的隔离场景，不替代未执行的真实宿主交互检查。

## 运行项目检查

```powershell
npm run check:behaviors
```

需要配置 Playwright（或 `PI_BROWSER`），见 [开发](../ops/development.md)。命令先构建再执行 `test/browser.cjs`，核对运行 ID、结束标志和全部关联场景后写入本机忽略的 `.governance/behavior-evidence.json`（运行锁 `.governance/behavior-check.lock/`）。换机器或改内容后须重跑，不手写通过记录。

## 关联约定

试点正文位于 [切换项目说明](../reference/behavior-workspace.md) 和 [架构设计](../reference/architecture-design.md)（`### WS-001 — 标题` 或 AD 编号），由 `docs/behavior-bindings.json` 绑定场景 ID 与实现/测试文件。最多 50 条行为、每项 20 场景/20 文件、总计 60 文件/500000 字符（按含 CRLF 原始字节计）。新增编号小节须补齐绑定，未编号段落由人工与常规测试覆盖。

## 边界

可读说明 → 关联检查 → 同步更新文档构成完整闭环；不设复杂审批流或任意 shell 调度器。STATE 保存本次授权范围，历史证据不替代本次测试。
