'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Governance } = require('../plugin/core');
const { panelInvoke } = require('../plugin/panel');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'project-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const g = new Governance(root);
  await g.run({ action: 'init' });
  const snapshot = () => g.run({ action: 'project_snapshot' });
  const mutate = async (args) => g.run({ ...args, expectedRevision: (await snapshot()).revision });
  return { root, g, snapshot, mutate };
}
test('work items persist, reorder, enforce transitions and never change governance State', async (t) => {
  const { root, g, snapshot, mutate } = await fixture(t);
  await g.run({ action: 'start', id: 'overall', goal: 'Approved', criteria: ['Check'] });
  const before = await fs.readFile(path.join(root, 'STATE.json'), 'utf8');
  for (const id of ['first', 'second']) await mutate({ action: 'board_create', id, title: id });
  await mutate({ action: 'board_move', id: 'second', stage: 'todo', position: 0 });
  assert.deepEqual(
    (await snapshot()).board.items.map((i) => i.id),
    ['second', 'first']
  );
  await assert.rejects(
    mutate({ action: 'board_move', id: 'first', stage: 'done', position: 0 }),
    /adjacent/
  );
  await mutate({ action: 'board_move', id: 'first', stage: 'doing', position: 0 });
  await mutate({ action: 'board_update', id: 'first', title: 'Updated', blocker: 'Needs input' });
  await assert.rejects(
    mutate({ action: 'board_move', id: 'first', stage: 'done', position: 0 }),
    /blocker/
  );
  await mutate({ action: 'board_update', id: 'first', title: 'Updated', blocker: '' });
  await mutate({ action: 'board_move', id: 'first', stage: 'done', position: 0 });
  const reloaded = await new Governance(root).run({ action: 'project_snapshot' });
  assert.equal(reloaded.board.items.find((i) => i.id === 'first').stage, 'done');
  assert.equal(reloaded.board.items[0].taskId, 'overall');
  assert.equal(await fs.readFile(path.join(root, 'STATE.json'), 'utf8'), before);
  await assert.rejects(
    mutate({ action: 'board_update', id: 'first', title: 'Updated', blocker: 'blocked' }),
    /Reopen/
  );
});
test('project writes reject stale revisions, workspace switches, external State edits and invalid items', async (t) => {
  const a = await fixture(t),
    b = await fixture(t);
  const old = await a.snapshot();
  const create = {
    action: 'board_create',
    id: 'item',
    title: 'Item',
    expectedRevision: old.revision
  };
  await assert.rejects(b.g.run(create), /stale|switched/);
  await a.g.run(create);
  await assert.rejects(a.g.run(create), /stale/);
  const revision = (await a.snapshot()).revision;
  await a.g.run({ action: 'start', id: 'new-intent', goal: 'New', criteria: ['Pass'] });
  await assert.rejects(a.g.run({ ...create, id: 'another', expectedRevision: revision }), /stale/);
  await assert.rejects(a.mutate({ action: 'board_create', id: '../bad', title: 'Bad' }), /Invalid/);
  await assert.rejects(
    a.mutate({ action: 'board_move', id: 'item', stage: 'todo', position: 99 }),
    /outside/
  );
  await assert.rejects(
    a.mutate({ action: 'board_move', id: 'item', stage: 'verified', position: 0 }),
    /adjacent/
  );
  assert.equal((await b.snapshot()).board.items.length, 0);
});
test('work-item panel requires confirmation and cannot invoke governance or Git mutations', async (t) => {
  const { root, snapshot } = await fixture(t);
  const revision = (await snapshot()).revision;
  const args = { action: 'board_create', id: 'one', title: 'One' };
  await assert.rejects(
    panelInvoke(root, 'governance.workitem', { args, revision, confirmed: false }),
    /确认/
  );
  for (const action of ['close', 'verify', 'git_integrate', 'architecture_set', 'toString']) {
    await assert.rejects(
      panelInvoke(root, 'governance.workitem', { args: { action }, revision, confirmed: true }),
      /not allowed/
    );
  }
  assert.equal((await snapshot()).board.items.length, 0);
  await panelInvoke(root, 'governance.workitem', { args, revision, confirmed: true });
  assert.equal((await panelInvoke(root, 'governance.project')).board.items[0].id, 'one');
});
test('two projects keep isolated source-backed graphs across update and reload', async (t) => {
  const a = await fixture(t),
    b = await fixture(t);
  for (const [f, title] of [
    [a, 'Project A'],
    [b, 'Project B']
  ] as any[]) {
    assert.equal((await f.snapshot()).architecture, null);
    await fs.writeFile(path.join(f.root, 'app.ts'), `export const name = '${title}';`);
    const sources = await f.g.run({ action: 'architecture_sources', files: ['app.ts'] });
    assert.match(sources.contents['app.ts'], /export const/);
    await f.mutate({
      action: 'architecture_set',
      graph: {
        title,
        source: 'Read app.ts; exported constant only',
        nodes: [{ id: 'app', title, description: 'Exports project name', files: ['app.ts'] }],
        edges: [],
        fingerprints: sources.fingerprints
      }
    });
  }
  assert.equal(
    (await new Governance(a.root).run({ action: 'project_snapshot' })).architecture.title,
    'Project A'
  );
  assert.equal((await b.snapshot()).architecture.title, 'Project B');
  const graph = (await a.snapshot()).architecture;
  await fs.writeFile(path.join(a.root, 'app.ts'), 'export const name = "changed";');
  assert.deepEqual((await a.g.run({ action: 'project_snapshot', checkSources: true })).architecture.staleFiles, ['app.ts']);
  await assert.rejects(a.mutate({ action: 'architecture_set', graph }), /Source changed/);
  graph.fingerprints = (
    await a.g.run({ action: 'architecture_sources', files: ['app.ts'] })
  ).fingerprints;
  graph.title = 'Project A updated';
  await a.mutate({ action: 'architecture_set', graph });
  assert.deepEqual((await a.g.run({ action: 'project_snapshot', checkSources: true })).architecture.staleFiles, []);
  assert.equal((await b.snapshot()).architecture.title, 'Project B');
});
test('invalid graph and unsafe source paths reject; corrupt persisted data is not replaced by a fake graph', async (t) => {
  const { root, g, mutate, snapshot } = await fixture(t);
  for (const file of [
    '../escape',
    '.env',
    '.git/config',
    'secret.key',
    'STATE.json',
    '.governance/board.json'
  ]) {
    await assert.rejects(g.run({ action: 'architecture_sources', files: [file] }));
  }
  await assert.rejects(
    mutate({
      action: 'architecture_set',
      graph: { title: 'Bad', source: 'Uninspected', nodes: [], edges: [], fingerprints: {} }
    }),
    /nodes/
  );
  await fs.mkdir(path.join(root, '.governance'), { recursive: true });
  await fs.writeFile(path.join(root, '.governance', 'architecture.json'), '{invalid');
  await fs.writeFile(path.join(root, '.governance', 'board.json'), '{invalid');
  const result = await snapshot();
  assert.equal(result.architecture, null);
  assert.ok(result.architectureError);
  assert.equal(result.board, null);
  assert.ok(result.boardError);
  await assert.rejects(mutate({ action: 'board_create', id: 'one', title: 'One' }));
});
test('oversized UTF-8 board write is rejected without corrupting saved data', async (t) => {
  const { root, snapshot, mutate } = await fixture(t);
  let rejected = false;
  for (let i = 0; i < 100; i++) {
    const before = await snapshot();
    try {
      await mutate({
        action: 'board_create',
        id: `large-${i}`,
        title: 'Large',
        description: '中'.repeat(4000)
      });
    } catch (error) {
      assert.match(error.message, /exceeds 1 MiB/);
      rejected = true;
      assert.deepEqual((await snapshot()).board, before.board);
      assert.ok((await fs.stat(path.join(root, '.governance/board.json'))).size <= 1024 * 1024);
      break;
    }
  }
  assert.equal(rejected, true);
});

test('three stages complete directly without acceptance actions and do not change State', async t => {
  const f = await fixture(t);
  await f.g.run({ action: 'start', id: 'three-stages', goal: 'Documented feature', criteria: ['Tests pass'] });
  const state = await fs.readFile(path.join(f.root, 'STATE.json'), 'utf8');
  await f.mutate({ action: 'board_create', id: 'one', title: 'Implement documented feature', criteria: ['Actual checks'] });
  await f.mutate({ action: 'board_move', id: 'one', stage: 'doing', position: 0 });
  await f.mutate({ action: 'board_move', id: 'one', stage: 'done', position: 0 });
  assert.equal((await f.snapshot()).board.items[0].stage, 'done');
  const before = await fs.readFile(path.join(f.root, '.governance/board.json'), 'utf8');
  await assert.rejects(f.mutate({ action: 'board_move', id: 'one', stage: 'accepted', position: 0 }), /adjacent|stage/i);
  await assert.rejects(f.mutate({ action: 'board_accept', id: 'one' }), /Unknown/);
  await assert.rejects(panelInvoke(f.root, 'governance.workitem', { confirmed: true, revision: (await f.snapshot()).revision, args: { action: 'board_accept', id: 'one' } }), /not allowed/);
  assert.equal(await fs.readFile(path.join(f.root, '.governance/board.json'), 'utf8'), before);
  await f.mutate({ action: 'board_move', id: 'one', stage: 'doing', position: 0 });
  await f.mutate({ action: 'board_move', id: 'one', stage: 'done', position: 0 });
  assert.equal(await fs.readFile(path.join(f.root, 'STATE.json'), 'utf8'), state);
});
async function seedLegacy(f, ids) {
  for (const id of ids) await f.mutate({ action: 'board_create', id, title: id });
  const file = path.join(f.root, '.governance/board.json');
  const board = JSON.parse(await fs.readFile(file, 'utf8'));
  const items = (await f.snapshot()).board.items;
  for (const item of board.items) if (ids.includes(item.id)) {
    item.stage = 'accepted';
    item.acceptance = { method: 'human', passed: true, valid: true, accepted: [], reviewer: 'Historical fixture', conclusion: 'Old review only', evidence: 'Preserved old fixture, not a current check', itemFingerprint: items.find(i => i.id === item.id).itemFingerprint, at: new Date().toISOString() };
  }
  await fs.writeFile(file, JSON.stringify(board));
  return { file, board };
}
test('legacy accepted items render completed without writes or loss and only targeted items normalize', async t => {
  const f = await fixture(t);
  const { file, board } = await seedLegacy(f, ['old-a', 'old-b']);
  const raw = await fs.readFile(file, 'utf8');
  const s = await f.snapshot();
  assert.deepEqual(s.board.items.map(i => i.stage), ['done', 'done']);
  assert.deepEqual(s.board.items.map(i => i.legacyStage), ['accepted', 'accepted']);
  assert.deepEqual(s.board.items[0].acceptance, board.items[0].acceptance);
  assert.equal(await fs.readFile(file, 'utf8'), raw);
  await f.mutate({ action: 'board_create', id: 'ordinary', title: 'No migration' });
  let saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(saved.items.slice(0,2), board.items);
  await f.mutate({ action: 'board_move', id: 'old-a', stage: 'doing', position: 0 });
  saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(saved.items.find(i => i.id === 'old-b'), board.items[1]);
  assert.equal(saved.items.find(i => i.id === 'old-a').acceptance.evidence, board.items[0].acceptance.evidence);
  assert.equal(saved.items.find(i => i.id === 'old-a').acceptance.valid, false);
  await f.mutate({ action: 'board_move', id: 'old-a', stage: 'done', position: 1 });
  assert.equal((await f.snapshot()).board.items.filter(i => i.stage === 'done').length, 2);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).items.find(i => i.id === 'old-b').stage, 'accepted');
});
test('legacy edits invalidate old checks without adding a review stage and enforce normal revision guards', async t => {
  const f = await fixture(t), foreign = await fixture(t);
  const { file } = await seedLegacy(f, ['old']);
  const old = await f.snapshot();
  await assert.rejects(foreign.g.run({ action: 'board_move', id: 'old', stage: 'doing', position: 0, expectedRevision: old.revision }), /stale|switched/);
  await f.mutate({ action: 'board_update', id: 'old', title: 'Updated' });
  const item = (await f.snapshot()).board.items[0];
  assert.equal(item.stage, 'done'); assert.equal(item.acceptance.valid, false);
  await assert.rejects(f.g.run({ action: 'board_move', id: 'old', stage: 'doing', position: 0, expectedRevision: old.revision }), /stale/);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).items[0].stage, 'done');
});
test('architecture impact is optional, validated and preserved without requiring a separate review', async t => {
  const f = await fixture(t);
  await f.mutate({ action: 'board_create', id: 'one', title: 'One', architectureImpact: 'affects' });
  await f.mutate({ action: 'board_update', id: 'one', title: 'One' });
  assert.equal((await f.snapshot()).board.items[0].architectureImpact, 'affects');
  await assert.rejects(f.mutate({ action: 'board_update', id: 'one', title: 'One', architectureImpact: 'arbitrary' }), /architecture impact/i);
  await f.mutate({ action: 'board_move', id: 'one', stage: 'doing', position: 0 });
  await f.mutate({ action: 'board_move', id: 'one', stage: 'done', position: 0 });
  await f.mutate({ action: 'board_update', id: 'one', title: 'One', architectureImpact: 'none' });
  assert.equal((await f.snapshot()).board.items[0].stage, 'done');
  assert.equal((await f.snapshot()).architecture, null);
});

test('architecture snapshots do not scan source until explicitly requested', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'entry.ts'), 'export const x = 1;');
  const sources = await f.g.run({ action: 'architecture_sources', files: ['entry.ts'] });
  await f.mutate({ action: 'architecture_set', graph: { title: 'Core', source: 'Read entry',
    nodes: [{ id: 'entry', title: 'Entry', description: 'Core entry', files: ['entry.ts'] }], edges: [], fingerprints: sources.fingerprints } });
  const raw = await fs.readFile(path.join(f.root, '.governance/architecture.json'), 'utf8');
  await fs.writeFile(path.join(f.root, 'entry.ts'), 'export const x = 2;');
  const read = f.g.read.bind(f.g);
  let reads = 0;
  f.g.read = async (file) => { if (file === 'entry.ts') reads++; return read(file); };
  const passive = await f.snapshot();
  assert.equal(reads, 0);
  assert.equal(passive.architecture.sourcesChecked, false);
  const checked = await f.g.run({ action: 'project_snapshot', checkSources: true });
  assert.equal(reads, 1);
  assert.equal(checked.architecture.sourcesChecked, true);
  assert.deepEqual(checked.architecture.staleFiles, ['entry.ts']);
  assert.equal(await fs.readFile(path.join(f.root, '.governance/architecture.json'), 'utf8'), raw);
  await assert.rejects(f.mutate({ action: 'architecture_set', graph: checked.architecture }), /Source changed/);
});

test('persisted boards reject non-record roots, items and acceptance without replacing data', async (t) => {
  const f = await fixture(t);
  await f.mutate({ action: 'board_create', id: 'one', title: 'One' });
  const file = path.join(f.root, '.governance/board.json');
  const board = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const entry of [null, false, 42, 'bad', []]) {
    const cases = [
      [entry, 'Invalid board schema'],
      [{ ...board, items: [entry] }, 'Invalid board item'],
      ...(entry === null ? [] : [[{ ...board, items: [{ ...board.items[0], acceptance: entry }] }, 'Invalid acceptance record']])
    ];
    for (const [value, message] of cases) {
      const raw = JSON.stringify(value);
      await fs.writeFile(file, raw);
      const snapshot = await f.snapshot();
      assert.equal(snapshot.board, null);
      assert.equal(snapshot.boardError, message);
      await assert.rejects(f.g.run({ action: 'board_create', id: 'two', title: 'Two', expectedRevision: snapshot.revision }), (error) => {
        assert.equal(error instanceof TypeError, false);
        assert.equal(error.message, message);
        return true;
      });
      assert.equal(await fs.readFile(file, 'utf8'), raw);
    }
  }
});

test('persisted architecture rejects non-record roots, nodes and edges with domain errors', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'app.ts'), 'export const app = 1;');
  const sources = await f.g.run({ action: 'architecture_sources', files: ['app.ts'] });
  const graph = {
    version: 1, updatedAt: new Date().toISOString(), title: 'App', source: 'Read app.ts',
    nodes: [{ id: 'app', title: 'App', description: 'Entry', files: ['app.ts'] }],
    edges: [], fingerprints: sources.fingerprints
  };
  const file = path.join(f.root, '.governance/architecture.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (const entry of [null, false, 42, 'bad', []]) {
    for (const [value, message] of [
      [entry, 'Invalid architecture schema'],
      [{ ...graph, nodes: [entry] }, 'Invalid or duplicate graph node'],
      [{ ...graph, edges: [entry] }, 'Invalid or duplicate graph edge'],
      [{ ...graph, fingerprints: entry }, 'Source fingerprints required; call architecture_sources first']
    ]) {
      const raw = JSON.stringify(value);
      await fs.writeFile(file, raw);
      const snapshot = await f.snapshot();
      assert.equal(snapshot.architecture, null);
      assert.equal(snapshot.architectureError, message);
      assert.equal(await fs.readFile(file, 'utf8'), raw);
    }
  }
});
