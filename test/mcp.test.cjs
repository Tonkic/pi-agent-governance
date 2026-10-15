'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const repo = path.resolve(__dirname, '..');
const server = path.join(repo, 'build/mcp/server.js');
async function fixture(t, entry = server, cwd = repo) {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'mcp-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, '--workspace', root], cwd, stderr: 'pipe' });
  let stderr = '';
  transport.stderr.on('data', b => { stderr += b; });
  const client = new Client({ name: 'actual-sdk-regression', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport, { timeout: 10000 });
  const call = args => client.callTool({ name: 'governance', arguments: args }, undefined, { timeout: 10000 });
  const value = async args => {
    const result = await call(args);
    assert.ok(!result.isError, result.content[0]?.text);
    return JSON.parse(result.content[0].text);
  };
  return { root, client, call, value, stderr: () => stderr };
}

test('real SDK handshake exposes shared schema, no host control and no automatic initialization', async t => {
  const f = await fixture(t);
  assert.equal(f.client.getServerVersion().version, require('../package.json').version);
  assert.deepEqual(Object.keys(f.client.getServerCapabilities()).sort(), ['prompts', 'resources', 'tools']);
  const { tools } = await f.client.listTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'governance');
  assert.deepEqual(tools[0].inputSchema, require('../build/plugin/tool').schema);
  assert.equal(tools[0].annotations.readOnlyHint, false);
  assert.ok(!tools[0].inputSchema.properties.action.enum.some(x => /session|model|accept|confirm/.test(x)));
  assert.deepEqual(await fs.readdir(f.root), []);
  assert.equal((await f.call({ action: 'status' })).isError, true);
  assert.deepEqual(await fs.readdir(f.root), []);
  for (const args of [{ action: 'status', workspace: 'secret-argument' }, { action: 'status', passed: 'yes' }, { action: 'no-such-action' }, {}])
    await assert.rejects(f.call(args), e => !e.message.includes('secret-argument') && /Invalid governance arguments/.test(e.message));
  await assert.rejects(f.client.callTool({ name: 'desktop.control', arguments: {} }), /Invalid governance arguments/);
  assert.deepEqual(await fs.readdir(f.root), []);
  await f.value({ action: 'init' });
  assert.equal((await f.value({ action: 'status' })).status, 'idle');
  assert.equal(f.stderr(), '');
});

test('MCP writes share core revisions, locks, workspace binding and source path protections', async t => {
  const a = await fixture(t), b = await fixture(t);
  await a.value({ action: 'init' });
  await b.value({ action: 'init' });
  await a.value({ action: 'start', id: 'approved', goal: 'Approved fixture only', criteria: ['Actual SDK tests'], scope: ['src/'] });
  await fs.mkdir(path.join(a.root, 'src'));
  await fs.writeFile(path.join(a.root, 'src/app.ts'), 'export const app = 1;\n');
  const before = await fs.readFile(path.join(a.root, 'STATE.json'), 'utf8');
  const revision = (await a.value({ action: 'project_snapshot' })).revision;
  const create = { action: 'board_create', id: 'one', title: 'One', expectedRevision: revision };
  assert.equal((await b.call(create)).isError, true);
  const results = await Promise.all([a.call(create), a.call({ ...create, id: 'two' })]);
  assert.equal(results.filter(x => !x.isError).length, 1);
  assert.equal((await a.call({ ...create, id: 'stale' })).isError, true);
  assert.equal((await b.value({ action: 'project_snapshot' })).board.items.length, 0);
  assert.equal(await fs.readFile(path.join(a.root, 'STATE.json'), 'utf8'), before);
  const sources = await a.value({ action: 'architecture_sources', files: ['src/app.ts'] });
  assert.ok(JSON.stringify(sources).includes('export const app'));
  for (const file of ['../STATE.json', '.env', '.git/config', 'C:/secret', 'src/../../secret'])
    assert.equal((await a.call({ action: 'architecture_sources', files: [file] })).isError, true);
  const snapshot = await a.value({ action: 'project_snapshot' });
  await fs.writeFile(path.join(a.root, '.governance.lock'), 'external lock');
  assert.equal((await a.call({ action: 'board_create', id: 'locked', title: 'Locked', expectedRevision: snapshot.revision })).isError, true);
  await fs.rm(path.join(a.root, '.governance.lock'));
  assert.equal((await a.value({ action: 'project_snapshot' })).board.items.length, 1);
});

test('canonical Skill resources and two prompts are bounded, portable and traversal-proof', async t => {
  const f = await fixture(t);
  const { resources } = await f.client.listResources();
  assert.equal(resources.length, 12);
  const skillUri = 'governance://skills/architecture-copilot/SKILL.md';
  const source = await fs.readFile(path.join(repo, 'plugin/skills/architecture-copilot/SKILL.md'), 'utf8');
  assert.equal((await f.client.readResource({ uri: skillUri })).contents[0].text, source);
  for (const resource of resources) assert.ok((await f.client.readResource({ uri: resource.uri })).contents[0].text.length);
  for (const uri of [skillUri + '/../STATE.json', 'file:///STATE.json', 'governance://skills/architecture-copilot/%2e%2e/STATE.json'])
    await assert.rejects(f.client.readResource({ uri }), /Unknown Skill resource/);
  assert.deepEqual((await f.client.listPrompts()).prompts.map(p => p.name), ['architecture-analysis', 'architecture-design']);
  for (const name of ['architecture-analysis', 'architecture-design']) {
    const prompt = await f.client.getPrompt({ name });
    assert.ok(prompt.messages[0].content.text.endsWith(source));
    assert.match(prompt.messages[0].content.text, /grants no write authorization/);
  }
  await assert.rejects(f.client.getPrompt({ name: 'constructor' }), /Unknown prompt/);
  await assert.rejects(f.client.getPrompt({ name: 'architecture-design', arguments: { workspace: 'another' } }), /unexpected arguments/);
  assert.deepEqual(await fs.readdir(f.root), []);
});

test('startup rejects implicit/relative/extra/file/linked workspaces; EOF and malformed/oversized frames never leak stdout', async t => {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'mcp-wire-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'file');
  await fs.writeFile(file, 'fixture');
  const link = path.join(root, 'linked');
  await fs.symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir');
  for (const args of [[], ['--workspace', '.'], ['--workspace', root, '--other', 'secret'], ['--workspace', file], ['--workspace', link]]) {
    const run = spawnSync(process.execPath, [server, ...args], { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 1, run.stderr);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /MCP startup failed/);
    assert.ok(!run.stderr.includes('secret'));
  }
  const eof = spawnSync(process.execPath, [server, '--workspace', root], { input: '', encoding: 'utf8', timeout: 10000 });
  assert.equal(eof.status, 0, eof.stderr);
  assert.equal(eof.stdout, '');
  const bad = spawnSync(process.execPath, [server, '--workspace', root], { input: 'not-json-secret\n', encoding: 'utf8', timeout: 10000 });
  assert.equal(bad.status, 0, bad.stderr);
  assert.equal(bad.stdout, '');
  assert.ok(!bad.stderr.includes('not-json-secret'));
  const large = spawnSync(process.execPath, [server, '--workspace', root], { input: 'x'.repeat(1024 * 1024 + 1), encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(large.status, 0, large.stderr);
  assert.equal(large.stdout, '');
  assert.match(large.stderr, /content omitted/);
});

test('MCP source fingerprints and design draft identity remain separate shared-core protections', async t => {
  const f = await fixture(t);
  await f.value({ action: 'init' });
  await f.value({ action: 'start', id: 'architecture', goal: 'Explicit architecture fixture', criteria: ['Check isolation'] });
  await fs.writeFile(path.join(f.root, 'app.ts'), 'export const app = 1;\n');
  const sources = await f.value({ action: 'architecture_sources', files: ['app.ts'] });
  const graph = { title: 'Current source', source: 'Inspected app.ts only', nodes: [{ id: 'app', title: 'App', description: 'Actual source', files: ['app.ts'] }], edges: [], fingerprints: sources.fingerprints };
  const saveGraph = async () => f.call({ action: 'architecture_set', graph, expectedRevision: (await f.value({ action: 'project_snapshot' })).revision });
  assert.ok(!(await saveGraph()).isError);
  const sourceBefore = await fs.readFile(path.join(f.root, '.governance/architecture.json'), 'utf8');
  await fs.writeFile(path.join(f.root, 'app.ts'), 'export const app = 2;\n');
  assert.equal((await saveGraph()).isError, true);
  const initial = await f.value({ action: 'architecture_design_snapshot' });
  assert.equal(initial.draft, null);
  await f.value({ action: 'architecture_design_begin', expectedRevision: initial.revision, reason: 'User explicitly initiated fixture design' });
  const draft = await f.value({ action: 'architecture_design_snapshot' });
  const proposal = { title: 'Planned design', document: 'Design intent only', nodes: [{ id: 'planned', title: 'Planned', description: 'Not implemented', files: [] }], edges: [] };
  assert.equal((await f.call({ action: 'architecture_design_save', expectedRevision: draft.revision, expectedDraft: 'foreign-draft', proposal })).isError, true);
  await f.value({ action: 'architecture_design_save', expectedRevision: draft.revision, expectedDraft: draft.draft.draftId, proposal });
  const saved = await f.value({ action: 'architecture_design_snapshot' });
  assert.ok(JSON.stringify(saved).includes('governance:architecture-ascii:start'));
  assert.equal(await fs.readFile(path.join(f.root, '.governance/architecture.json'), 'utf8'), sourceBefore);
  await assert.rejects(f.call({ action: 'architecture_design_confirm' }), /Invalid governance arguments/);
});

test('real downloadable MCP target installs production-only lock and serves tools without repository or host dependencies', { timeout: 120000 }, async t => {
  const { execFileSync } = require('node:child_process');
  const { buildDistributions } = require('../scripts/build-distributions.cjs');
  const { safeFile } = require('../scripts/release-safety.cjs');
  const built = buildDistributions({ root: repo, targets: ['mcp-skills'] });
  const unpack = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'mcp-installed-'));
  t.after(() => fs.rm(unpack, { recursive: true, force: true }));
  const tar = require('node:zlib').gunzipSync(await fs.readFile(path.join(repo, 'build/distributions', built.assets[0].name)));
  const names = [];
  for (let offset = 0; offset + 512 <= tar.length && tar[offset];) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8) || 0;
    assert.ok(name.startsWith('package/'));
    assert.ok(header[156] === 48 || header[156] === 0);
    const relative = name.slice(8), output = safeFile(unpack, relative);
    names.push(relative);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(names.includes('npm-shrinkwrap.json'));
  assert.ok(names.includes('plugin/skills/architecture-copilot/LICENSE'));
  for (const name of names) assert.doesNotMatch(name, /(?:^|\/)(?:node_modules|\.pi|\.governance|\.secrets|STATE.json|test)(?:\/|$)/);
  execFileSync(process.execPath, [process.env.npm_execpath, 'ci', '--omit=dev', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: unpack, encoding: 'utf8', timeout: 90000, env: { ...process.env, NODE_PATH: '' } });
  await assert.rejects(fs.stat(path.join(unpack, 'node_modules/playwright')));
  await assert.rejects(fs.stat(path.join(unpack, 'node_modules/typescript')));
  const f = await fixture(t, path.join(unpack, 'build/mcp/server.js'), unpack);
  assert.equal((await f.client.listTools()).tools[0].name, 'governance');
  assert.equal((await f.client.listResources()).resources.length, 12);
  assert.deepEqual(await fs.readdir(f.root), []);
  await f.value({ action: 'init' });
  assert.equal((await f.value({ action: 'status' })).status, 'idle');
  assert.equal(f.stderr(), '');
});
