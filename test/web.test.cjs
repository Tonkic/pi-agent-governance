'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { startConsole, workspacePath } = require('../build/web/server');
const { Governance } = require('../build/plugin/core');
async function fixture(t) {
  const root = require('node:fs').realpathSync.native(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'console-')));
  const app = await startConsole({ workspace: root });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); });
  const token = app.url.split('#')[1];
  const post = (channel, payload = {}, headers = {}) => fetch(app.origin + '/api/invoke', { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json', 'X-Governance-Token': token, ...headers }, body: JSON.stringify({ channel, payload }) });
  const value = async (channel, payload) => { const response = await post(channel, payload); const result = await response.json(); assert.equal(response.status, 200, result.error); return result.result; };
  return { root, app, token, post, value, g: new Governance(root) };
}
test('console binds only an explicit existing non-linked directory and serves no workspace or secret assets', async t => {
  const f = await fixture(t);
  for (const workspace of ['', '.', path.join(f.root, 'missing')]) await assert.rejects(workspacePath(workspace));
  const alias = path.join(f.root, 'alias'); await fs.symlink(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(workspacePath(alias), /Linked/); await fs.rm(alias);
  await assert.rejects(startConsole({ workspace: f.root, port: -1 }));
  const page = await fetch(f.app.origin + '/panel/'), html = await page.text();
  assert.equal(page.status, 200); assert.match(html, /data-local-console/); assert.ok(html.indexOf('/console/bridge.js') < html.indexOf('../runtime/renderer/i18n.js'));
  assert.ok(!html.includes(f.token)); assert.ok(!html.includes(f.root));
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer'); assert.equal(page.headers.get('cache-control'), 'no-store');
  for (const resource of ['/STATE.json', '/.git/config', '/.env', '/panel/index.html', '/console/../STATE.json', '/%2e%2e/STATE.json', '/panel/?token=x']) assert.equal((await fetch(f.app.origin + resource)).status, 404, resource);
  assert.deepEqual(await fs.readdir(f.root), []);
});
test('HTTP rejects absent/wrong credentials, Host rebinding, foreign/null Origin, cross-site metadata and malformed inputs before mutation', async t => {
  const f = await fixture(t);
  for (const headers of [{ 'X-Governance-Token': '' }, { 'X-Governance-Token': 'b'.repeat(64) }, { Origin: 'null' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Content-Type': 'text/plain' }]) assert.equal((await f.post('governance.snapshot', {}, headers)).status, 403);
  const host = await new Promise((resolve, reject) => { const req = http.get(f.app.origin + '/panel/', { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
  assert.equal(host, 403);
  assert.equal((await fetch(f.app.origin + '/api/invoke')).status, 405);
  for (const [channel, payload] of [['governance.operation', { action: 'start' }], ['desktop.control', {}], ['governance.mutate', { args: { action: 'git_commit' }, confirmed: true }], ['governance.design', { action: 'constructor', confirmed: true }]]) assert.equal((await f.post(channel, payload)).status, 400);
  const headers = { Origin: f.app.origin, 'Content-Type': 'application/json', 'X-Governance-Token': f.token };
  for (const body of ['null', '[]', '{', JSON.stringify({ channel: 'governance.snapshot', workspace: 'foreign' })]) assert.ok((await fetch(f.app.origin + '/api/invoke', { method: 'POST', headers, body })).status >= 400);
  assert.equal((await fetch(f.app.origin + '/api/invoke', { method: 'POST', headers, body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
  assert.equal((await f.post('governance.snapshot', { workspace: 'foreign' })).status, 409);
  assert.deepEqual(await fs.readdir(f.root), []);
});
test('browser rejects all project writes while real MCP updates remain readable', async t => {
  const f = await fixture(t);
  const state = await f.value('governance.snapshot'); assert.equal(state.state, null);
  for (const action of ['init', 'start', 'progress', 'verify', 'close'])
    assert.equal((await f.post('governance.mutate', { args: { action }, revision: state.revision, confirmed: true })).status, 400, action);
  assert.deepEqual(await fs.readdir(f.root), [], 'Even confirmed initialization is denied before core dispatch');
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'readonly-shared-fixture', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('build/mcp/server.js'), '--workspace', f.root], stderr: 'pipe' }));
  const mcp = async args => { const result = await client.callTool({ name: 'governance', arguments: args }); assert.ok(!result.isError); return JSON.parse(result.content[0].text); };
  await mcp({ action: 'init' });
  await mcp({ action: 'start', id: 'approved', goal: 'Original AI client owns changes', criteria: ['Actual test'] });
  let project = await mcp({ action: 'project_snapshot' });
  await mcp({ action: 'board_create', id: 'from-mcp', title: 'From MCP', expectedRevision: project.revision });
  project = await f.value('governance.project'); assert.equal(project.board.items[0].id, 'from-mcp');
  let design = await mcp({ action: 'architecture_design_snapshot' });
  await mcp({ action: 'architecture_design_begin', reason: 'Explicit host request', expectedRevision: design.revision });
  design = await mcp({ action: 'architecture_design_snapshot' });
  await mcp({ action: 'architecture_design_save', expectedRevision: design.revision, expectedDraft: design.draft.draftId, proposal: { title: 'MCP proposal', document: 'Intent only', nodes: [{ id: 'app', title: 'App', description: 'Planned module', files: [] }], edges: [] } });
  design = await f.value('governance.design', { action: 'snapshot' }); assert.equal(design.draft.proposal.title, 'MCP proposal');
  const files = ['STATE.json', '.governance/board.json', '.governance/architecture-design.json'];
  const before = await Promise.all(files.map(file => fs.readFile(path.join(f.root, file), 'utf8')));
  for (const action of ['board_create', 'board_update', 'board_move'])
    for (const confirmed of [false, true]) assert.equal((await f.post('governance.workitem', { args: { action, id: 'from-mcp', title: 'Forbidden', stage: 'done', position: 0 }, revision: project.revision, confirmed })).status, 400);
  for (const action of ['begin', 'save', 'confirm', 'discard'])
    for (const confirmed of [false, true]) assert.equal((await f.post('governance.design', { action, revision: design.revision, confirmed, expectedProposal: design.draft.proposalFingerprint, reviewer: 'Human', conclusion: 'Not a browser action' })).status, 400);
  assert.deepEqual(await Promise.all(files.map(file => fs.readFile(path.join(f.root, file), 'utf8'))), before);
  await mcp({ action: 'board_update', id: 'from-mcp', title: 'Updated in original client', expectedRevision: project.revision });
  assert.equal((await f.value('governance.project')).board.items[0].title, 'Updated in original client');
});
test('lease requests share the eight-request body budget and old incomplete requests cannot invoke after close', async t => {
  const f = await fixture(t), requests = [];
  t.after(() => requests.forEach(req => req.destroy()));
  const headers = { Origin: f.app.origin, 'Content-Type': 'application/json', 'X-Governance-Token': f.token, 'Content-Length': '1000' };
  for (let n = 0; n < 8; n++) {
    const req = http.request(f.app.origin + '/api/invoke', { method: 'POST', headers });
    req.on('error', () => {}); req.write('{'); requests.push(req);
  }
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal((await f.post('governance.lease', { id: 'a'.repeat(32), event: 'join' })).status, 429);
  for (const req of requests) req.destroy();
  await new Promise(resolve => setTimeout(resolve, 30));
  const body = JSON.stringify({ channel: 'governance.snapshot', payload: {} });
  let req;
  const response = new Promise((resolve, reject) => {
    req = http.request(f.app.origin + '/api/invoke', { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.write(body.slice(0, -1));
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  const closed = f.app.close(); req.end(body.slice(-1));
  assert.equal(await response, 403); await closed;
  assert.deepEqual(await fs.readdir(f.root), []);
});

test('behavior read budget has a safe actionable message, not a write-confirmation diagnostic', async t => {
  const f = await fixture(t); await f.g.run({ action: 'init' });
  await f.g.write('docs/behavior.md', '### WS-001 — Read budget\n\nReadonly behavior.\n');
  await f.g.write('docs/behavior-bindings.json', JSON.stringify({ version: 1, behaviors: [{ id: 'WS-001', document: 'docs/behavior.md', cases: ['budget-case'], files: ['src/example.ts'] }] }));
  await f.g.write('src/example.ts', 'x'.repeat(500001));
  const response = await f.post('governance.behaviors'); const result = await response.json();
  assert.equal(response.status, 409); assert.equal(result.ok, false); assert.match(result.error, /500000/); assert.doesNotMatch(result.error, /Operation rejected|current revision/);
  assert.ok(!result.error.includes(f.root) && !result.error.includes(f.token) && !result.error.includes('src/example.ts'));
});

test('Git history HTTP is readonly, strictly allowlisted and works without project initialization', async t => {
  const f = await fixture(t), { execFileSync } = require('node:child_process');
  const git = (...args) => execFileSync('git', args, { cwd: f.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const absent = await f.value('governance.gitHistory', { action: 'list' }); assert.equal(absent.status, 'not-repository'); assert.deepEqual(await fs.readdir(f.root), []);
  git('init', '-b', 'main');
  const empty = await f.value('governance.gitHistory', { action: 'list' }); assert.equal(empty.status, 'empty'); assert.equal(empty.workspace, f.root);
  assert.equal((await f.value('governance.gitHistory', { action: 'list', workspace: f.root })).revision, empty.revision);
  for (const action of ['merge', 'checkout', 'fetch', 'reset', 'push', 'constructor']) assert.equal((await f.post('governance.gitHistory', { action })).status, 400);
  for (const payload of [{ action: 'list', command: 'status' }, { action: 'detail', sha: '--all', revision: 'a'.repeat(64) }, { action: 'diff', sha: 'a'.repeat(40), path: '../secret', revision: empty.revision }, { action: 'list', offset: 1 }, { action: 'list', workspace: 'foreign' }]) assert.equal((await f.post('governance.gitHistory', payload)).status, 409);
  assert.deepEqual(await fs.readdir(f.root), ['.git']);
  assert.equal((await fetch(f.app.origin + '/runtime/renderer/git-history.js')).status, 200);
});
