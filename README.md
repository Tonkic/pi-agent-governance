# PI Agent Governance

一个只读浏览器工作台，供 **Antigravity**、**PI-Desktop**、Codex、Claude Code 与 Pi 共用。在浏览器查看工作看板、项目架构、Git 和项目文档；在原 AI 会话里开发并同步维护文档。

社区 ID：`io.github.tonkic.agent-governance` · 当前版本：**0.12.1**

## 快速上手

1. **接入 Antigravity / CLI**：按 [MCP 与 Skill](docs/start/mcp.md) 将 `mcp/clients/antigravity.json` 合并到 `~/.gemini/config/mcp_config.json`。在对话中说“打开当前项目工作台”（自动调用 `governance_ui` 的 `open`）。
2. **接入 PI-Desktop**：安装 `plugin/dist/` 下的 `.piplug` 包。打开项目后按 **Alt+空格** 搜索“Agent 项目治理”，或按 **Ctrl+Shift+P** 直接打开工作台。
3. **日常协作**：人在 `docs/` 明确功能与边界，在 [STATE.json](STATE.json) 批准范围；Agent 修改代码、运行测试，并在同一轮更新对应 `docs/`。详见 [面向文档开发](docs/guides/doc-driven.md)。
4. **多端协作**：用 `collaboration-cli` 绑定 GitHub 权威分支；本地提交后推送独立分支提 PR。详见 [GitHub 权威协作](docs/guides/collaboration.md)。

## 四大视图

| 视图 | 用途 | 关键特性 |
| --- | --- | --- |
| **工作台** | 跟踪三栏任务进度 | 顶部统计微图与完成度环；点击卡片看详情，「查看全部」检索全部完成历史 |
| **项目架构** | 查看模块职责与设计 | 源码指纹图、可选 ASCII 设计方案与状态流程切换；支持缩放与上下游追踪 |
| **Git** | 浏览本地提交历史 | `main` 主轴固定居中，悬停看摘要，点击看父提交与文件差异 |
| **项目文档** | 分类阅读项目说明 | 按 4 类目录展示中文标题与路径，提供可视化选读卡、阅读进度条与标题搜索 |

## 常用检查命令

首次或锁文件变更后先执行 `npm ci`：

```powershell
npm run check -- --scope docs    # 检查文档行数、内部链接并生成 plugin/docs/
npm run check -- --scope reader  # 运行文档阅读器局部测试
npm run check -- --full          # 运行完整构建、单元与浏览器回归
```

通用分发包可执行 `npm run build:distributions -- mcp-skills` 构建；PI-Desktop 安装包在宿主内用官方 `PluginCheck` / `PluginPack` 生成。详见 [开发](docs/ops/development.md)、[产物与安装](docs/ops/publishing.md)、[交付规则](docs/ops/releasing.md)。

## 文档导航

- **入门与工作台**：[文档总览](docs/README.md) · [MCP 与 Skill](docs/start/mcp.md) · [浏览器工作台](docs/start/web-console.md)
- **日常工作流**：[面向文档开发](docs/guides/doc-driven.md) · [文档同步规则](docs/guides/documentation.md) · [Git 协作](docs/guides/git.md)
- **接口与历史**：[系统架构](docs/reference/architecture.md) · [治理接口](docs/reference/governance.md) · [看板接口](docs/reference/project.md) · [变更记录](notes/README.md) · [Agent 入口](AGENTS.md)

## 安全与边界

- **本地私有连接**：工作台仅监听 `127.0.0.1`，一次性访问令牌直接交由浏览器保存，不写入聊天日志；请勿转发端口或配置公网代理。
- **严格只读**：网页拒绝一切写入操作；项目修改留在原宿主执行，受确认、修订版本与路径锁保护。
- **版本迁移**：从旧 ID `pi.agent-governance` 升级前，先备份 `STATE.json` 与 `.governance/` 并停用旧插件。
