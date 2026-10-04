'use strict';
// Release-time automation only; never loaded by the plugin or on ordinary builds.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { buildPayload, versionPayload, connect, unwrap } = require('./plugin-center.cjs');
const root = path.resolve(__dirname, '..');
const pluginId = 'io.github.tonkic.agent-governance';
const repository = 'Tonkic/pi-agent-governance';
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
function fail(message) { throw new Error(message); }
function stable(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) fail('Only stable x.y.z versions are allowed');
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) fail('Version exceeds safe integer range');
  return parts;
}
function compare(a, b) {
  const x = stable(a), y = stable(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
function decision(candidate, status) {
  const v = stable(candidate);
  if (status?.pluginId !== pluginId || status.boundRepository !== repository || status.state !== 'active' || !Array.isArray(status.versions)) fail('Unexpected plugin identity, repository or state');
  const releases = status.versions.filter(r => r.status === 'published' && r.channel === 'stable');
  releases.forEach(r => stable(r.version));
  releases.sort((a, b) => compare(b.version, a.version));
  const base = releases[0];
  if (!base) fail('No published stable baseline; first publication requires manual approval');
  const b = stable(base.version);
  if (compare(candidate, base.version) < 0) fail('Version is older than published baseline');
  if (v[0] === b[0] && v[1] === b[1]) return { publish: false, reason: 'patch-or-unchanged', baseline: base.version };
  if (status.versions.some(r => r.version === candidate)) fail('Version already exists; inspect platform status');
  if (status.versions.some(r => !['published', 'rejected', 'withdrawn'].includes(r.status))) fail('Pending or unknown remote version state; no superseding');
  return { publish: true, baseline: base.version, sourceRef: base.sourceRef };
}
function validatePolicy(p) {
  if (!p.enabled) fail('Automatic release disabled');
  if (p.rule !== 'stable-major-or-minor' || p.pluginId !== pluginId || p.repository !== repository || p.branchPrefix !== 'release/plugin-center-' || p.allowPermissionChanges !== false || p.allowSupersede !== false) fail('Policy changed; renewed human approval required');
}
function permissionGuard(candidate, baseline) {
  if (!Array.isArray(candidate.permissions) || !Array.isArray(baseline.permissions)) fail('Missing permissions');
  if (candidate.permissions.some(p => !baseline.permissions.includes(p)) || JSON.stringify(candidate.fs ?? null) !== JSON.stringify(baseline.fs ?? null) || JSON.stringify(candidate.net ?? null) !== JSON.stringify(baseline.net ?? null)) fail('Permission expansion/change requires human approval');
}
function receiptGuard(receipt, sourceRef, packageHash) {
  if (receipt?.sourceRef !== sourceRef || receipt.packageSha256 !== packageHash) fail('Evidence does not match source/package');
  for (const key of ['pluginCheck', 'pluginPack', 'i18n', 'diffReview', 'secretReview']) {
    const check = receipt.checks?.[key];
    if (check?.passed !== true || typeof check.evidence !== 'string' || !check.evidence.trim()) fail(`Missing release evidence: ${key}`);
  }
}
// Dependency injection keeps all publication state-machine tests offline.
async function execute(plan, ops) {
  if (!plan.publish) return plan;
  await ops.preflight();
  await ops.checkRemote();
  await ops.push();
  await ops.checkRemote();
  await ops.markAttempt(); // Durable BEFORE network mutation; uncertainty never triggers a retry.
  await ops.submit();
  return ops.status(); // Approval and catalog publication may still be pending.
}
function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}
function readCommit(ref, file) { return git('show', `${ref}:${file}`); }
function clean(sourceRef) {
  if (git('rev-parse', 'HEAD').trim() !== sourceRef || git('status', '--porcelain', '--untracked-files=no').trim()) fail('HEAD changed or tracked worktree is dirty');
  const extra = git('ls-files', '--others', '--exclude-standard').trim().split('\n').filter(Boolean);
  if (extra.some(file => !file.startsWith('.pi/') && !file.startsWith('changes/archive/redesign-governance-panel/'))) fail('Unexpected untracked files; inspect before release');
}
function secretScan(sourceRef) {
  const token = fs.readFileSync(path.join(root, '.secrets/plugin-center.token'), 'utf8').trim();
  if (!/^pi_pat_[A-Za-z0-9_-]+$/.test(token)) fail('Invalid credential');
  const objects = git('rev-list', '--objects', sourceRef).trim().split('\n');
  for (const row of objects) {
    if (/\s(?:.*\/)?\.secrets\//.test(row)) fail('Secret path found in reachable history');
    const object = row.split(' ')[0];
    const bytes = execFileSync('git', ['cat-file', '-p', object], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
    if (bytes.includes(Buffer.from(token)) || /pi_pat_[A-Za-z0-9_-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(bytes.toString('utf8'))) fail('Credential-like content found in reachable history');
  }
}
function runChecks() {
  // npm is invoked via Node, avoiding shell quoting and npm.cmd portability issues.
  const npm = process.env.npm_execpath;
  if (!npm || !fs.existsSync(npm)) fail('Run through npm run release:auto');
  for (const script of ['typecheck', 'test', 'test:browser']) execFileSync(process.execPath, [npm, 'run', script], { cwd: root, stdio: 'inherit' });
}
async function main() {
  const args = process.argv.slice(2);
  const preview = args[0] === '--plan';
  if (preview) args.shift();
  const [refArg, notesPath, receiptPath] = args;
  const sourceRef = refArg || git('rev-parse', 'HEAD').trim();
  if (!/^[a-f0-9]{40}$/.test(sourceRef)) fail('A full commit SHA is required');
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'scripts/release-policy.json'), 'utf8'));
  validatePolicy(policy);
  const manifest = JSON.parse(readCommit(sourceRef, 'plugin/manifest.json'));
  if (manifest.id !== pluginId) fail('Unexpected plugin ID');
  const call = await connect();
  const getStatus = async () => unwrap(await call('plugin_status', { pluginId }));
  const plan = decision(manifest.version, await getStatus());
  console.log(JSON.stringify({ ...plan, mode: preview ? 'plan' : 'auto', version: manifest.version, sourceRef, baselineSourceRef: plan.sourceRef }));
  if (preview || !plan.publish) return; // No push, tests, receipt or submission for patches.
  clean(sourceRef);
  if (JSON.stringify(JSON.parse(readCommit(sourceRef, 'scripts/release-policy.json'))) !== JSON.stringify(policy)) fail('Policy must belong to the released commit');
  if (!/^[a-f0-9]{40}$/.test(plan.sourceRef || '')) fail('Missing baseline source commit');
  permissionGuard(manifest, JSON.parse(readCommit(plan.sourceRef, 'plugin/manifest.json')));
  if (!notesPath || !/^[\w./-]+$/.test(notesPath) || notesPath.split('/').includes('..') || notesPath.startsWith('/')) fail('Provide a committed relative release-notes path');
  const notes = readCommit(sourceRef, notesPath);
  if (!notes.trim()) fail('Release notes are empty');
  const payload = versionPayload(buildPayload(sourceRef, notes));
  const packagePath = `plugin/dist/${pluginId}-${manifest.version}.piplug`;
  const packageBytes = execFileSync('git', ['show', `${sourceRef}:${packagePath}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  receiptGuard(JSON.parse(fs.readFileSync(receiptPath, 'utf8')), sourceRef, sha256(packageBytes));
  const origin = git('remote', 'get-url', '--push', '--all', 'origin').trim();
  if (!['https://github.com/Tonkic/pi-agent-governance.git', 'https://github.com/Tonkic/pi-agent-governance', 'git@github.com:Tonkic/pi-agent-governance.git'].includes(origin)) fail('Unexpected push remote');
  const common = path.resolve(root, git('rev-parse', '--git-common-dir').trim());
  const journalDir = path.join(common, 'pi-governance', 'releases');
  fs.mkdirSync(journalDir, { recursive: true });
  const lock = path.join(journalDir, 'auto-release.lock');
  fs.mkdirSync(lock); // Exclusive; crashes leave a visible lock, not an automatic retry.
  try {
    const journal = path.join(journalDir, `${pluginId}-${manifest.version}.json`);
    if (fs.existsSync(journal)) fail('Submission was previously attempted; inspect remote status and journal manually');
    const branch = `refs/heads/${policy.branchPrefix}${manifest.version}`;
    const checkRemote = async () => {
      clean(sourceRef);
      const latest = decision(manifest.version, await getStatus());
      if (!latest.publish || latest.baseline !== plan.baseline || latest.sourceRef !== plan.sourceRef) fail('Published baseline changed; restart release review');
      const available = unwrap(await call('check_version', { pluginId, version: manifest.version }));
      if (available.version !== manifest.version || available.available !== true || available.exists !== false) fail('Version unavailable or response unknown');
    };
    const result = await execute(plan, {
      preflight: async () => { runChecks(); clean(sourceRef); secretScan(sourceRef); },
      checkRemote,
      push: async () => {
        const existing = git('ls-remote', '--heads', 'origin', branch).trim();
        if (existing && existing.split(/\s/)[0] !== sourceRef) fail('Release branch already points elsewhere; refusing replacement');
        // Explicit ref only; keep normal pre-push hooks and never force or push tags.
        git('-c', 'push.followTags=false', '-c', 'remote.origin.mirror=false', 'push', 'origin', `${sourceRef}:${branch}`);
        if (git('ls-remote', '--heads', 'origin', branch).trim().split(/\s/)[0] !== sourceRef) fail('Remote source verification failed');
      },
      markAttempt: async () => {
        const fd = fs.openSync(journal, 'wx');
        try { fs.writeFileSync(fd, JSON.stringify({ sourceRef, version: manifest.version, at: new Date().toISOString(), state: 'attempted-inspect-remote-before-any-retry' }, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      },
      submit: () => call('submit_version', payload),
      status: async () => {
        const status = await getStatus();
        const release = status.versions?.find(v => v.version === manifest.version);
        const state = release?.sourceRef === sourceRef ? release.status : 'unknown-inspect-remote';
        console.log(JSON.stringify({ version: manifest.version, state, publishedAt: release?.publishedAt || null }));
        if (state !== 'published') fail('Submitted but publication is not confirmed; query plugin_status, do not resubmit');
        return { version: manifest.version, state };
      }
    });
    return result;
  } finally { fs.rmdirSync(lock); }
}
module.exports = { stable, compare, decision, validatePolicy, permissionGuard, receiptGuard, execute };
if (require.main === module) main().catch(error => {
  // Do not print arbitrary subprocess output/remote payloads or credentials.
  console.error(error.code || error.status ? 'Release blocked by local command/IO failure; inspect checks and remote status. No mutation retry.' : String(error.message).replace(/pi_pat_[A-Za-z0-9_-]+/g, '[REDACTED]'));
  process.exitCode = 1;
});
