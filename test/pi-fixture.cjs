'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Governance } = require('../build/plugin/core');
exports.fixture = async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'pi-browser-')));
  const a = path.join(root, 'session-project'), b = path.join(root, 'visible-project');
  for (const dir of [a, b]) { await fs.mkdir(dir); const g = new Governance(dir); await g.run({ action: 'init' }); await g.run({ action: 'start', id: 'approved', goal: 'Temporary fixture', criteria: ['Context isolation'] }); }
  const calls = [], opened = [], removed = [], tools = new Map(), events = new Map(); let command;
  const session = { id: 'origin', projectPath: a, mode: 'agent' };
  const pi = {
    workspace: { get: async () => ({ path: b }) }, app: { getLocale: async () => 'en' },
    shell: { openExternal: async url => { opened.push(url); } },
    events: { on: (name, fn) => events.set(name, fn), off: name => events.delete(name) },
    agent: { registerTool: async tool => { tools.set(tool.name, tool); }, unregisterTool: async name => { removed.push(name); } },
    commands: { register: async value => { command = value; }, unregister: async id => { removed.push(id); } },
    desktop: { listOperations: async () => [{ id: 'session/get' }], invoke: async request => { calls.push(request); return { session }; } }
  };
  const entry = path.resolve('plugin/runtime/main.js'), module = { exports: {} };
  vm.runInNewContext(await fs.readFile(entry, 'utf8'), { module, exports: module.exports, require: createRequire(entry), __dirname: path.dirname(entry), pi, setTimeout, clearTimeout }, { filename: entry });
  t.after(async () => { await module.exports.onUnload().catch(() => {}); await fs.rm(root, { recursive: true, force: true }); });
  await module.exports.onLoad();
  return { a, b, session, calls, pi, adapter: module.exports, tool: tools.get('governance'), ui: tools.get('governance_ui'), tools, opened, events, removed, command: () => command };
};
