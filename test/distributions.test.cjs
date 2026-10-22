'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { buildDistributions, verifyPi, piFiles, sharedModules, skillFiles, consoleFiles, hostFiles, readZip, crc32, runtimeMetadata } = require('../scripts/build-distributions.cjs');
const { readAssets } = require('../scripts/github-release.cjs');
const { safeFile, gitAt } = require('../scripts/release-safety.cjs');
// Synthetic ZIP fixtures only; production piplug bytes MUST come from official PluginPack.
function zip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, raw, attrs = 0] of entries) {
    const data = Buffer.from(raw), n = Buffer.from(name), packed = zlib.deflateRawSync(data), crc = crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(packed.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(attrs >>> 0, 38); c.writeUInt32LE(offset, 42);
    locals.push(l, n, packed); centrals.push(c, n); offset += l.length + n.length + packed.length;
  }
  const central = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'distribution-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, bytes) => { const f = path.join(root, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, bytes); };
  const pkg = { name: 'fixture-governance', version: '1.0.0', private: true, dependencies: {} };
  const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { '': { name: pkg.name, version: pkg.version, dependencies: {} } } };
  put('package.json', JSON.stringify(pkg)); put('package-lock.json', JSON.stringify(lock));
  put('.gitignore', 'build/\n.pi/\n.governance/\n.secrets/\nSTATE.json\nnode_modules/\nunpack/\n');
  for (const name of piFiles) put(`plugin/${name}`, name === 'manifest.json' ? JSON.stringify({ id: 'io.github.tonkic.agent-governance', version: pkg.version, permissions: ['ui.panel'], fs: { read: true } }) : `fixture ${name}\n`);
  for (const name of sharedModules) put(`build/plugin/${name}.js`, `exports.fixture = 'shared';\n`);
  put('build/plugin/ssh-runtime.js.LEGAL.txt', 'fixture bundled SSH licenses\n');
  put('build/mcp/server.js', "#!/usr/bin/env node\nconsole.log(require('../../package.json').version + ' ' + require('../plugin/core').fixture);\n");
  for (const name of [...consoleFiles, ...hostFiles]) if (!fs.existsSync(path.join(root, name))) put(name, `fixture ${name}\n`);
  for (const name of ['codex.toml', 'claude-code.json', 'pi.json']) put(`mcp/clients/${name}`, name.endsWith('.json') ? '{}' : '# fixture');
  for (const name of ['.pi/local', '.governance/private', '.secrets/never-read.token', 'STATE.json', 'node_modules/private/index.js']) put(name, 'private fixture must not be packed');
  const artifact = `plugin/dist/io.github.tonkic.agent-governance-${pkg.version}.piplug`;
  const archive = () => zip(piFiles.map(name => [name, fs.readFileSync(path.join(root, 'plugin', name))]));
  put(artifact, archive());
  const git = gitAt(root); git('init', '--initial-branch=main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  const commit = () => { git('add', '--', '.'); git('-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'); return git('rev-parse', 'HEAD').trim(); };
  const sourceRef = commit();
  return { root, pkg, lock, put, artifact, archive, git, commit, sourceRef };
}
function untar(bytes, dest) {
  const tar = zlib.gunzipSync(bytes), names = [];
  for (let p = 0; p + 512 <= tar.length && tar[p];) {
    const header = tar.subarray(p, p + 512), name = header.subarray(0, 100).toString().replace(/\0.*$/, ''), size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8) || 0;
    assert.ok(name.startsWith('package/')); assert.ok(header[156] === 48 || header[156] === 0, 'Only regular tar files');
    const relative = name.slice(8); names.push(relative);
    const output = safeFile(dest, relative); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, tar.subarray(p + 512, p + 512 + size));
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}
test('fixture builds both artifacts, deterministic manifest, valid install lock and shared runtime paths', t => {
  const f = fixture(t), first = buildDistributions(f), out = path.join(f.root, 'build/distributions');
  assert.equal(first.sourceRef, f.sourceRef); assert.equal(first.assets.length, 2);
  const files = readAssets(out, f.pkg.version, f.sourceRef); assert.equal(files.length, 4);
  const unpack = path.join(f.root, 'unpack'); fs.mkdirSync(unpack);
  const names = untar(files.find(a => a.name.endsWith('.tgz')).bytes, unpack);
  for (const name of names) assert.doesNotMatch(name, /(?:^|\/)(?:node_modules|\.pi|\.governance|\.secrets|\.remote-local|STATE.json|evidence|test)(?:\/|$)/);
  assert.deepEqual(names.filter(n => n.startsWith('build/plugin/')).sort(), [...sharedModules.map(n => `build/plugin/${n}.js`), 'build/plugin/ssh-runtime.js.LEGAL.txt'].sort());
  for (const name of skillFiles) assert.ok(names.includes(`plugin/skills/architecture-copilot/${name}`));
  const metadata = JSON.parse(fs.readFileSync(path.join(unpack, 'package.json')));
  assert.equal(metadata.bin['agent-governance-mcp'], 'build/mcp/server.js'); assert.deepEqual(metadata.dependencies, f.pkg.dependencies); assert.equal(metadata.scripts, undefined);
  assert.ok(names.includes('npm-shrinkwrap.json'));
  execFileSync(process.execPath, [process.env.npm_execpath, 'ci', '--omit=dev', '--ignore-scripts', '--offline'], { cwd: unpack, stdio: 'pipe' });
  assert.equal(execFileSync(process.execPath, [path.join(unpack, 'build/mcp/server.js')], { cwd: unpack, encoding: 'utf8' }).trim(), '1.0.0 shared');
  assert.deepEqual(buildDistributions(f), first, 'same source produces byte-identical bundles');
  assert.deepEqual(fs.readFileSync(path.join(out, f.artifact.split('/').at(-1))), fs.readFileSync(path.join(f.root, f.artifact)));
  fs.appendFileSync(path.join(out, first.assets[0].name), 'tamper'); assert.throws(() => readAssets(out, f.pkg.version, f.sourceRef), /checksum/);
});
test('PI package must match source, version and exact permissions; only LF normalization tolerated', t => {
  const f = fixture(t);
  verifyPi(f);
  const source = fs.readFileSync(path.join(f.root, 'plugin/main.ts'), 'utf8'); f.put('plugin/main.ts', source.replace(/\n/g, '\r\n')); verifyPi(f);
  f.put('plugin/main.ts', source + '// source changed'); assert.throws(() => verifyPi(f), /source mismatch/); f.put('plugin/main.ts', source);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.root, 'plugin/manifest.json')));
  f.put('plugin/manifest.json', JSON.stringify({ ...manifest, permissions: ['ui.panel', 'new.permission'] })); assert.throws(() => verifyPi(f), /source mismatch/);
  f.put('plugin/manifest.json', JSON.stringify({ ...manifest, version: '2.0.0' })); assert.throws(() => verifyPi(f), /version/);
  f.put('plugin/manifest.json', JSON.stringify(manifest)); f.put(f.artifact, Buffer.from('tamper')); assert.throws(() => verifyPi(f), /committed/);
  fs.rmSync(path.join(f.root, f.artifact)); assert.throws(() => verifyPi(f));
});
test('strict archive reader rejects traversal, duplicate/case aliases, links, hidden files, CRC and unknown entries', t => {
  for (const name of ['../escape', '/absolute', 'a/../escape', 'a\\b', 'C:/escape', 'a//b', 'dir/']) assert.throws(() => readZip(zip([[name, 'x']])), /Unsafe/);
  for (const entries of [[['a', '1'], ['a', '2']], [['a', '1'], ['A', '2']], [['link', 'target', 0xa1ff0000]]]) assert.throws(() => readZip(zip(entries)), /Unsafe/);
  const broken = zip([['a', 'hello']]); broken[31] ^= 1; assert.throws(() => readZip(broken));
  const f = fixture(t); f.put(f.artifact, zip([...piFiles.map(name => [name, fs.readFileSync(path.join(f.root, 'plugin', name))]), ['.secrets/token', 'private']]));
  f.sourceRef = f.commit(); assert.throws(() => verifyPi(f), /allowlist/);
});
test('named targets, lock/version guards and credential scanning fail closed', t => {
  const f = fixture(t);
  assert.throws(() => buildDistributions({ ...f, targets: ['echo secret'] }), /Unknown/);
  assert.throws(() => buildDistributions({ ...f, targets: ['mcp-skills', 'mcp-skills'] }), /duplicate/);
  assert.throws(() => buildDistributions({ ...f, sourceRef: 'main' }), /full commit/);
  assert.throws(() => buildDistributions({ ...f, sourceRef: 'b'.repeat(40) }), /match HEAD/);
  assert.throws(() => runtimeMetadata(f.pkg, { ...f.lock, version: '0.7.8' }), /mismatch/);
  assert.throws(() => runtimeMetadata({ ...f.pkg, dependencies: { x: '^1.0.0' } }, { ...f.lock, packages: { '': { version: '1.0.0', dependencies: { x: '^1.0.0' } }, 'node_modules/x': { version: '1.0.0' } } }), /pinned/);
  f.put('plugin/skills/architecture-copilot/SKILL.md', 'pi_pat_' + 'fixtureCredential123');
  assert.throws(() => buildDistributions({ ...f, targets: ['mcp-skills'] }), /Credential/);
});
test('unknown output and linked or dangling input/output paths are preserved, not followed', t => {
  const f = fixture(t); buildDistributions({ ...f, targets: ['pi-desktop'] });
  f.put('build/distributions/user.txt', 'retain');
  assert.throws(() => buildDistributions({ ...f, targets: ['pi-desktop'] }), /Unknown/);
  assert.equal(fs.readFileSync(path.join(f.root, 'build/distributions/user.txt'), 'utf8'), 'retain');
  const link = path.join(f.root, 'dangling'); fs.symlinkSync(path.join(f.root, 'absent'), link, 'junction');
  assert.throws(() => safeFile(f.root, 'dangling/file.txt'), /Linked/);
  assert.equal(fs.existsSync(path.join(f.root, 'absent')), false);
});
test('current repository runtime dependencies retain a compatible npm ci install lock', t => {
  const pkg = require('../package.json'), lock = require('../package-lock.json');
  const { metadata, shrinkwrap } = runtimeMetadata(pkg, lock);
  const temp = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'runtime-lock-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify(metadata));
  fs.writeFileSync(path.join(temp, 'npm-shrinkwrap.json'), JSON.stringify(shrinkwrap));
  execFileSync(process.execPath, [process.env.npm_execpath, 'ci', '--omit=dev', '--ignore-scripts', '--offline'], { cwd: temp, stdio: 'pipe' });
  assert.deepEqual(metadata.dependencies, pkg.dependencies || {});
  for (const name of Object.keys(metadata.dependencies)) assert.ok(fs.existsSync(path.join(temp, 'node_modules', name, 'package.json')));
});
