'use strict';
const fs = require('node:fs');
const path = require('node:path');
const tool = require('../plugin/tool');
const { workbenchTool } = require('../plugin/workbench-tool');
const en = {
  name: 'Agent Governance',
  description: 'Read-only browser workbench for project boards, architecture, Git and Docs; operate through the original AI client with local MCP and portable Skills.',
  safetyNotes: 'Uses Node fs and execFile(git) directly, outside host filesystem/exec gateways. Git actions create branches/worktrees and commits and merge only registered worker commits into their coordinator. Registry/worktrees live under the Git common directory, which may be outside the opened linked worktree. No push, fetch, reset, stash or automatic main merge. Git hooks, signing, fsmonitor and diff helpers are disabled for plugin commands; trusted Git configuration/attributes are still required (filters or merge drivers may execute). Other tools are not intercepted. Evidence and owner labels are caller-attested. No protection against malicious concurrent writers; inspect stale locks and interrupted operations before recovery.'
};
const zh = {
  name: 'Agent 项目治理',
  description: '只读浏览器工作台，查看工作看板、项目架构、Git与Docs；操作留在原AI客户端，与本地MCP和可移植Skill共用核心。',
  safetyNotes: '直接使用 Node fs 和 execFile(git)，不经过宿主文件系统或命令网关。Git 操作可创建分支、工作区与提交，仅将已登记执行任务的提交合并到其协调任务。登记和工作区位于 Git 公共目录，可能在当前打开的关联工作区之外。不执行推送、拉取、reset、stash 或自动合并主分支。插件命令禁用 Git hooks、签名、fsmonitor 和 diff 辅助程序；仍须信任 Git 配置和属性，过滤器或合并驱动可能执行程序。不拦截其它工具。证据和所有者标签由调用方声明。不防御恶意并发写入；恢复前须检查遗留锁和中断操作。'
};
en.safetyNotes += ' Explicit browser commands/tools start an owned 127.0.0.1 service for the verified project. shell.openExternal opens only its generated private local workbench URL, never a supplied URL. desktop.control reads bounded calling-session metadata only; missing/foreign context rejects without fallback. No embedded business workbench, model listing, new chats, prompts or aborts. Existing host conversation/history/model remain in the host. Browser API rejects Agent/model/session operations and arbitrary Git writes. Pages use expiring leases; workspace switch, unload and explicit close revoke owned services. No automatic installation or MCP-token access.';
zh.safetyNotes += ' 显式浏览器命令/工具为核实的项目启动自有127.0.0.1服务。shell.openExternal仅打开其生成的本地私有工作台链接，不接受传入URL。desktop.control只读取有界调用会话元数据；缺失或外来上下文拒绝，不回退其它项目。无内嵌业务工作台、模型列表、新建聊天、发提示词或终止会话。原会话/历史/模型仍在宿主。浏览器API拒绝Agent/模型/会话操作和任意Git写入。页面使用到期租约，切换项目、卸载及显式关闭回收自有服务。不自动安装或读取MCP令牌。';
en.safetyNotes += ' The workbench is read-only: renderer, bridge and HTTP reject all project/board/design writes, even when confirmed. Existing Agent/MCP write APIs retain their original safeguards. No duplicate behavior-document page; Docs are current guidance, Notes optional history.';
zh.safetyNotes += ' 工作台仅查看：渲染器、桥接和HTTP拒绝所有项目/看板/设计写入，即使带确认也不放行。现有Agent/MCP写入接口保留原安全约束。不另设行为文档页；Docs为当前依据，Notes仅按需追溯。';
en.safetyNotes += ' Board stages are todo/doing/done with no separate acceptance task; completed turns or card moves do not prove checks passed. Provides an opt-in architecture Skill through agent.prompt.inject. Design drafts and confirmed baselines are separate from source architecture; confirmation is caller-attested, not authentication or implementation approval. Host Agent permissions still apply.';
zh.safetyNotes += ' 看板只有待办/进行中/已完成，没有独立验收任务；会话结束或移动卡片不证明测试通过。通过agent.prompt.inject提供按需架构Skill；设计草案和确认基线独立于源码架构，确认由调用方声明，不是身份认证或实现授权。Agent工具权限仍由宿主管理。';
en.safetyNotes += ' ui.panel and ui.view expose only the same lightweight launcher: project connection status and an explicit Open browser button. No embedded workbench, automatic browser opening, model controls or project edits. Its bridge accepts only status and confirmed open with a current project revision.';
zh.safetyNotes += ' ui.panel和ui.view仅提供同一轻量入口：项目连接状态与显式打开浏览器按钮，不内嵌工作台、不自动打开浏览器、不提供模型控制或项目编辑。入口桥接仅接受状态及绑定当前项目版本的确认打开。';
const manifest = {
  schemaVersion: 1, id: 'io.github.tonkic.agent-governance', ...en, version: require('../../package.json').version,
  i18n: { en, 'zh-CN': zh }, main: 'main.js',
  ui: { panel: 'entry/index.html', title: { en: 'Open browser workbench', 'zh-CN': '打开浏览器工作台' }, width: 480, height: 440 },
  contributes: { views: [{ id: 'workbench-entry', title: { en: 'Governance workbench', 'zh-CN': '项目治理工作台' }, icon: 'browser', entry: 'entry/index.html', order: 30 }], agentTools: [tool, workbenchTool], skills: [{ id: 'architecture-copilot', path: 'skills/architecture-copilot/SKILL.md' }], commands: [{ id: 'governance.open', title: 'Agent Governance: Open browser workbench / 打开浏览器工作台', keywords: ['governance', '治理', '任务', 'browser'] }] },
  permissions: ['agent.tool.register', 'desktop.control', 'agent.prompt.inject', 'shell.openExternal', 'ui.panel', 'ui.view'],
  engines: { piDesktop: '>=0.1.0' }, activationEvents: ['onStartup', 'onCommand:governance.open']
};
fs.writeFileSync(path.join(__dirname, '../../plugin/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
