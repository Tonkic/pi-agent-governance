'use strict';
// The only network mutation entry point. No npm/market APIs, tag creation, PATCH or DELETE.
const fs = require('node:fs');
const path = require('node:path');
const { repository, fullSha, safeFile } = require('./release-safety.cjs');
const { decision, validatePolicy } = require('./release-auto.cjs');
const { sha256 } = require('./build-distributions.cjs');
const api = `https://api.github.com/repos/${repository}`;
function fail(message) { throw Error(message); }
function readAssets(directory, version, sourceRef) {
  fullSha(sourceRef);
  const read = name => fs.readFileSync(safeFile(directory, name));
  const manifestBytes = read('asset-manifest.json'), manifest = JSON.parse(manifestBytes);
  const expected = new Map([
    ['mcp-skills', `agent-governance-mcp-skills-${version}.tgz`],
    ['pi-desktop', `io.github.tonkic.agent-governance-${version}.piplug`]
  ]);
  if (manifest.schemaVersion !== 1 || manifest.sourceRef !== sourceRef || manifest.version !== version || manifest.assets?.length !== 2) fail('Asset manifest/source mismatch');
  const files = [];
  for (const asset of manifest.assets) {
    if (expected.get(asset.target) !== asset.name) fail('Unexpected/duplicate release asset');
    expected.delete(asset.target);
    const bytes = read(asset.name);
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) fail('Asset checksum mismatch');
    files.push({ name: asset.name, bytes });
  }
  files.push({ name: 'asset-manifest.json', bytes: manifestBytes });
  const sums = files.map(file => `${sha256(file.bytes)}  ${file.name}`).sort().join('\n') + '\n';
  const checksumBytes = read('SHA256SUMS');
  if (checksumBytes.toString('utf8') !== sums) fail('SHA256SUMS mismatch');
  files.push({ name: 'SHA256SUMS', bytes: checksumBytes });
  return files;
}
function transport(token, fetchImpl = fetch) {
  if (!token || /[\r\n]/.test(token)) fail('Missing environment token');
  return async (method, url, body, binary = false) => {
    const u = new URL(url);
    if (!['GET', 'POST'].includes(method)) fail('Unexpected GitHub method');
    if (method === 'POST' && !(u.hostname === 'api.github.com' && u.pathname === `/repos/${repository}/releases` && !u.search) && !(u.hostname === 'uploads.github.com' && new RegExp(`^/repos/${repository}/releases/[1-9][0-9]*/assets$`).test(u.pathname) && u.searchParams.size === 1 && u.searchParams.has('name'))) fail('Unexpected GitHub mutation endpoint');
    if (u.protocol !== 'https:' || u.username || u.password || !['api.github.com', 'uploads.github.com'].includes(u.hostname) || u.port || !u.pathname.startsWith(`/repos/${repository}/`)) fail('Unexpected GitHub endpoint');
    let response;
    try {
      response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'agent-governance-release', ...(body ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' } : {}) }, ...(body ? { body: binary ? body : JSON.stringify(body) } : {}) });
    } catch { fail('GitHub request outcome unknown; stop and inspect remotely. No mutation retry.'); }
    if (method === 'GET' && response.status === 404) return { status: 404 };
    if (response.status !== (method === 'GET' ? 200 : 201)) fail('Unexpected GitHub response; stop and inspect remotely. No mutation retry.');
    try { return { status: response.status, data: await response.json() }; }
    catch { fail('GitHub response unknown; stop and inspect remotely. No mutation retry.'); }
  };
}
async function publishRelease({ tag, version, sourceRef, files, request, markAttempt }) {
  fullSha(sourceRef);
  if (!decision(tag, version).publish) return { published: false };
  const expected = [`agent-governance-mcp-skills-${version}.tgz`, `io.github.tonkic.agent-governance-${version}.piplug`, 'asset-manifest.json', 'SHA256SUMS'];
  if (!Array.isArray(files) || files.length !== expected.length || new Set(files.map(f => f.name)).size !== expected.length || files.some(f => !expected.includes(f.name) || !Buffer.isBuffer(f.bytes) || !f.bytes.length) || typeof markAttempt !== 'function') fail('Both validated artifacts and checksums are required before publication');
  const get = async url => {
    const response = await request('GET', url);
    if (response.status !== 200) fail('Required GitHub source is missing or unreadable');
    return response.data;
  };
  let object = (await get(`${api}/git/ref/tags/${tag}`)).object;
  const seen = new Set();
  while (object?.type === 'tag') {
    fullSha(object.sha);
    if (seen.has(object.sha) || seen.size > 8) fail('Unexpected annotated tag chain');
    seen.add(object.sha); object = (await get(`${api}/git/tags/${object.sha}`)).object;
  }
  if (object?.type !== 'commit' || object.sha !== sourceRef) fail('Remote tag/source mismatch; never create a missing tag');
  const comparison = await get(`${api}/compare/${sourceRef}...main`);
  if (!['ahead', 'identical'].includes(comparison.status) || comparison.merge_base_commit?.sha !== sourceRef) fail('Release source must be on main ancestry');
  const existing = await request('GET', `${api}/releases/tags/${tag}`);
  if (existing.status === 200) fail('Release already exists (including partial); never overwrite or retry uploads');
  if (existing.status !== 404) fail('Release status unknown; no mutation');
  // Persist locally BEFORE the first mutation. Rerun attempts are separately refused by CLI.
  await markAttempt();
  const created = await request('POST', `${api}/releases`, { tag_name: tag, target_commitish: sourceRef, name: tag, body: `Source: ${sourceRef}\n\nGeneric MCP + Skills bundle and official PI-Desktop package. Verify SHA256SUMS before use.`, draft: false, prerelease: false, make_latest: 'false' });
  const release = created.data;
  if (created.status !== 201 || !Number.isSafeInteger(release?.id) || release.id <= 0 || release.tag_name !== tag || release.target_commitish !== sourceRef || release.draft !== false || release.prerelease !== false) fail('Create outcome unknown; retain release and inspect; no retry');
  const ids = [];
  for (const file of files) {
    const uploaded = await request('POST', `https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`, file.bytes, true);
    const asset = uploaded.data;
    if (uploaded.status !== 201 || !Number.isSafeInteger(asset?.id) || asset.name !== file.name || asset.size !== file.bytes.length || asset.state !== 'uploaded' || (asset.digest && asset.digest !== `sha256:${sha256(file.bytes)}`)) fail('Upload outcome unknown; retain partial release and inspect; no retry');
    ids.push(asset.id);
  }
  const final = await get(`${api}/releases/${release.id}`);
  if (final.tag_name !== tag || final.assets?.length !== files.length || final.assets.some(a => !ids.includes(a.id))) fail('Release verification incomplete; retain partial release and inspect');
  return { published: true, tag, sourceRef, releaseId: release.id, assets: files.map(f => f.name) };
}
async function main() {
  const root = path.resolve(__dirname, '..');
  validatePolicy(JSON.parse(fs.readFileSync(path.join(root, 'scripts/release-policy.json'), 'utf8')));
  const env = process.env;
  // A tag push, first execution only. Never permit manual/re-run mutation after uncertainty.
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== repository || env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF_TYPE !== 'tag' || env.GITHUB_RUN_ATTEMPT !== '1') fail('Only the first eligible GitHub tag-push run may publish');
  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  if (event.created !== true || event.deleted !== false || event.forced !== false || event.ref !== `refs/tags/${env.GITHUB_REF_NAME}`) fail('Tag event is not a new immutable source');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (!decision(env.GITHUB_REF_NAME, version).publish) return { published: false };
  const sourceRef = fullSha(env.RELEASE_SOURCE_SHA);
  const files = readAssets(path.join(root, 'build/distributions'), version, sourceRef);
  const journal = safeFile(root, 'build/github-release-attempt.json');
  return publishRelease({ tag: env.GITHUB_REF_NAME, version, sourceRef, files, request: transport(env.GITHUB_TOKEN), markAttempt: async () => {
    const fd = fs.openSync(journal, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify({ tag: env.GITHUB_REF_NAME, sourceRef, state: 'attempted-inspect-remote-no-retry' })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } });
}
module.exports = { transport, readAssets, publishRelease };
if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(() => { console.error('GitHub release stopped. Retain any partial release/journal; inspect remote state. Never retry mutations automatically.'); process.exitCode = 1; });
