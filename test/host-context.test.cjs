'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture } = require('./pi-fixture.cjs');
const { Governance } = require('../build/plugin/core');
test('PI tool stays in its calling session project when the visible workspace differs', async t => {
  const f = await fixture(t), before = await fs.readFile(path.join(f.b, 'STATE.json'), 'utf8');
  const answer = await f.tool.execute({ action: 'progress', current: 'Changed in original session', next: [], blocked: [] }, { sessionId: 'origin' });
  assert.equal(answer.ok, true, answer.error); assert.equal(answer.result.current, 'Changed in original session');
  assert.equal((await new Governance(f.a).run({ action: 'status' })).current, 'Changed in original session');
  assert.equal(await fs.readFile(path.join(f.b, 'STATE.json'), 'utf8'), before);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].operation, 'session/get');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)), [{ id: 'origin', messageLimit: 1, contentLimit: 1 }]);
  assert.equal(f.adapter.onPanelInvoke, undefined);
  const browser = await f.command().run();
  assert.equal(browser.workspace, f.b); assert.equal(browser.opened, true);
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
test('PI visible workspace must be absolute; never resolve a relative host value through cwd', async t => {
  const f = await fixture(t);
  for (const value of ['.', 'relative-project', '', 42, null, 'invalid\0path']) {
    f.pi.workspace.get = async () => ({ path: value });
    await assert.rejects(f.command().run(), /Open a project/);
  }
  assert.equal(f.opened.length, 0);
  f.session.projectPath = '.';
  assert.equal((await f.tool.execute({ action: 'status' }, { sessionId: 'origin' })).ok, false);
  assert.equal((await f.ui.execute({ action: 'open', confirmed: true }, { sessionId: 'origin' })).ok, false);
});
