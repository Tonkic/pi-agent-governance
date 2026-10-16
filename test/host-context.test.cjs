'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Governance } = require('../build/plugin/core');
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'host-context-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const a = path.join(root, 'session-project'), b = path.join(root, 'visible-project');
  for (const dir of [a, b]) { await fs.mkdir(dir); const g = new Governance(dir); await g.run({ action: 'init' }); await g.run({ action: 'start', id: 'approved', goal: 'Temporary fixture', criteria: ['Context isolation'] }); }
  const calls = []; let registered;
  const session = { id: 'origin', projectPath: a, mode: 'agent' };
  const pi = {
    workspace: { get: async () => ({ path: b }) },
    app: { getLocale: async () => 'en' },
    agent: { registerTool: async tool => { registered = tool; }, unregisterTool: async () => {} },
    commands: { register: async () => {}, unregister: async () => {} },
    desktop: { listOperations: async () => [{ id: 'session/get' }], invoke: async request => { calls.push(request); return { session }; } }
  };
  const entry = path.resolve('build/plugin/main.js'); const module = { exports: {} };
  vm.runInNewContext(await fs.readFile(entry, 'utf8'), { module, exports: module.exports, require: createRequire(entry), pi }, { filename: entry });
  await module.exports.onLoad();
  return { a, b, session, calls, pi, adapter: module.exports, tool: registered };
}
test('PI tool stays in its calling session project when the visible workspace differs', async t => {
  const f = await fixture(t), before = await fs.readFile(path.join(f.b, 'STATE.json'), 'utf8');
  const answer = await f.tool.execute({ action: 'progress', current: 'Changed in original session', next: [], blocked: [] }, { sessionId: 'origin' });
  assert.equal(answer.ok, true, answer.error); assert.equal(answer.result.current, 'Changed in original session');
  assert.equal((await new Governance(f.a).run({ action: 'status' })).current, 'Changed in original session');
  assert.equal(await fs.readFile(path.join(f.b, 'STATE.json'), 'utf8'), before);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].operation, 'session/get');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)), [{ id: 'origin', messageLimit: 1, contentLimit: 1 }]);
  const panel = await f.adapter.onPanelInvoke('governance.snapshot', {});
  assert.equal(panel.ok, true); assert.equal(panel.result.workspace, f.b);
});
test('PI missing, foreign, canceled and unsupported caller contexts never fall back to another project', async t => {
  for (const kind of ['missing', 'foreign', 'no-project', 'remote', 'worktree', 'unavailable', 'canceled']) {
    const f = await fixture(t), before = await fs.readFile(path.join(f.b, 'STATE.json'), 'utf8');
    if (kind === 'foreign') f.session.id = 'someone-else';
    if (kind === 'no-project') delete f.session.projectPath;
    if (kind === 'remote') f.session.remoteWorkspace = {};
    if (kind === 'worktree') f.session.worktree = {};
    if (kind === 'unavailable') f.pi.desktop.listOperations = async () => [];
    const answer = await f.tool.execute({ action: 'progress', current: 'Must not change', next: [], blocked: [] }, kind === 'missing' ? undefined : { sessionId: 'origin', signal: { aborted: kind === 'canceled' } });
    assert.equal(answer.ok, false, kind); assert.equal(await fs.readFile(path.join(f.b, 'STATE.json'), 'utf8'), before);
  }
});
