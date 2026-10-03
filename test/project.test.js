'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
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
    for (const id of ['first', 'second'])
        await mutate({ action: 'board_create', id, title: id });
    await mutate({ action: 'board_move', id: 'second', stage: 'todo', position: 0 });
    assert.deepEqual((await snapshot()).board.items.map(i => i.id), ['second', 'first']);
    await assert.rejects(mutate({ action: 'board_move', id: 'first', stage: 'done', position: 0 }), /adjacent/);
    await mutate({ action: 'board_move', id: 'first', stage: 'doing', position: 0 });
    await mutate({ action: 'board_update', id: 'first', title: 'Updated', blocker: 'Needs input' });
    await assert.rejects(mutate({ action: 'board_move', id: 'first', stage: 'done', position: 0 }), /blocker/);
    await mutate({ action: 'board_update', id: 'first', title: 'Updated', blocker: '' });
    await mutate({ action: 'board_move', id: 'first', stage: 'done', position: 0 });
    const reloaded = await new Governance(root).run({ action: 'project_snapshot' });
    assert.equal(reloaded.board.items.find(i => i.id === 'first').stage, 'done');
    assert.equal(reloaded.board.items[0].taskId, 'overall');
    assert.equal(await fs.readFile(path.join(root, 'STATE.json'), 'utf8'), before);
    await assert.rejects(mutate({ action: 'board_update', id: 'first', title: 'Updated', blocker: 'blocked' }), /Reopen/);
});
test('project writes reject stale revisions, workspace switches, external State edits and invalid items', async (t) => {
    const a = await fixture(t), b = await fixture(t);
    const old = await a.snapshot();
    const create = { action: 'board_create', id: 'item', title: 'Item', expectedRevision: old.revision };
    await assert.rejects(b.g.run(create), /stale|switched/);
    await a.g.run(create);
    await assert.rejects(a.g.run(create), /stale/);
    const revision = (await a.snapshot()).revision;
    await a.g.run({ action: 'start', id: 'new-intent', goal: 'New', criteria: ['Pass'] });
    await assert.rejects(a.g.run({ ...create, id: 'another', expectedRevision: revision }), /stale/);
    await assert.rejects(a.mutate({ action: 'board_create', id: '../bad', title: 'Bad' }), /Invalid/);
    await assert.rejects(a.mutate({ action: 'board_move', id: 'item', stage: 'todo', position: 99 }), /outside/);
    await assert.rejects(a.mutate({ action: 'board_move', id: 'item', stage: 'verified', position: 0 }), /adjacent/);
    assert.equal((await b.snapshot()).board.items.length, 0);
});
test('work-item panel requires confirmation and cannot invoke governance or Git mutations', async (t) => {
    const { root, snapshot } = await fixture(t);
    const revision = (await snapshot()).revision;
    const args = { action: 'board_create', id: 'one', title: 'One' };
    await assert.rejects(panelInvoke(root, 'governance.workitem', { args, revision, confirmed: false }), /确认/);
    for (const action of ['close', 'verify', 'git_integrate', 'architecture_set', 'toString']) {
        await assert.rejects(panelInvoke(root, 'governance.workitem', { args: { action }, revision, confirmed: true }), /not allowed/);
    }
    assert.equal((await snapshot()).board.items.length, 0);
    await panelInvoke(root, 'governance.workitem', { args, revision, confirmed: true });
    assert.equal((await panelInvoke(root, 'governance.project')).board.items[0].id, 'one');
});
test('two projects keep isolated source-backed graphs across update and reload', async (t) => {
    const a = await fixture(t), b = await fixture(t);
    for (const [f, title] of [[a, 'Project A'], [b, 'Project B']]) {
        assert.equal((await f.snapshot()).architecture, null);
        await fs.writeFile(path.join(f.root, 'app.ts'), `export const name = '${title}';`);
        const sources = await f.g.run({ action: 'architecture_sources', files: ['app.ts'] });
        assert.match(sources.contents['app.ts'], /export const/);
        await f.mutate({ action: 'architecture_set', graph: { title, source: 'Read app.ts; exported constant only', nodes: [{ id: 'app', title, description: 'Exports project name', files: ['app.ts'] }], edges: [], fingerprints: sources.fingerprints } });
    }
    assert.equal((await new Governance(a.root).run({ action: 'project_snapshot' })).architecture.title, 'Project A');
    assert.equal((await b.snapshot()).architecture.title, 'Project B');
    const graph = (await a.snapshot()).architecture;
    await fs.writeFile(path.join(a.root, 'app.ts'), 'export const name = "changed";');
    assert.deepEqual((await a.snapshot()).architecture.staleFiles, ['app.ts']);
    await assert.rejects(a.mutate({ action: 'architecture_set', graph }), /Source changed/);
    graph.fingerprints = (await a.g.run({ action: 'architecture_sources', files: ['app.ts'] })).fingerprints;
    graph.title = 'Project A updated';
    await a.mutate({ action: 'architecture_set', graph });
    assert.deepEqual((await a.snapshot()).architecture.staleFiles, []);
    assert.equal((await b.snapshot()).architecture.title, 'Project B');
});
test('invalid graph and unsafe source paths reject; corrupt persisted data is not replaced by a fake graph', async (t) => {
    const { root, g, mutate, snapshot } = await fixture(t);
    for (const file of ['../escape', '.env', '.git/config', 'secret.key', 'STATE.json', '.governance/board.json']) {
        await assert.rejects(g.run({ action: 'architecture_sources', files: [file] }));
    }
    await assert.rejects(mutate({ action: 'architecture_set', graph: { title: 'Bad', source: 'Uninspected', nodes: [], edges: [], fingerprints: {} } }), /nodes/);
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
