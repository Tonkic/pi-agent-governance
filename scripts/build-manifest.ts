'use strict';
const fs = require('node:fs');
const path = require('node:path');
const tool = require('../plugin/tool');
const en = {
  name: 'Agent Governance',
  description: 'Repository handoff, project boards, source-backed architecture and Git collaboration with isolated worktrees and commit-bound verification.',
  safetyNotes: 'Uses Node fs and execFile(git) directly, outside host filesystem/exec gateways. Git actions create branches/worktrees and commits and merge only registered worker commits into their coordinator. Registry/worktrees live under the Git common directory, which may be outside the opened linked worktree. No push, fetch, reset, stash or automatic main merge. Git hooks, signing, fsmonitor and diff helpers are disabled for plugin commands; trusted Git configuration/attributes are still required (filters or merge drivers may execute). Other tools are not intercepted. Evidence and owner labels are caller-attested. No protection against malicious concurrent writers; inspect stale locks and interrupted operations before recovery.'
};
const zh = {
  name: 'Agent 项目治理',
  description: '从仓库接手任务，管理工作项看板与有源码依据的架构；通过隔离工作区、绑定提交的验证和受控集成协作。',
  safetyNotes: '直接使用 Node fs 和 execFile(git)，不经过宿主文件系统或命令网关。Git 操作可创建分支、工作区与提交，仅将已登记执行任务的提交合并到其协调任务。登记和工作区位于 Git 公共目录，可能在当前打开的关联工作区之外。不执行推送、拉取、reset、stash 或自动合并主分支。插件命令禁用 Git hooks、签名、fsmonitor 和 diff 辅助程序；仍须信任 Git 配置和属性，过滤器或合并驱动可能执行程序。不拦截其他工具。证据和所有者标签由调用方声明。不防御恶意并发写入；恢复前须检查遗留锁和中断操作。'
};
en.safetyNotes += ' User-confirmed panel actions use desktop.control to create isolated analysis/review Agent sessions, send prompts, read bounded progress/results, open and cancel recorded sessions. Model calls may incur charges. No local MCP token access. Acceptance evidence is caller-attested, not independent proof; completed Agent turns do not automatically accept work.';
zh.safetyNotes += ' 经用户确认的面板操作使用desktop.control创建独立分析/验收Agent会话、发送任务、读取有限进度/结果、打开和取消已记录会话，模型运行可能产生费用。不读取本地MCP令牌。验收证据由调用方声明，不是独立证明；Agent对话结束不自动代表验收通过。';
const manifest = {
  schemaVersion: 1, id: 'io.github.tonkic.agent-governance', ...en, version: require('../../package.json').version,
  i18n: { en, 'zh-CN': zh },
  main: 'runtime/main.js', ui: { panel: 'renderer/index.html', title: { en: en.name, 'zh-CN': zh.name } },
  contributes: { agentTools: [tool], commands: [{ id: 'governance.open', title: 'Agent Governance: Open panel / 打开治理面板', keywords: ['governance', '治理', '任务', 'git'] }] },
  permissions: ['agent.tool.register', 'ui.panel', 'desktop.control'],
  engines: { piDesktop: '>=0.1.0' }, activationEvents: ['onStartup', 'onCommand:governance.open']
};
fs.writeFileSync(path.join(__dirname, '../../plugin/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
