# Agent 入口

1. 先读 STATE.json 和 README.md；用 governance status 获取有效状态。
2. 有活动任务就继续 current/next；无活动任务但有已批准 followUp 则 start；都没有就等待人工，不发明需求。
3. STATE 是当前任务唯一来源。人决定目标、范围、验收；Agent 在范围内实现、检查和修复。
4. 需要更多信息时只读相关文档或源码，不要求逐层打卡。
5. 进度变化写回 current/next/blocked。写入前重读状态，不能覆盖人工的新意图。
6. Docs 只写用途和用法；不写历史、临时计划或无用解释。Notes 和临时文件按需创建。
7. 完成前实际运行 npm run build、npm test，审查 diff，更新必要用法，verify 后 close。
8. 插件变更用 PluginCheck/PluginPack 更新安装包。参数与流程见 plugin/README.md。
