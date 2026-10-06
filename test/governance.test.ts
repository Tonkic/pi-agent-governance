'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Governance, route } = require('../plugin/core');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'governance-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const g = new Governance(root); await g.run({ action: 'init' });
  await g.write('docs/overview.md', '# Usage\n'); await g.write('docs/architecture.md', '# Architecture\n'); return g;
}
const start = { action: 'start', id: 'feature-a', goal: 'Improve module', criteria: ['Tests pass'] };
const verify = { action: 'verify', passed: true, accepted: [true], evidence: 'node --test: all passed', diffReview: 'Reviewed project diff', files: ['docs/overview.md'] };
const gate = { action: 'gate', delta: 'Verified internal change; no public behavior change.', decisions: Object.fromEntries(['behavior', 'contract', 'stableFact', 'pitfall', 'decision'].map(k => [k, { changed: false, reason: 'No reusable change in this category' }])) };
test('route covers all four levels', () => {
  assert.deepEqual([route({}), route({ files: 2 }), route({ modules: 2 }), route({ research: true })].map(r => r.complexity), [0, 1, 2, 3]);
});
test('init preserves existing files', async t => {
  const g = await fixture(t); await g.write('AGENTS.md', 'User rules');
  assert.equal((await g.run({ action: 'init' })).preserved.length, 3);
  assert.equal(await g.read('AGENTS.md'), 'User rules');
});
test('complete lifecycle archives evidence and resets state', async t => {
  const g = await fixture(t); await g.run(start);
  await assert.rejects(g.run(start), /active task/);
  await assert.rejects(g.run({ action: 'close' }), /gate required/);
  await assert.rejects(g.run(gate), /Verify before/);
  await g.run(verify); await g.run(gate);
  assert.equal((await g.run({ action: 'close' })).status, 'closed');
  assert.equal((await g.state()).status, 'idle');
  assert.equal(JSON.parse(await g.read('changes/archive/feature-a/closure.json')).status, 'ready');
  await assert.rejects(g.run(start), /already archived/);
});
test('failed checks, incomplete acceptance and blockers prevent verification', async t => {
  const g = await fixture(t); await g.run(start);
  await assert.rejects(g.run({ ...verify, passed: false }), /must pass/);
  await assert.rejects(g.run({ ...verify, accepted: [] }), /must pass/);
  await g.run({ action: 'progress', current: 'Waiting', next: [], blocked: ['Dependency'] });
  await assert.rejects(g.run(verify), /blockers/);
});
test('context can skip layers when relevant source is needed', async t => {
  const g = await fixture(t); await g.run(start);
  await assert.rejects(g.run({ action: 'context', layer: 'source', files: ['plugin.js'] }), /reason/);
  await g.write('plugin.js', 'module.exports = {};');
  assert.equal((await g.run({ action: 'context', layer: 'source', reason: 'Implement requested change', files: ['plugin.js'] })).state.layer, 'source');
  await assert.rejects(g.run({ action: 'context', layer: 'contract', files: ['docs/overview.md'] }), /reason/);
  const result = await g.run({ action: 'context', layer: 'contract', reason: 'Need interface details', files: ['docs/overview.md'] });
  assert.ok(result.contents['docs/overview.md']);
});
test('verified project mutation invalidates close', async t => {
  const g = await fixture(t); await g.run(start); await g.run(verify); await g.run(gate);
  await g.write('docs/overview.md', 'Changed');
  await assert.rejects(g.run({ action: 'close' }), /Changed after verification/);
});
test('gate requires all decisions and existing documents for changed facts', async t => {
  const g = await fixture(t); await g.run(start); await g.run(verify);
  await assert.rejects(g.run({ ...gate, decisions: {} }), /decision required/);
  const decisions = { ...gate.decisions, behavior: { changed: true, reason: 'New behavior', path: 'docs/missing.md' } };
  await assert.rejects(g.run({ ...gate, decisions }), /ENOENT/);
  decisions.behavior.path = 'docs/architecture.md'; await g.run({ ...gate, decisions });
  await g.write('docs/architecture.md', 'Changed after gate');
  await assert.rejects(g.run({ action: 'close' }), /Knowledge document changed/);
});
test('document budgets enforced', async t => {
  const g = await fixture(t); await g.run(start); await g.write('docs/overview.md', 'line\n'.repeat(101));
  await assert.rejects(g.run(verify), /line budget/);
});
test('paths deny traversal, absolute paths, credentials and junctions', async t => {
  const g = await fixture(t);
  for (const p of ['../outside', '/outside', 'C:/outside', 'docs/../../x', '.env', '.git/config', 'docs\\x', 'cert.key']) await assert.rejects(g.read(p), /path/i);
  await fs.mkdir(path.join(g.root, 'target'));
  await fs.symlink(path.join(g.root, 'target'), path.join(g.root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(g.read('link/test'), /Symlinks/);
});
test('parallel mutation is refused and lock is released', async t => {
  const g = await fixture(t);
  await g.locked(async () => { await assert.rejects(g.run(start), /busy/); });
  assert.equal((await g.run(start)).status, 'working');
});
test('close recovers archive-before-state crash', async t => {
  const g = await fixture(t); await g.run(start); await g.run(verify); await g.run(gate);
  const s = await g.state(); const save = g.save.bind(g);
  g.save = async () => { throw Error('simulated crash'); };
  await assert.rejects(g.run({ action: 'close' }), /simulated crash/);
  g.save = save;
  assert.equal((await g.run({ action: 'close' })).recovered, true);
  assert.equal((await g.state()).task, null);
});
test('PI adapter registers, executes and unregisters', async t => {
  const g = await fixture(t); let registered, removed, command, removedCommand, opened;
  global.pi = { workspace: { get: async () => ({ path: g.root }) }, agent: { registerTool: async tool => { registered = tool; }, unregisterTool: async name => { removed = name; } }, commands: { register: async value => { command = value; }, unregister: async id => { removedCommand = id; } }, ui: { openPanel: async value => { opened = value; } } };
  t.after(() => { delete global.pi; });
  const adapter = require('../plugin/main'); await adapter.onLoad();
  assert.equal(registered.name, 'governance');
  assert.equal((await registered.execute({ action: 'status' })).result.status, 'idle');
  assert.equal((await registered.execute({ action: 'close' })).ok, false);
  assert.equal(command.id, 'governance.open'); await command.run(); assert.equal(opened.title, 'Agent Governance');
  assert.equal((await adapter.onPanelInvoke('governance.snapshot')).result.state.status, 'idle');
  assert.equal((await adapter.onPanelInvoke('unknown')).ok, false);
  global.pi.workspace.get = async () => null;
  assert.equal((await adapter.onPanelInvoke('governance.snapshot')).ok, false);
  await adapter.onUnload(); assert.equal(removed, 'governance'); assert.equal(removedCommand, 'governance.open');
});
test('minimal initialization and task have no empty documentation artifacts', async t => {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'minimal-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const g = new Governance(root); await g.run({ action: 'init' });
  assert.deepEqual((await fs.readdir(root)).sort(), ['AGENTS.md', 'README.md', 'STATE.json']);
  assert.match((await g.state()).current, /Waiting/);
  await g.run(start); assert.deepEqual(await fs.readdir(path.join(root, 'changes/active/feature-a')), []);
});
test('simplified close preserves approved followUp for a new agent', async t => {
  const g = await fixture(t); await g.run(start);
  const s = await g.state(); s.followUp = { id: 'next-task', goal: 'Approved next change', criteria: ['Done'], scope: ['plugin'], constraints: ['No UI'] };
  await g.write('STATE.json', JSON.stringify(s));
  await g.run(verify); await g.run({ action: 'close', knowledge: 'Usage unchanged; no notes needed' });
  const newcomer = new Governance(g.root);
  assert.equal((await newcomer.state()).followUp.id, 'next-task');
  assert.equal((await newcomer.run({ action: 'start' })).task, 'next-task');
});
test('human changes invalidate verification and preserve new intent', async t => {
  const g = await fixture(t); await g.run(start); await g.run(verify);
  const s = await g.state(); s.goal = 'Human revised goal'; s.criteria = ['Revised acceptance'];
  await g.write('STATE.json', JSON.stringify(s));
  assert.equal((await g.run({ action: 'status' })).status, 'working');
  await assert.rejects(g.run({ action: 'close', knowledge: 'No docs change' }), /gate required/);
  assert.equal((await g.state()).goal, 'Human revised goal');
});
test('README changes invalidate verification without explicit file selection', async t => {
  const g = await fixture(t); await g.run(start); await g.run(verify);
  await g.write('README.md', 'New human instructions');
  await assert.rejects(g.run({ action: 'close', knowledge: 'No docs change' }), /Changed after verification/);
});
test('external state edit during operation is not overwritten', async t => {
  const g = await fixture(t); await g.run(start);
  await g.locked(async () => {
    const s = await g.state();
    await g.write('STATE.json', JSON.stringify({ ...s, goal: 'Human change' }));
    await assert.rejects(g.save(s), /changed externally/);
  });
  assert.equal((await g.state()).goal, 'Human change');
});
test('simplified close recovers after interruption with the same summary', async t => {
  const g = await fixture(t); await g.run(start); await g.run(verify);
  const request = { action: 'close', knowledge: 'No usage change' }; const save = g.save.bind(g);
  g.save = async () => { throw Error('simulated crash'); };
  await assert.rejects(g.run(request), /simulated crash/); g.save = save;
  assert.equal((await g.run(request)).recovered, true);
});
test('starting a different approved task does not discard queued human intent', async t => {
  const g = await fixture(t); const s = await g.state();
  s.followUp = { id: 'queued', goal: 'Queued work', criteria: ['Done'] };
  await g.write('STATE.json', JSON.stringify(s));
  assert.equal((await g.run(start)).followUp.id, 'queued');
});
test('legacy verification without intent fingerprint requires re-verification', async t => {
  const g = await fixture(t); await g.run(start); await g.run(verify);
  const s = await g.state(); delete s.verification.intentHash;
  await g.write('STATE.json', JSON.stringify(s));
  assert.equal((await g.state()).status, 'working');
  await assert.rejects(g.run({ action: 'close', knowledge: 'No docs change' }), /gate required/);
});
test('extracted actions share revision guards and release the lock on rejection', async t => {
  const g = await fixture(t);
  await g.run(start);
  const before = await g.read('STATE.json');
  for (const action of ['progress', 'context', 'verify', 'gate', 'close']) {
    await assert.rejects(g.run({ action, expectedState: 'stale' }), /状态已过期/);
    assert.equal(await g.read('STATE.json'), before);
    await assert.rejects(fs.stat(path.join(g.root, '.governance.lock')), /ENOENT/);
  }
  const result = await g.run({ action: 'progress', current: 'Reviewed', next: [], blocked: [] });
  assert.equal(result.current, 'Reviewed');
  assert.equal(result.status, 'working');
});
