'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { startConsole } = require('../build/web/server');
const { panelInvoke } = require('../build/plugin/panel');
test('document HTTP channel is authenticated, fixed-project, strictly read-only and narrowly allowlisted', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'reader-http-')));
  const other = await fs.realpath(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'reader-other-')));
  let app;
  try {
    await fs.mkdir(path.join(root, 'docs'));
    await fs.writeFile(path.join(root, 'README.md'), '# Root guide\n');
    await fs.writeFile(path.join(root, 'docs', 'guide.md'), '# Read only\n中文\n');
    await fs.writeFile(path.join(root, 'docs', 'credentials.md'), 'PRIVATE FIXTURE');
    await fs.writeFile(path.join(other, 'README.md'), 'OTHER PROJECT');
    app = await startConsole({ workspace: root });
    const token = new URL(app.url).hash.slice(1);
    const call = (payload, options = {}) => fetch(app.origin + '/api/invoke', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.origin, 'X-Governance-Token': token, ...options.headers }, body: JSON.stringify({ channel: 'governance.documents', payload }) });
    const before = await fs.readdir(root);
    for (const action of ['list', 'read']) assert.equal((await call({ action, path: 'README.md' }, { headers: { 'X-Governance-Token': '' } })).status, 403);
    assert.equal((await call({ action: 'list' }, { headers: { Origin: 'https://foreign.invalid' } })).status, 403);
    const result = await (await call({ action: 'list', workspace: root })).json();
    assert.equal(result.ok, true); assert.equal(result.result.workspace, root);
    assert.deepEqual(result.result.files.map(f => f.path), ['README.md', 'docs/guide.md']);
    const read = await (await call({ action: 'read', path: 'docs/guide.md', workspace: root })).json();
    assert.equal(read.ok, true); assert.equal(read.result.content, '# Read only\n中文\n');
    for (const payload of [{ action: 'write', path: 'README.md', content: 'bad' }, { action: 'read', path: '../README.md' }, { action: 'read', path: 'docs/credentials.md' }, { action: 'list', workspace: other }, { action: 'list', command: 'test' }, { action: 'read', path: 'STATE.json' }, { action: 'read', path: path.join(other, 'README.md') }, { action: 'list', path: 'docs' }]) {
      const response = await call(payload), value = await response.json();
      assert.equal(value.ok, false); assert.ok(!JSON.stringify(value).includes('PRIVATE FIXTURE')); assert.ok(!JSON.stringify(value).includes('OTHER PROJECT'));
    }
    const direct = await panelInvoke(root, 'governance.documents', { action: 'read', path: 'README.md' });
    assert.equal(direct.content, '# Root guide\n');
    assert.deepEqual(await fs.readdir(root), before, 'No STATE, lock, cache or initialization writes');
    assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), '# Root guide\n');
    assert.equal((await fetch(app.origin + '/docs/guide.md')).status, 404);
    assert.equal((await fetch(app.origin + '/runtime/renderer/documents.js')).status, 200);
    assert.equal((await fetch(app.origin + '/panel/documents.css')).status, 200);
  } finally { await app?.close(); await fs.rm(root, { recursive: true, force: true }); await fs.rm(other, { recursive: true, force: true }); }
});
