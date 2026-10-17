'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { fixture } = require('./pi-fixture.cjs');
const safe = reply => assert.doesNotMatch(JSON.stringify(reply), /#[a-f0-9]{64}|"(?:url|origin|token)"/);
test('launcher and docked entry expose only safe status and an explicit version-bound open', async t => {
  const f = await fixture(t), invoke = f.adapter.onPanelInvoke;
  const before = await fs.readFile(f.b + '/STATE.json', 'utf8');
  const status = await invoke('governance.entry', { action: 'status' });
  assert.equal(status.ok, true); assert.equal(status.result.workspace, f.b); assert.equal(status.result.open, false); safe(status);
  assert.equal(f.opened.length, 0); assert.equal(f.calls.length, 0, 'Entry uses visible host project, never private session discovery');
  const revision = status.result.revision;
  for (const payload of [null, [], {}, { action: 'close', confirmed: true }, { action: 'open', revision },
    { action: 'open', confirmed: true }, { action: 'open', confirmed: true, revision: '0'.repeat(64) },
    { action: 'open', confirmed: true, revision, workspace: f.a }, { action: 'open', confirmed: true, revision, url: 'https://example.invalid' },
    { action: 'status', args: { action: 'init' } }]) {
    const answer = await invoke('governance.entry', payload); assert.equal(answer.ok, false); safe(answer);
  }
  for (const channel of ['governance.operation', 'governance.mutate', 'governance.snapshot', 'shell.openExternal', 'governance.entry.open'])
    assert.equal((await invoke(channel, { action: 'open', confirmed: true, revision })).ok, false);
  assert.equal(f.opened.length, 0);
  const opened = await invoke('governance.entry', { action: 'open', confirmed: true, revision });
  assert.equal(opened.ok, true); assert.equal(opened.result.open, true); safe(opened);
  assert.equal(f.opened.length, 1); assert.equal(await fs.readFile(f.b + '/STATE.json', 'utf8'), before);
  const again = await invoke('governance.entry', { action: 'open', confirmed: true, revision });
  assert.equal(again.ok, true); assert.equal(f.opened.length, 2); assert.equal(f.opened[0], f.opened[1]);
  assert.equal((await invoke('governance.entry', { action: 'status' })).result.open, true);
});
test('entry rejects stale project/reload revisions, missing identity and in-flight workspace changes', async t => {
  const f = await fixture(t), invoke = f.adapter.onPanelInvoke;
  const first = await invoke('governance.entry', { action: 'status' });
  f.pi.workspace.get = async () => ({ path: f.a }); // Even if a host event is delayed, root identity changes the revision.
  assert.equal((await invoke('governance.entry', { action: 'open', confirmed: true, revision: first.result.revision })).ok, false);
  const current = await invoke('governance.entry', { action: 'status' });
  await f.events.get('workspace:changed')();
  assert.equal((await invoke('governance.entry', { action: 'open', confirmed: true, revision: current.result.revision })).ok, false);
  let n = 0;
  f.pi.workspace.get = async () => ({ path: ++n === 1 ? f.a : f.b });
  const stale = await invoke('governance.entry', { action: 'status' });
  assert.equal(stale.ok, false); assert.equal(f.opened.length, 0);
  f.pi.workspace.get = async () => ({ path: f.a });
  const fresh = await invoke('governance.entry', { action: 'status' });
  n = 0; f.pi.workspace.get = async () => ({ path: ++n === 1 ? f.a : f.b });
  assert.equal((await invoke('governance.entry', { action: 'open', confirmed: true, revision: fresh.result.revision })).ok, false);
  assert.equal(f.opened.length, 0);
  for (const value of [null, {}, { path: '.' }]) {
    f.pi.workspace.get = async () => value;
    assert.equal((await invoke('governance.entry', { action: 'status' })).ok, false);
  }
  f.pi.workspace.get = async () => ({ path: f.a });
  const old = await invoke('governance.entry', { action: 'status' });
  await f.adapter.onUnload(); await f.adapter.onLoad();
  assert.equal((await invoke('governance.entry', { action: 'open', confirmed: true, revision: old.result.revision })).ok, false);
  assert.equal(f.opened.length, 0);
});
test('entry sanitizes opener/host failures and never returns a private URL', async t => {
  const f = await fixture(t), invoke = f.adapter.onPanelInvoke;
  let status = await invoke('governance.entry', { action: 'status' });
  f.pi.shell.openExternal = async url => { throw Error('private-url:' + url); };
  const answer = await invoke('governance.entry', { action: 'open', confirmed: true, revision: status.result.revision });
  assert.equal(answer.ok, false); safe(answer); assert.doesNotMatch(JSON.stringify(answer), /private-url/);
  assert.equal((await invoke('governance.entry', { action: 'status' })).result.open, false);
  f.pi.workspace.get = async () => { throw Error('sensitive-host-data'); };
  const error = await invoke('governance.entry', { action: 'status' });
  assert.equal(error.ok, false); assert.doesNotMatch(error.error, /sensitive/);
});
test('manifest declares the same fixed lightweight surface for launcher and official work-panel views', async () => {
  const manifest = JSON.parse(await fs.readFile('plugin/manifest.json', 'utf8'));
  assert.equal(manifest.ui.panel, 'entry/index.html');
  assert.equal(manifest.contributes.views.length, 1); assert.equal(manifest.contributes.views[0].entry, manifest.ui.panel);
  assert.equal(manifest.contributes.views[0].icon, 'browser');
  assert.ok(manifest.permissions.includes('ui.panel') && manifest.permissions.includes('ui.view'));
  const html = await fs.readFile('plugin/' + manifest.ui.panel, 'utf8');
  assert.match(html, /pi-plugin-chrome/); assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /iframe|board-section|architecture|chat|input|https?:\/\//i);
  const script = await fs.readFile('plugin/entry/entry.js', 'utf8');
  assert.doesNotMatch(script, /innerHTML|location\.|window\.open|setInterval|sessionStorage|localStorage/);
  const source = await fs.readFile('plugin/main.ts', 'utf8');
  assert.doesNotMatch(source, /ui\.openPanel|models\.list|agent\/prompt|session\/create/);
});
