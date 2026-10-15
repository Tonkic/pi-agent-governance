# 来源与适配

- 上游：[study8677/architecture-copilot](https://github.com/study8677/architecture-copilot)。
- 固定提交：`462c8c52a6307de0ad34c8a24f94486cc5bd4655`；MIT许可及版权保留在 LICENSE。
- 本插件入口是适配版：分析架构默认先加载源码现状分析模式，设计方案加载设计模式；两者采用同一方法与按需参考，明确区分代码事实、推断、建议和设计意图。
- 现状仅通过architecture_sources/architecture_set保存来源指纹图，不写设计；设计保留STATE/草案约束、人工确认和显式修订，同一节点/关系生成ASCII正文与画板，不覆盖源码图。两种模式均不自动实施。
- references/为该提交的原始知识快照，未改写案例结论。案例、估算、阈值只供判断，不是已验证产品事实。
- 不附带Cursor规则、上游AGENTS.md或安装脚本；不自动联网更新。更新快照须重新审查并记录提交。
