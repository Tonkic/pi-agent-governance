'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { Governance } = require('../plugin/runtime/core');
const { architectureAscii, parseArchitectureAscii } = require('../plugin/runtime/design');
const node = id => ({ id, title: '模块 ' + id, description: 'Responsibility ' + id, files: [] });
const proposal = () => ({ title: 'ASCII authority', document: 'Design intent', nodes: ['a', 'b'].map(node), edges: [{ from: 'a', to: 'b', label: 'old direction' }] });
const document = (graph) => 'Design intent\n\n<!-- governance:architecture-ascii:start -->\n```text\n' + architectureAscii(graph) + '\n```\n<!-- governance:architecture-ascii:end -->';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || require('node:os').tmpdir(), 'ascii-authority-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const g = new Governance(root);
  await g.run({ action: 'init' });
  await g.run({ action: 'start', id: 'ascii', goal: 'ASCII authority', criteria: ['Exact graph'] });
  const snapshot = () => g.run({ action: 'architecture_design_snapshot' });
  await g.run({ action: 'architecture_design_begin', expectedRevision: (await snapshot()).revision, reason: 'Explicit correction' });
  const save = async p => { const s = await snapshot(); return g.run({ action: 'architecture_design_save', expectedRevision: s.revision, expectedDraft: s.draft.draftId, proposal: p }); };
  return { root, snapshot, save };
}
test('editing only ASCII replaces stale topology and titles instead of overwriting the text', async t => {
  const f = await fixture(t), p = proposal();
  const authored = { nodes: [node('b'), { ...node('c'), title: '新增职责' }], edges: [{ from: 'c', to: 'b', label: 'ASCII direction' }] };
  p.document = document(authored);
  await f.save(p);
  const s = await f.snapshot();
  assert.deepEqual(s.draft.proposal.nodes.map(n => [n.id, n.title]), authored.nodes.map(n => [n.id, n.title]));
  assert.deepEqual(s.draft.proposal.edges, authored.edges);
  assert.deepEqual(s.draft.graph.nodes, s.draft.proposal.nodes);
  assert.deepEqual(s.draft.graph.edges, authored.edges);
  assert.match(s.draft.ascii, /\[c\] -- ASCII direction --> \[b\]/);
  const before = await fs.readFile(path.join(f.root, '.governance/architecture-design.json'), 'utf8');
  await f.save(s.draft.proposal);
  assert.equal((await f.snapshot()).draft.proposalFingerprint, s.draft.proposalFingerprint);
  assert.ok(before.includes('ASCII direction'));
});
test('ASCII to graph model preserves every directed labeled edge for branches, merges, cycles and isolates', async t => {
  const f = await fixture(t), p = proposal();
  const authored = { nodes: ['entry', 'left', 'right', 'join', 'exit', 'alone'].map(node), edges: [
    ['entry', 'left'], ['entry', 'right'], ['left', 'join'], ['right', 'join'], ['join', 'left'], ['join', 'exit'], ['entry', 'exit']
  ].map(([from, to], i) => ({ from, to, label: '关系 ' + i })) };
  p.document = document(authored);
  await f.save(p);
  const graph = (await f.snapshot()).draft.graph;
  const script = await fs.readFile(path.resolve('plugin/runtime/renderer/graph-model.js'), 'utf8');
  const model = vm.runInNewContext(script + ';({setGraphData,get nodes(){return graphNodes},get edges(){return graphEdges}})');
  model.setGraphData(graph);
  assert.deepEqual(Object.keys(model.nodes).sort(), authored.nodes.map(n => n.id).sort());
  assert.deepEqual(Array.from(model.edges, e => ({ from: e.from, to: e.to, label: e.label })), authored.edges);
  for (const e of model.edges) assert.ok(!/NaN|undefined/.test(e.path));
  assert.ok(model.nodes.entry.y < model.nodes.exit.y);
});
test('invalid or dangling ASCII refuses the write without replacing the last saved design', async t => {
  const f = await fixture(t), p = proposal();
  await f.save(p);
  const file = path.join(f.root, '.governance/architecture-design.json');
  const before = await fs.readFile(file, 'utf8');
  for (const body of [document(p).replace('[a] -- old direction --> [b]', '[a] -- bad --> [missing]'), document(p).replace('Relationships', 'Unrecognized'), document(p).replace('```text', '```html')]) {
    await assert.rejects(f.save({ ...p, document: body }), /ASCII/);
    assert.equal(await fs.readFile(file, 'utf8'), before);
  }
});
test('ASCII literal escapes round-trip Chinese, arrows, newlines and literal unicode escapes distinctly', () => {
  const p = proposal();
  p.nodes[0].title = '字面 \\u000a 与换行\n`<>';
  p.edges[0].label = 'label \\u003c\n --> [b]';
  const parsed = parseArchitectureAscii(architectureAscii(p));
  assert.deepEqual(parsed.nodes.map(n => n.title), p.nodes.map(n => n.title));
  assert.deepEqual(parsed.edges, p.edges);
});
test('large pre-ASCII baselines remain readable without changing stored fingerprints or document limits', async t => {
  const f = await fixture(t), p = proposal();
  p.nodes = Array.from({ length: 40 }, (_, i) => ({ ...node('n' + i), title: 'x'.repeat(100) }));
  p.edges = [];
  for (let from = 0; from < 40 && p.edges.length < 100; from++) for (let to = 0; to < 40 && p.edges.length < 100; to++) {
    if (from !== to) p.edges.push({ from: 'n' + from, to: 'n' + to, label: 'y'.repeat(100) });
  }
  const fingerprint = require('node:crypto').createHash('sha256').update(JSON.stringify(p)).digest('hex');
  const baseline = { number: 1, baseVersion: 0, taskId: 'ascii', reason: 'Legacy', proposal: p, proposalFingerprint: fingerprint, method: 'human', reviewer: 'Historical', conclusion: 'Recorded', confirmedAt: '2020-01-01T00:00:00Z' };
  const file = path.join(f.root, '.governance/architecture-design.json');
  const raw = JSON.stringify({ version: 1, history: [baseline], draft: null, updatedAt: baseline.confirmedAt });
  await fs.writeFile(file, raw);
  const s = await f.snapshot();
  assert.equal(s.error, null);
  assert.ok(s.baseline.ascii.length > 20000);
  assert.equal(s.baseline.graph.nodes.length, 40);
  assert.equal(s.baseline.graph.edges.length, 100);
  assert.equal(s.baseline.proposalFingerprint, fingerprint);
  assert.equal(await fs.readFile(file, 'utf8'), raw);
});
test('explicit empty relationships parse, missing relationship content and oversized new ASCII reject', () => {
  const p = proposal(); p.edges = [];
  const ascii = architectureAscii(p);
  assert.deepEqual(parseArchitectureAscii(ascii).edges, []);
  assert.throws(() => parseArchitectureAscii(ascii.replace('(none)', '')), /ASCII/);
  assert.throws(() => parseArchitectureAscii('x'.repeat(20001)), /ASCII budget/);
});
