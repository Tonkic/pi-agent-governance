'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { decision, validatePolicy, validateSource, containsCredential, refreshGeneratedIndex, untrackedGuard, validatePushRemote, fullSha, gitAt, clean, secretScan } = require('../scripts/release-auto.cjs');
const { publishRelease, transport } = require('../scripts/github-release.cjs');
const policy = require('../scripts/release-policy.json');
const sha = 'a'.repeat(40), repository = 'Tonkic/pi-agent-governance';
test('only exact stable vN.0.0 tags N>=1 qualify; 0.x/minor/patch/prerelease never publish', () => {
  validatePolicy(policy);
  for (const version of ['1.0.0', '2.0.0', '10.0.0']) assert.equal(decision(`v${version}`, version).publish, true);
  for (const tag of [undefined, '', 'main', '1.0.0', 'v0.7.8', 'v0.0.0', 'v1.1.0', 'v1.0.1', 'v1.0.0-rc.1', 'v1.0.0+build', 'v01.0.0', 'v1.0.0\n', 'v-1.0.0']) assert.equal(decision(tag, '0.7.8').publish, false);
  assert.throws(() => decision('v1.0.0', '0.7.8'), /mismatch/);
  for (const [key, value] of [['enabled', false], ['rule', 'stable-major-or-minor'], ['allowSupersede', true], ['npmPublish', true], ['marketplacePublish', true], ['createTags', true], ['repository', 'other/repo']]) assert.throws(() => validatePolicy({ ...policy, [key]: value }), /approval/);
});
test('immutable full SHA tag must be on main ancestry; no implicit tag creation', () => {
  assert.throws(() => fullSha('main')); assert.throws(() => fullSha('a'.repeat(39)));
  const calls = [], git = (...args) => { calls.push(args); return sha; };
  validateSource('.', sha, 'v1.0.0', git);
  assert.deepEqual(calls, [['rev-parse', 'refs/tags/v1.0.0^{commit}'], ['merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main']]);
  assert.throws(() => validateSource('.', sha, 'v1.0.0', () => 'b'.repeat(40)), /mismatch/);
  assert.throws(() => validateSource('.', sha, 'v0.7.8', git));
  assert.throws(() => validateSource('.', sha, 'v1.0.0', (...args) => { if (args[0] === 'merge-base') throw Error('not ancestor'); return sha; }), /ancestor/);
});
function remote(options = {}) {
  const calls = [], uploaded = [], files = ['agent-governance-mcp-skills-1.0.0.tgz', 'io.github.tonkic.agent-governance-1.0.0.piplug', 'asset-manifest.json', 'SHA256SUMS'].map(name => ({ name, bytes: Buffer.from('fixture') }));
  const release = { id: 42, tag_name: 'v1.0.0', target_commitish: sha, draft: false, prerelease: false };
  const request = async (method, url, body, binary) => {
    calls.push({ method, url, body, binary });
    if (url.includes('/git/ref/')) return options.missingTag ? { status: 404 } : { status: 200, data: { object: { type: options.annotated ? 'tag' : 'commit', sha: options.wrongTag ? 'b'.repeat(40) : sha } } };
    if (url.includes('/git/tags/')) return { status: 200, data: { object: { type: 'commit', sha } } };
    if (url.includes('/compare/')) return { status: 200, data: { status: options.diverged ? 'diverged' : 'ahead', merge_base_commit: { sha } } };
    if (url.includes('/releases/tags/')) return { status: options.existing || options.completeExisting ? 200 : options.unknownStatus ? 403 : 404, data: { ...release, ...(options.completeExisting ? { assets: files.map((file, i) => ({ id: 100 + i, name: file.name, size: file.bytes.length, state: 'uploaded', digest: `sha256:${require('../scripts/build-distributions.cjs').sha256(file.bytes)}` })) } : {}) } };
    if (method === 'POST' && !binary) { if (options.createFail) throw Error('unknown create'); return { status: 201, data: release }; }
    if (binary) {
      if (options.uploadFail) throw Error('unknown upload');
      const asset = { id: 100 + uploaded.length, name: new URL(url).searchParams.get('name'), size: body.length, state: 'uploaded' }; uploaded.push(asset);
      return { status: 201, data: asset };
    }
    return { status: 200, data: { ...release, assets: uploaded } };
  };
  return { calls, args: { tag: 'v1.0.0', version: '1.0.0', sourceRef: sha, files, request, markAttempt: async () => { calls.push({ method: 'MARK' }); if (options.markerFail) throw Error('marker failed'); } } };
}
test('release creates once and uploads both artifacts plus manifest/checksums; never overwrites/latest supersedes', async () => {
  const f = remote({ annotated: true });
  const result = await publishRelease(f.args); assert.equal(result.published, true); assert.equal(result.assets.length, 4);
  const mutations = f.calls.filter(c => c.method === 'POST'); assert.equal(mutations.length, 5);
  assert.ok(f.calls.findIndex(c => c.method === 'MARK') < f.calls.findIndex(c => c.method === 'POST'));
  assert.equal(mutations[0].body.make_latest, 'false'); assert.equal(mutations[0].body.target_commitish, sha);
  assert.ok(f.calls.every(c => ['GET', 'POST', 'MARK'].includes(c.method)));
});
test('ineligible releases perform zero network calls', async () => {
  for (const tag of ['v0.7.8', 'v1.1.0', 'v1.0.1', 'v1.0.0-rc.1']) {
    const f = remote(); assert.equal((await publishRelease({ ...f.args, tag })).published, false); assert.deepEqual(f.calls, []);
  }
});
test('incomplete or duplicate artifact set prevents all network calls', async () => {
  const f = remote();
  await assert.rejects(publishRelease({ ...f.args, files: f.args.files.slice(1) }), /Both validated/);
  await assert.rejects(publishRelease({ ...f.args, files: [f.args.files[0], f.args.files[0], ...f.args.files.slice(2)] }), /Both validated/);
  assert.deepEqual(f.calls, []);
});
test('source/remote uncertainty/existing partial release and failed marker prevent every mutation', async () => {
  for (const options of [{ missingTag: true }, { wrongTag: true }, { diverged: true }, { existing: true }, { unknownStatus: true }, { markerFail: true }]) {
    const f = remote(options); await assert.rejects(publishRelease(f.args)); assert.equal(f.calls.some(c => c.method === 'POST'), false);
  }
});
test('a complete existing exact-source Release skips safely without attempt marker or any POST', async () => {
  const f = remote({ completeExisting: true });
  const result = await publishRelease(f.args);
  assert.equal(result.published, false);
  assert.equal(result.reason, 'existing-verified-release');
  assert.ok(f.calls.every(c => c.method === 'GET'));
});
test('an existing Release with missing, duplicate, changed, undigested assets or wrong source remains blocked', async () => {
  for (const mutate of [r => r.assets.pop(), r => { r.assets[1] = r.assets[0]; }, r => { r.assets[0].digest = 'sha256:wrong'; }, r => { delete r.assets[0].digest; }, r => { r.target_commitish = 'main'; }, r => { r.prerelease = true; }]) {
    const f = remote({ completeExisting: true }), original = f.args.request;
    f.args.request = async (...args) => { const result = await original(...args); if (args[1].includes('/releases/tags/')) mutate(result.data); return result; };
    await assert.rejects(publishRelease(f.args), /partial or unverifiable/);
    assert.ok(f.calls.every(c => c.method === 'GET'));
  }
});
test('unknown create/upload stops immediately; no retry, rollback, deletion or resume mutation', async () => {
  for (const options of [{ createFail: true }, { uploadFail: true }]) {
    const f = remote(options); await assert.rejects(publishRelease(f.args), /unknown/);
    assert.equal(f.calls.filter(c => c.method === 'POST' && !c.binary).length, 1);
    assert.equal(f.calls.filter(c => c.binary).length, options.uploadFail ? 1 : 0);
  }
});
test('HTTPS transport rejects redirects, endpoint/method changes, non404 GET failures and all mutation failures without leaking bodies', async () => {
  const token = 'synthetic-env-token', calls = [];
  const request = transport(token, async (url, init) => { calls.push(init); return { status: 404, json: async () => { throw Error(token); } }; });
  const url = `https://api.github.com/repos/${repository}/releases/tags/v1.0.0`;
  assert.deepEqual(await request('GET', url), { status: 404 }); assert.equal(calls[0].redirect, 'error');
  await assert.rejects(request('POST', url, {}), /Unexpected GitHub/);
  for (const bad of ['http://api.github.com/repos/x/y', 'https://evil.example/repos/x/y', 'https://api.github.com/repos/other/repo/releases']) await assert.rejects(request('GET', bad), /endpoint/);
  await assert.rejects(request('DELETE', url), /method/);
  const denied = transport(token, async () => ({ status: 403 })); await assert.rejects(denied('GET', url), /Unexpected/);
  const uncertain = transport(token, async () => { throw Error(token); }); await assert.rejects(uncertain('POST', `https://api.github.com/repos/${repository}/releases`, {}), e => !e.message.includes(token) && /unknown/.test(e.message));
});
test('NUL path boundaries and exact push remote allowlist retain prior safety', () => {
  untrackedGuard('.pi/goal/中文\n任务.md\0changes/archive/redesign-governance-panel/closure.json\0');
  assert.throws(() => untrackedGuard('.pi/goal/a.md\0unexpected.txt\0'), /Unexpected/);
  assert.throws(() => untrackedGuard('unexpected\n.pi/goal/a.md\0'), /Unexpected/);
  for (const url of [`https://github.com/${repository}.git`, `https://github.com/${repository}`, `git@github.com:${repository}.git`]) validatePushRemote(url);
  for (const url of ['', `https://github.com/${repository}.git\nhttps://example.com/other.git`, 'https://user:token@github.com/Tonkic/pi-agent-governance.git']) assert.throws(() => validatePushRemote(url));
});
test('historical fixture exemption never exempts other blobs, keys or actual supplied credentials', () => {
  const object = 'd2c45515b924a1f69d92ef00b771e77b7318bbfe', fixture = 'pi_pat_' + 'fixtureCredential123', second = 'pi_pat_' + 'otherCredential123', token = 'pi_pat_' + 'realCredentialForTest';
  const bytes = Buffer.from(fixture + ' ' + second);
  assert.equal(containsCredential(object, bytes, token), false);
  assert.equal(containsCredential('unknown', bytes, token), true);
  assert.equal(containsCredential(object, bytes, fixture), true);
  assert.equal(containsCredential(object, Buffer.from(token), token), true);
  assert.equal(containsCredential(object, Buffer.from('pi_pat_' + 'anotherCredential123'), token), true);
  assert.equal(containsCredential(object, Buffer.from('-----BEGIN ' + 'PRIVATE KEY-----'), token), true);
});
test('real Git clean gate and reachable history scan reject dirty sources and secret paths without reading credential files', t => {
  const root = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'release-safety-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = gitAt(root); git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(root, 'source.txt'), 'safe'); git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'safe'); let head = git('rev-parse', 'HEAD').trim();
  clean(root, head); secretScan(root, head);
  fs.writeFileSync(path.join(root, 'source.txt'), 'changed'); assert.throws(() => clean(root, head), /dirty/);
  fs.mkdirSync(path.join(root, '.secrets')); fs.writeFileSync(path.join(root, '.secrets', 'fixture.txt'), 'synthetic-not-a-token'); git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'unsafe fixture'); head = git('rev-parse', 'HEAD').trim();
  assert.throws(() => secretScan(root, head), /Secret path/);
});
test('generated index refresh accepts only unstaged known outputs with normalized HEAD=index=content hashes', () => {
  function fixture(status, actual = 'same', index = 'same') {
    const calls = [], run = (...args) => { calls.push(args); if (args[0] === 'status') return status; if (args[0] === 'rev-parse') return args[1].startsWith('HEAD:') ? 'same' : index; if (args[0] === 'hash-object') return actual; return ''; };
    return { calls, run };
  }
  const valid = fixture(' M plugin/runtime/main.js\n M plugin/docs/README.md\n'); refreshGeneratedIndex(valid.run);
  assert.deepEqual(valid.calls.at(-1), ['add', '--', 'plugin/runtime/main.js', 'plugin/docs/README.md']);
  for (const f of [fixture('M  plugin/runtime/main.js\n'), fixture(' M plugin/main.ts\n'), fixture(' M plugin/runtime/main.js\n', 'changed'), fixture(' M plugin/runtime/main.js\n', 'same', 'staged')]) { assert.throws(() => refreshGeneratedIndex(f.run), /inspect before release/); assert.equal(f.calls.some(a => a[0] === 'add'), false); }
  const empty = fixture(''); refreshGeneratedIndex(empty.run); assert.equal(empty.calls.some(a => a[0] === 'add'), false);
});
test('workflow gates both artifacts behind matrix checks and isolates write permission', () => {
  const source = fs.readFileSync(path.join(__dirname, '../.github/workflows/release.yml'), 'utf8');
  assert.equal((source.match(/contents: write/g) || []).length, 1); assert.match(source, /contents: read/); assert.match(source, /ubuntu-latest, windows-latest/); assert.match(source, /node-version: 22/);
  for (const command of ['npm ci', 'npm run typecheck', 'npm test', 'npm run check:behaviors', 'npm run test:browser', 'npm run build:distributions', 'node scripts/github-release.cjs']) assert.ok(source.includes(command));
  assert.doesNotMatch(source, /npm publish|submit_version|workflow_dispatch|--force/);
});
