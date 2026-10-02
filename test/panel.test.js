'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { panelInvoke } = require('../plugin/panel');
async function fixture(t) {
    const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'panel-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const snapshot = () => panelInvoke(root, 'governance.snapshot');
    const mutate = async (args, revision) => panelInvoke(root, 'governance.mutate', { args, revision: revision || (await snapshot()).revision, confirmed: true });
    return { root, snapshot, mutate };
}
const start = { action: 'start', id: 'panel-task', goal: 'Human approved goal', criteria: ['Pass'], scope: ['src/'], constraints: ['No push'] };
test('panel initializes, starts and updates using the existing core', async (t) => {
    const { root, snapshot, mutate } = await fixture(t);
    await fs.writeFile(path.join(root, 'README.md'), 'User content');
    assert.equal((await snapshot()).state, null);
    await mutate({ action: 'init' });
    assert.equal((await snapshot()).state.status, 'idle');
    assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), 'User content');
    await mutate(start);
    await mutate({ action: 'progress', current: 'Done one step', next: ['Test'], blocked: [] });
    const s = (await snapshot()).state;
    assert.equal(s.current, 'Done one step');
    assert.deepEqual(s.next, ['Test']);
    assert.deepEqual(s.constraints, ['No push']);
});
test('stale state and switched workspace cannot be overwritten', async (t) => {
    const a = await fixture(t), b = await fixture(t);
    await a.mutate({ action: 'init' });
    await b.mutate({ action: 'init' });
    const old = await a.snapshot();
    await assert.rejects(b.mutate(start, old.revision), /过期|切换/);
    await a.mutate(start);
    await assert.rejects(a.mutate({ action: 'progress', current: 'stale', next: [], blocked: [] }, old.revision), /过期/);
    assert.equal((await a.snapshot()).state.current, start.goal);
});
test('panel refuses unconfirmed, unsupported and malformed operations', async (t) => {
    const { root, snapshot, mutate } = await fixture(t);
    const s = await snapshot();
    await assert.rejects(panelInvoke(root, 'governance.mutate', { args: { action: 'init' }, revision: s.revision }), /确认/);
    await assert.rejects(panelInvoke(root, 'governance.mutate', { confirmed: true, args: { action: 'init' } }), /刷新/);
    await assert.rejects(mutate({ action: 'git_commit' }), /not allowed/);
    await assert.rejects(mutate({ action: 'toString' }), /not allowed/);
    await assert.rejects(panelInvoke(root, 'arbitrary.channel'), /Unsupported/);
    await mutate({ action: 'init' });
    await assert.rejects(mutate({ ...start, criteria: [] }), /criteria/);
    assert.equal((await snapshot()).state.task, null);
});
test('malformed State is an error, not an initialization opportunity', async (t) => {
    const { root, snapshot } = await fixture(t);
    await fs.writeFile(path.join(root, 'STATE.json'), '{invalid');
    await assert.rejects(snapshot(), SyntaxError);
    await assert.rejects(panelInvoke(root, 'governance.git'), /git rev-parse failed/);
});
test('panel progress invalidates existing verification', async (t) => {
    const { root, snapshot, mutate } = await fixture(t);
    await mutate({ action: 'init' });
    await mutate(start);
    const { Governance } = require('../plugin/core');
    await new Governance(root).run({ action: 'verify', passed: true, accepted: [true], evidence: 'Fixture checked', diffReview: 'Fixture checked', files: ['README.md'] });
    assert.equal((await snapshot()).state.status, 'verified');
    await mutate({ action: 'progress', current: 'Continue', next: [], blocked: [] });
    assert.equal((await snapshot()).state.status, 'working');
    assert.equal((await snapshot()).state.verification, undefined);
});
