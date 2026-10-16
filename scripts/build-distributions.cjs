'use strict';
// Named, static builders. This script never builds a piplug or publishes anything.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { fullSha, gitAt, safeFile, containsCredential, clean } = require('./release-safety.cjs');
const pluginId = 'io.github.tonkic.agent-governance';
const sharedModules = ['core', 'git', 'project', 'design', 'behaviors', 'tool', 'panel'];
const consoleFiles = ['build/web/server.js', 'web/bridge.js', 'web/console.css', 'plugin/renderer/index.html', 'plugin/renderer/panel.css', 'plugin/renderer/views.css', ...['i18n', 'graph-model', 'graph', 'design', 'panel'].map(f => `plugin/runtime/renderer/${f}.js`)];
const skillFiles = ['SKILL.md', 'SOURCE.md', 'LICENSE', ...['README', 'web-and-product', 'transactional', 'realtime-and-storage', 'ai-native', 'agent-and-org', 'embedded-industrial', 'signals', 'glossary'].map(f => `references/${f}.md`)];
const hostFiles = ['build/mcp/context-hook.js', 'mcp/clients/codex-hooks.json'];
const piFiles = [
  'manifest.json', 'main.js', 'main.ts', 'runtime/main.js',
  ...['core', 'git', 'panel', 'project', 'tool', 'operations', 'behaviors', 'design'].flatMap(f => [`${f}.ts`, `runtime/${f}.js`]),
  ...skillFiles.map(f => `skills/architecture-copilot/${f}`),
  'README.md', ...['architecture-design', 'README', 'governance', 'git', 'project', 'mcp', 'web-console', 'documentation', 'architecture', 'development', 'doc-driven', 'behavior-workspace', 'publishing', 'releasing', 'ui-sources'].map(f => `docs/${f}.md`),
  'renderer/index.html', 'renderer/panel.css', 'renderer/views.css', 'renderer/tsconfig.json',
  ...['design', 'panel', 'graph', 'graph-model', 'i18n'].flatMap(f => [`renderer/${f}.ts`, `runtime/renderer/${f}.js`])
].sort();
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
function fail(message) { throw Error(message); }
function read(root, name) {
  const file = safeFile(root, name);
  if (!fs.statSync(file).isFile()) fail('Expected regular source file');
  const bytes = fs.readFileSync(file);
  if (containsCredential('', bytes, process.env.GITHUB_TOKEN)) fail('Credential-like content in distribution input');
  return bytes;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
// Strict single-disk ZIP reader, bounded before inflate. No extraction to disk.
function readZip(bytes) {
  const bad = () => fail('Unsafe or unsupported PI archive');
  if (bytes.length < 22 || bytes.length > 32 * 1024 * 1024) bad();
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) bad();
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || count > 256 || start + size !== end) bad();
  const entries = new Map(), names = new Set(); let pos = start, nextLocal = 0, total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || bytes.readUInt32LE(pos) !== 0x02014b50) bad();
    const flags = bytes.readUInt16LE(pos + 8), method = bytes.readUInt16LE(pos + 10), crc = bytes.readUInt32LE(pos + 16);
    const compressed = bytes.readUInt32LE(pos + 20), length = bytes.readUInt32LE(pos + 24), n = bytes.readUInt16LE(pos + 28), extra = bytes.readUInt16LE(pos + 30), comment = bytes.readUInt16LE(pos + 32);
    const external = bytes.readUInt32LE(pos + 38), local = bytes.readUInt32LE(pos + 42);
    if (pos + 46 + n + extra + comment > end || flags & ~0x808 || ![0, 8].includes(method) || bytes.readUInt16LE(pos + 34)) bad();
    const nameBytes = bytes.subarray(pos + 46, pos + 46 + n), name = nameBytes.toString('utf8');
    if (!/^[A-Za-z0-9_./-]+$/.test(name) || name.startsWith('/') || name.endsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..') || names.has(name.toLowerCase())) bad();
    const type = (external >>> 16) & 0xf000;
    if (type && type !== 0x8000 || external & 0x10 || local !== nextLocal || local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50) bad();
    if (bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method || bytes.readUInt16LE(local + 26) !== n) bad();
    const dataStart = local + 30 + n + bytes.readUInt16LE(local + 28), dataEnd = dataStart + compressed;
    if (!bytes.subarray(local + 30, local + 30 + n).equals(nameBytes) || dataEnd > start || length > 8 * 1024 * 1024 || (total += length) > 32 * 1024 * 1024) bad();
    if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== length)) bad();
    nextLocal = dataEnd;
    if (flags & 8) {
      if (nextLocal + 12 > start) bad();
      if (bytes.readUInt32LE(nextLocal) === 0x08074b50) nextLocal += 4;
      if (nextLocal + 12 > start || bytes.readUInt32LE(nextLocal) !== crc || bytes.readUInt32LE(nextLocal + 4) !== compressed || bytes.readUInt32LE(nextLocal + 8) !== length) bad();
      nextLocal += 12;
    }
    const data = method === 0 ? bytes.subarray(dataStart, dataEnd) : zlib.inflateRawSync(bytes.subarray(dataStart, dataEnd), { maxOutputLength: Math.max(1, length) });
    if (data.length !== length || crc32(data) !== crc) bad();
    entries.set(name, data); names.add(name.toLowerCase()); pos += 46 + n + extra + comment;
  }
  if (pos !== end || nextLocal !== start) bad();
  return entries;
}
function verifyPi(ctx) {
  const name = `${pluginId}-${ctx.pkg.version}.piplug`, relative = `plugin/dist/${name}`;
  const bytes = read(ctx.root, relative);
  const committed = execFileSync('git', ['show', `${ctx.sourceRef}:${relative}`], { cwd: ctx.root, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (!bytes.equals(committed)) fail('Official PI package is not the committed artifact');
  const entries = readZip(bytes);
  if (entries.size !== piFiles.length || piFiles.some(file => !entries.has(file))) fail('PI archive allowlist mismatch');
  const manifest = JSON.parse(read(ctx.root, 'plugin/manifest.json'));
  if (manifest.id !== pluginId || manifest.version !== ctx.pkg.version) fail('PI manifest identity/version mismatch');
  for (const file of piFiles) {
    const actual = entries.get(file), expected = read(ctx.root, `plugin/${file}`);
    if (containsCredential('', actual, process.env.GITHUB_TOKEN)) fail('Credential-like PI archive content');
    // All allowlisted entries are text. Only CRLF->LF is tolerated, not JSON/permission changes.
    if (actual.toString('utf8').replace(/\r\n/g, '\n') !== expected.toString('utf8').replace(/\r\n/g, '\n')) fail(`PI source mismatch: ${file}; regenerate with official PluginPack`);
  }
  return { name, bytes };
}
function runtimeMetadata(pkg, lock) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version || '') || !/^[a-z0-9][a-z0-9._-]*$/.test(pkg.name || '')) fail('Invalid package identity/version');
  if (lock.lockfileVersion !== 3 || lock.name !== pkg.name || lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version || JSON.stringify(lock.packages[''].dependencies || {}) !== JSON.stringify(pkg.dependencies || {})) fail('Root lock/package mismatch');
  for (const [name, info] of Object.entries(lock.packages)) {
    if (info.link || (name && !name.startsWith('node_modules/')) || (info.resolved && !info.resolved.startsWith('https://registry.npmjs.org/'))) fail('Nonportable runtime lock');
  }
  for (const [name, version] of Object.entries(pkg.dependencies || {})) {
    if (!/^\d+\.\d+\.\d+$/.test(version) || !lock.packages[`node_modules/${name}`]) fail('Runtime dependency must be pinned and locked');
  }
  const metadata = { name: pkg.name, version: pkg.version, private: true, description: 'Shared local MCP, Skills and browser project console', license: pkg.license || 'UNLICENSED', engines: { node: '>=22' }, bin: { 'agent-governance-mcp': 'build/mcp/server.js', 'agent-governance-web': 'build/web/server.js' }, dependencies: pkg.dependencies || {}, files: ['build', 'plugin/skills', 'plugin/renderer', 'plugin/runtime/renderer', 'web', 'mcp/clients', 'README.md', 'npm-shrinkwrap.json'] };
  // npm pack excludes package-lock.json. npm-shrinkwrap.json is the equivalent install lock,
  // included by npm pack and honored by npm ci --omit=dev after unpacking.
  const shrinkwrap = { ...lock, packages: { ...lock.packages, '': { name: metadata.name, version: metadata.version, license: metadata.license, engines: metadata.engines, bin: metadata.bin, dependencies: metadata.dependencies } } };
  return { metadata, shrinkwrap };
}
function buildMcp(ctx) {
  const npm = process.env.npm_execpath;
  if (!npm || !fs.existsSync(npm)) fail('Use npm run build:distributions (npm_execpath required)');
  const { metadata, shrinkwrap } = runtimeMetadata(ctx.pkg, ctx.lock);
  const stage = fs.mkdtempSync(safeFile(ctx.root, 'build/distribution-stage-'));
  try {
    const files = new Map([
      ['package.json', Buffer.from(json(metadata))], ['npm-shrinkwrap.json', Buffer.from(json(shrinkwrap))],
      ['README.md', Buffer.from('# MCP + Skills + local console\n\nRequires Node.js 22+ and Git. Unpack into a trusted directory, run `npm ci --omit=dev --ignore-scripts`.\nMCP: `node build/mcp/server.js --workspace ABSOLUTE_EXISTING_PROJECT_DIRECTORY`. Configure your client using `mcp/clients/`.\nBrowser console: `node build/web/server.js --workspace ABSOLUTE_EXISTING_PROJECT_DIRECTORY` (optional `--port 0..65535`). Open the complete private local URL printed in the terminal. Do not share it. Ctrl+C stops the service; startup does not open the browser or initialize data.\nThe web service listens only on 127.0.0.1; validates Host/Origin/session-token and fixed API/asset allowlists. The token stays in browser tab session storage, is removed from the address bar and changes each startup. Never forward the port, proxy it or expose it to a network.\nBrowser, MCP clients and the PI adapter share existing project data. Refresh after changes; stale writes are rejected. Web supports task/board edits, source graphs/checks, draft initiation/review/confirmation and behavior documents; no external model/session/Agent launch, shell or paid turn. Draft proposals are saved from MCP clients.\nRead status/README and obtain explicit user approval before writes. Skills, confirmations and caller-attested tests are not an authentication or malicious-process sandbox.\nCopy `plugin/skills/architecture-copilot/` to supported client Skill locations if desired; preserve LICENSE/SOURCE/references.\nNo native per-CLI wrappers, npm/market publication, auto installation, data migration or tag creation.\nGuides: https://github.com/Tonkic/pi-agent-governance/blob/main/docs/web-console.md and docs/mcp.md\n')]
    ]);
    const guide = files.get('README.md').toString('utf8');
    files.set('README.md', Buffer.from(guide + '\nHost reuse: Claude Code may use `--host claude-code` instead of --workspace, reading official child CLAUDE_PROJECT_DIR with no cwd fallback. Merge mcp/clients/codex-hooks.json into supported trusted Codex Hook settings after editing only the helper installation path. The helper reads official session_id/cwd and injects read-only project metadata into the original conversation, not transcript content. It does not initialize data, start chats/models, persist a session registry or dynamically rebind MCP. Existing loaded tools/Skills retain host history. Client/version smoke remains required; see docs/mcp.md online.\n'));
    for (const file of ['build/mcp/server.js', ...hostFiles, ...consoleFiles, ...sharedModules.map(f => `build/plugin/${f}.js`), ...skillFiles.map(f => `plugin/skills/architecture-copilot/${f}`), ...['codex.toml', 'claude-code.json', 'pi.json'].map(f => `mcp/clients/${f}`)]) files.set(file, read(ctx.root, file));
    for (const [name, bytes] of files) {
      if (containsCredential('', bytes, process.env.GITHUB_TOKEN)) fail('Credential-like bundle content');
      const dest = safeFile(stage, name); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes, { flag: 'wx' });
    }
    const packed = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', stage], { cwd: stage, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    if (packed.length !== 1 || packed[0].files.length !== files.size || packed[0].files.some(file => !files.has(file.path))) fail('npm pack allowlist mismatch');
    return { name: `agent-governance-mcp-skills-${ctx.pkg.version}.tgz`, bytes: fs.readFileSync(safeFile(stage, packed[0].filename)) };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
const builders = Object.freeze({ 'mcp-skills': buildMcp, 'pi-desktop': verifyPi });
function cleanOutput(root) {
  const output = safeFile(root, 'build/distributions');
  if (fs.existsSync(output)) {
    const owner = safeFile(output, '.distribution-owner');
    if (!fs.existsSync(owner) || fs.readFileSync(owner, 'utf8') !== 'agent-governance-distributions-v1\n') fail('Unknown output directory; refusing overwrite');
    const previous = JSON.parse(fs.readFileSync(safeFile(output, 'asset-manifest.json'), 'utf8'));
    const allowed = new Set(['.distribution-owner', 'asset-manifest.json', 'SHA256SUMS', ...previous.assets.map(a => a.name)]);
    for (const name of fs.readdirSync(output)) {
      if (!allowed.has(name) || !fs.lstatSync(safeFile(output, name)).isFile()) fail('Unknown/linked output; refusing cleanup');
    }
    fs.rmSync(output, { recursive: true });
  }
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, '.distribution-owner'), 'agent-governance-distributions-v1\n', { flag: 'wx' });
  return output;
}
function buildDistributions({ root = path.resolve(__dirname, '..'), sourceRef = gitAt(root)('rev-parse', 'HEAD').trim(), targets = Object.keys(builders) } = {}) {
  fullSha(sourceRef);
  if (gitAt(root)('rev-parse', 'HEAD').trim() !== sourceRef) fail('Distribution source SHA must match HEAD');
  if (!targets.length || new Set(targets).size !== targets.length || targets.some(t => !Object.hasOwn(builders, t))) fail('Unknown or duplicate distribution target');
  const pkg = JSON.parse(read(root, 'package.json')), lock = JSON.parse(read(root, 'package-lock.json'));
  runtimeMetadata(pkg, lock);
  const ctx = { root, pkg, lock, sourceRef };
  // Validate/build everything before replacing the previous complete output.
  const assets = targets.map(target => ({ target, ...builders[target](ctx) }));
  clean(root, sourceRef);
  const output = cleanOutput(root);
  const manifest = { schemaVersion: 1, version: pkg.version, sourceRef, assets: assets.map(({ target, name, bytes }) => ({ target, name, bytes: bytes.length, sha256: sha256(bytes) })).sort((a, b) => a.name.localeCompare(b.name, 'en')) };
  for (const asset of assets) fs.writeFileSync(safeFile(output, asset.name), asset.bytes, { flag: 'wx' });
  const manifestBytes = Buffer.from(json(manifest));
  fs.writeFileSync(path.join(output, 'asset-manifest.json'), manifestBytes, { flag: 'wx' });
  const sums = [...manifest.assets.map(a => `${a.sha256}  ${a.name}`), `${sha256(manifestBytes)}  asset-manifest.json`].sort().join('\n') + '\n';
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), sums, { flag: 'wx' });
  return manifest;
}
module.exports = { builders, buildDistributions, verifyPi, readZip, crc32, piFiles, skillFiles, sharedModules, consoleFiles, hostFiles, runtimeMetadata, sha256 };
if (require.main === module) {
  try { console.log(JSON.stringify(buildDistributions({ targets: process.argv.length > 2 ? process.argv.slice(2) : undefined }))); }
  catch { console.error('Distribution build blocked: verify inputs, official PluginPack artifact and npm invocation. No publication performed.'); process.exitCode = 1; }
}
