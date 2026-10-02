'use strict';
const fs = require('node:fs');
const path = require('node:path');
const tool = require('../plugin/tool');
const manifest = {
  schemaVersion: 1, id: 'pi.agent-governance', name: 'Agent Governance', version: require('../package.json').version,
  description: 'Repository handoff: current state, approved next tasks, verification and concise documentation.',
  safetyNotes: 'Uses Node filesystem APIs directly, not host-mediated fs permissions. Only the current workspace is used; traversal, symlinks and common credential paths are rejected. Writes STATE.json, new bootstrap documents and changes/. No network or shell execution. Gates apply only to this tool, not other agent tools. Verification evidence is caller-attested, not independently executed. Do not use with untrusted concurrent filesystem writers.',
  main: 'main.js', contributes: { agentTools: [tool] }, permissions: ['agent.tool.register'],
  engines: { piDesktop: '>=0.1.0' }, activationEvents: ['onStartup']
};
fs.writeFileSync(path.join(__dirname, '../plugin/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
