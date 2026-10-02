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
  const g = new Governance(root); await g.run({ action: 'init' }); return g;
}
const start = { action: 'start', id: 'feature-a', goal: 'Improve module', criteria: ['Tests pass'] };
const verify = { action: 'verify', passed: true, accepted: [true], evidence: 'node --test: all passed', diffReview: 'Reviewed project diff', files: ['docs/overview.md'] };
const gate = { action: 'gate', delta: 'Verified internal change; no public behavior change.', decisions: Object.fromEntries(['behavior', 'contract', 'stableFact', 'pitfall', 'decision'].map(k => [k, { changed: false, reason: 'No reusable change in this category' }])) };
test('route covers all four levels', () => {
  assert.deepEqual([route({}), route({ files: 2 }), route({ modules: 2 }), route({ research: true })].map(r => r.complexity), [0, 1, 2, 3]);
});
test('init preserves existing files', async t => {
  const g = await fixture(t); await g.write('AGENTS.md', 'User rules');
  assert.equal((await g.run({ action: 'init' })).preserved.length, 4);
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
test('context escalation requires reason and cannot skip layers', async t => {
  const g = await fixture(t); await g.run(start);
  await assert.rejects(g.run({ action: 'context', layer: 'source', files: ['plugin.js'] }), /one context layer/);
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
  const g = await fixture(t); let registered, removed;
  global.pi = { workspace: { get: async () => ({ path: g.root }) }, agent: { registerTool: async tool => { registered = tool; }, unregisterTool: async name => { removed = name; } } };
  t.after(() => { delete global.pi; });
  const adapter = require('../plugin/main'); await adapter.onLoad();
  assert.equal(registered.name, 'governance');
  assert.equal((await registered.execute({ action: 'status' })).result.status, 'idle');
  assert.equal((await registered.execute({ action: 'close' })).ok, false);
  await adapter.onUnload(); assert.equal(removed, 'governance');
});
