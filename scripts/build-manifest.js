'use strict';
const fs = require('node:fs');
const path = require('node:path');
const tool = require('../plugin/tool');
const manifest = {
  schemaVersion: 1, id: 'pi.agent-governance', name: 'Agent Governance', version: require('../package.json').version,
  description: 'Repository handoff and Git collaboration: isolated task worktrees, scoped commits, commit-bound verification and controlled integration.',
  safetyNotes: 'Uses Node fs and execFile(git) directly, outside host filesystem/exec gateways. Git actions create branches/worktrees and commits and merge only registered worker commits into their coordinator. Registry/worktrees live under the Git common directory, which may be outside the opened linked worktree. No push, fetch, reset, stash or automatic main merge. Git hooks, signing, fsmonitor and diff helpers are disabled for plugin commands; trusted Git configuration/attributes are still required (filters or merge drivers may execute). Other tools are not intercepted. Evidence and owner labels are caller-attested. No protection against malicious concurrent writers; inspect stale locks and interrupted operations before recovery.',
  main: 'main.js', contributes: { agentTools: [tool] }, permissions: ['agent.tool.register'],
  engines: { piDesktop: '>=0.1.0' }, activationEvents: ['onStartup']
};
fs.writeFileSync(path.join(__dirname, '../plugin/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
