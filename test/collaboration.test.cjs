'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process'), crypto = require('node:crypto');
const { collaborate, bindingOK } = require('../build/plugin/collaboration');
const { RemoteStore } = require('../build/plugin/remote-store');
const { collaborationProgram } = require('../build/plugin/collaboration-program');
const git = (cwd, ...args) => cp.execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function fixture(t) {
  const base = fs.realpathSync.native(await fsp.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'authority-'))), root = path.join(base, 'work'), bare = path.join(base, 'github.git');
  await fsp.mkdir(root); git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid');
  await fsp.writeFile(path.join(root, '.gitignore'), '/.remote-local/\n'); await fsp.writeFile(path.join(root, 'README.md'), 'Authority 文档\n'); await fsp.mkdir(path.join(root, 'docs')); await fsp.writeFile(path.join(root, 'docs', 'guide.md'), '# Guide\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'initial'); git(base, 'clone', '--bare', root, bare);
  const head = git(root, 'rev-parse', 'HEAD'), store = new RemoteStore(root), mode = { fail: false, lostPush: false, missing: false }, calls = [];
  const original = cp.execFile;
  t.mock.method(cp, 'execFile', function(file, args, options, callback) {
    const network = args.some(s => s === 'https://github.com/example/project.git');
    calls.push({ args: [...args], cwd: options.cwd, network, env: options.env });
    if (!network) return original(file, args, options, callback);
    assert(args.every(a => !a.includes('ephemeral-auth-value')), 'Token absent from process arguments');
    assert(options.cwd.includes('github-cache-'), 'All network calls use isolated bare repository');
    if (mode.fail) { queueMicrotask(() => callback(Error('network unavailable'), Buffer.alloc(0), Buffer.from('do not expose diagnostics'))); return {}; }
    if (mode.missing && args.includes('ls-remote')) { queueMicrotask(() => callback(null, Buffer.alloc(0), Buffer.alloc(0))); return {}; }
    const rewritten = ['-c', 'protocol.file.allow=always', ...args.filter((a, i) => !(a === '-c' && args[i+1] === 'protocol.file.allow=never') && a !== 'protocol.file.allow=never').map(a => a === 'https://github.com/example/project.git' ? bare : a)];
    return original(file, rewritten, options, (error, stdout, stderr) => { if (!error && mode.lostPush && args.includes('push')) return callback(Error('lost successful push response'), stdout, stderr); callback(error, stdout, stderr); });
  });
  t.after(async () => { t.mock.restoreAll(); await fsp.rm(base, { recursive: true, force: true, maxRetries: 5 }); });
  return { base, root, bare, head, store, mode, calls };
}
const bindInput = { repository: 'example/project', branch: 'main', confirmed: true };
async function bind(f) { return collaborate(f.root, 'bind', bindInput); }
async function nextCommit(f) { await fsp.appendFile(path.join(f.root, 'docs', 'guide.md'), 'New change\n'); git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'change'); return git(f.root, 'rev-parse', 'HEAD'); }

test('authority precedence: local -> explicit SSH -> bound GitHub; profile is execution location, not authority override', async t => {
  const f = await fixture(t);
  assert.equal((await collaborate(f.root, 'authority')).authority, 'local');
  await f.store.configure({ id: 'server', host: '127.0.0.1', port: 22, username: 'test', platform: process.platform, directory: f.root }, 'fixture-only-password', undefined, true, true);
  assert.equal((await collaborate(f.root, 'authority', {}, 'server')).authority, 'ssh');
  await bind(f);
  assert.equal((await collaborate(f.root, 'authority', {}, 'server')).authority, 'github');
  assert.equal((await collaborate(f.root, 'authority')).branch, 'main');
});
test('failed first binding leaves no GitHub binding; existing SSH context stays authoritative', async t => {
  const f = await fixture(t); f.mode.fail = true;
  await f.store.configure({ id: 'server', host: '127.0.0.1', port: 22, username: 'test', platform: process.platform, directory: f.root }, 'fixture-only-password', undefined, true, true);
  await assert.rejects(bind(f), /GITHUB_GIT_OPERATION_FAILED/);
  assert.equal(fs.existsSync(path.join(f.root, '.remote-local', 'github.json')), false);
  assert.equal((await collaborate(f.root, 'authority', {}, 'server')).authority, 'ssh');
});
test('bound GitHub network failure, deleted branch and invalid configuration never silently downgrade', async t => {
  const f = await fixture(t); await bind(f); const saved = await fsp.readFile(path.join(f.root, '.remote-local', 'github.json'));
  f.mode.fail = true; await assert.rejects(collaborate(f.root, 'read', { path: 'README.md' }), /GITHUB_GIT_OPERATION_FAILED/);
  assert.equal((await collaborate(f.root, 'authority')).authority, 'github');
  f.mode.fail = false; f.mode.missing = true; await assert.rejects(collaborate(f.root, 'inspect'), /BRANCH_MISSING/);
  assert.deepEqual(await fsp.readFile(path.join(f.root, '.remote-local', 'github.json')), saved);
  await fsp.writeFile(path.join(f.root, '.remote-local', 'github.json'), 'null');
  await assert.rejects(collaborate(f.root, 'authority'), /INVALID_GITHUB_BINDING/);
});
test('authoritative read uses committed GitHub object, not dirty local text; no worktree/ref writes', async t => {
  const f = await fixture(t); await bind(f); await fsp.writeFile(path.join(f.root, 'README.md'), 'local draft');
  const before = git(f.root, 'show-ref'), index = await fsp.readFile(path.join(f.root, '.git', 'index'));
  const r = await collaborate(f.root, 'read', { path: 'README.md', token: 'ephemeral-auth-value' });
  assert.equal(r.text, 'Authority 文档\n'); assert.equal(r.head, f.head); assert.equal(r.readOnly, true);
  assert.equal(await fsp.readFile(path.join(f.root, 'README.md'), 'utf8'), 'local draft'); assert.equal(git(f.root, 'show-ref'), before); assert.deepEqual(await fsp.readFile(path.join(f.root, '.git', 'index')), index);
  assert.equal((await fsp.readdir(path.join(f.root, '.remote-local'))).some(x => x.startsWith('github-cache-')), false);
  const config = await fsp.readFile(path.join(f.root, '.remote-local', 'github.json'), 'utf8'); assert(!config.includes('ephemeral-auth-value'));
  assert(f.calls.filter(c => c.network && c.env.GIT_CONFIG_COUNT === '2').length > 0);
});
test('document traversal, secrets, gitlinks/symlinks and non-Markdown are rejected', async t => {
  const f = await fixture(t); await bind(f);
  for (const name of ['../README.md', 'docs/../README.md', '.remote-local/github.json', 'docs/token.md', 'STATE.json', 'docs/guide.md:evil', 'docs\\guide.md']) await assert.rejects(collaborate(f.root, 'read', { path: name }), /INVALID_AUTHORITY_DOCUMENT/);
  git(f.root, 'update-index', '--add', '--cacheinfo', '120000,' + git(f.root, 'rev-parse', 'HEAD:README.md') + ',docs/link.md'); git(f.root, 'commit', '-m', 'symbolic link'); git(f.root, 'push', f.bare, 'HEAD:main');
  await assert.rejects(collaborate(f.root, 'read', { path: 'docs/link.md' }), /NOT_REGULAR/);
});
test('explicit publish pushes new independent branch; main unchanged; no force push or worktree modification', async t => {
  const f = await fixture(t); await bind(f); const head = await nextCommit(f), before = git(f.root, 'show-ref');
  const result = await collaborate(f.root, 'publish', { expectedHead: head, target: 'agent/local-docs', confirmed: true });
  assert.equal(result.submittedHead, head); assert.equal(result.merged, false); assert.match(result.target, /^agent\/local-docs-[a-f0-9]{32}$/);
  assert.equal(git(f.bare, 'rev-parse', 'refs/heads/' + result.target), head); assert.equal(git(f.bare, 'rev-parse', 'main'), f.head); assert.equal(git(f.root, 'show-ref'), before); assert.equal(git(f.root, 'status', '--porcelain'), '');
  assert(f.calls.every(c => c.args.every(a => !a.startsWith('--force'))));
});
test('publish rejects missing confirmation, main target, stale head, dirty files and unrelated history', async t => {
  const f = await fixture(t); await bind(f); const head = await nextCommit(f), q = { expectedHead: head, target: 'agent/test', confirmed: true };
  await assert.rejects(collaborate(f.root, 'publish', { ...q, confirmed: false }), /CONFIRMED/);
  await assert.rejects(collaborate(f.root, 'publish', { ...q, target: 'main' }), /INDEPENDENT/);
  await assert.rejects(collaborate(f.root, 'publish', { ...q, expectedHead: f.head }), /STALE/);
  await fsp.writeFile(path.join(f.root, 'draft.txt'), 'draft'); await assert.rejects(collaborate(f.root, 'publish', q), /COMMIT_WORKSPACE/); await fsp.unlink(path.join(f.root, 'draft.txt'));
  assert.equal(f.calls.filter(c => c.args.includes('push')).length, 0);
});
test('successful push with lost acknowledgement blocks any replay; reconciliation only checks remote SHA', async t => {
  const f = await fixture(t); await bind(f); const head = await nextCommit(f), q = { expectedHead: head, target: 'agent/lost', confirmed: true };
  f.mode.lostPush = true; await assert.rejects(collaborate(f.root, 'publish', q), /GITHUB_GIT_OPERATION_FAILED/); const pushes = f.calls.filter(c => c.args.includes('push')).length;
  f.mode.lostPush = false; await assert.rejects(collaborate(f.root, 'publish', q), /PREVIOUS_GITHUB_PUSH_UNKNOWN/);
  const r = await collaborate(f.root, 'reconcile'); assert.equal(r.pushStatus, 'saved'); assert.equal(r.submittedHead, head); assert.equal(f.calls.filter(c => c.args.includes('push')).length, pushes);
});
test('binding validation rejects URL credentials/injection and does not overwrite an existing binding', async t => {
  const f = await fixture(t);
  for (const repository of ['https://github.com/a/b', 'user:password@github.com/a/b', 'a/../b', 'a/b.git', '--bad/repo']) assert.throws(() => bindingOK({ version: 1, repository, branch: 'main' }), /INVALID/);
  for (const branch of ['--upload-pack=x', 'main..x', 'main.lock', 'a//b', 'a/.hidden']) assert.throws(() => bindingOK({ version: 1, repository: 'a/b', branch }), /INVALID/);
  await assert.rejects(collaborate(f.root, 'bind', { ...bindInput, confirmed: false }), /CONFIRMATION/); await bind(f); await assert.rejects(bind(f), /ALREADY_BOUND/);
});
test('unbound local read and CLI reject secret argv/unknown fields without echo', async t => {
  const f = await fixture(t); assert.equal((await collaborate(f.root, 'read', { path: 'README.md' })).result.content, 'Authority 文档\n');
  const cli = path.resolve('build/plugin/collaboration-cli.js');
  const good = cp.spawnSync(process.execPath, [cli, '--workspace', f.root, '--action', 'authority'], { input: '{}', encoding: 'utf8' }); assert.equal(good.status, 0); assert.equal(JSON.parse(good.stdout).result.authority, 'local');
  const bad = cp.spawnSync(process.execPath, [cli, '--workspace', f.root, '--action', 'authority', '--token', 'NEVER-ECHO'], { input: '{}', encoding: 'utf8' }); assert.equal(bad.status, 1); assert(!bad.stderr.includes('NEVER-ECHO'));
  await assert.rejects(collaborate(f.root, 'authority', { token: 'NEVER-ECHO' }), /INVALID_INPUT/);
});
test('real SSH executes the same collaboration program; remote publish and lost SSH response reconcile without replay', { timeout: 60000 }, async t => {
  const f = await fixture(t); await bind(f);
  const remote = path.join(f.base, 'remote'); git(f.base, 'clone', f.bare, remote); git(remote, 'config', 'user.name', 'Remote'); git(remote, 'config', 'user.email', 'remote@example.invalid');
  await fsp.appendFile(path.join(remote, 'docs', 'guide.md'), 'remote change\n'); git(remote, 'add', '.'); git(remote, 'commit', '-m', 'remote change'); const head = git(remote, 'rev-parse', 'HEAD');
  const preload = path.join(f.base, 'test-only-git.cjs');
  await fsp.writeFile(preload, `const cp=require('node:child_process'),original=cp.execFile;cp.execFile=function(file,args,options,callback){if(args.includes('https://github.com/example/project.git'))args=['-c','protocol.file.allow=always',...args.filter((a,i)=>!(a==='-c'&&args[i+1]==='protocol.file.allow=never')&&a!=='protocol.file.allow=never').map(a=>a==='https://github.com/example/project.git'?${JSON.stringify(f.bare)}:a)];return original(file,args,options,callback);};`);
  const { Server } = require('ssh2'), { bootstrap, discover } = require('../build/plugin/remote-ssh');
  const key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }), clients = new Set(), children = new Set(); let dropped = false, dropPublish = false, publications = 0;
  const server = new Server({ hostKeys: [key] }, client => {
    clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client));
    client.on('authentication', ctx => ctx.method === 'password' && ctx.password === 'fixture-only-password' ? ctx.accept() : ctx.reject());
    client.on('ready', () => client.on('session', accept => { const session = accept(); session.on('exec', (accept, reject, info) => {
      assert.equal(info.command, bootstrap); const stream = accept(), chunks = [];
      stream.on('data', b => chunks.push(b)); stream.on('end', () => {
        const input = Buffer.concat(chunks), q = JSON.parse(input).request; if (q.action === 'publish') publications++;
        const child = cp.spawn(process.execPath, ['-r', preload, '-e', bootstrap.slice('node -e "'.length, -1)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); children.add(child); let out = '';
        child.stdout.on('data', b => out += b); child.stderr.on('data', b => stream.stderr.write(b)); child.on('error', () => { stream.exit(2); stream.end(); });
        child.on('close', code => { children.delete(child); if (dropPublish && q.action === 'publish' && JSON.parse(out).ok) { dropped = true; client.end(); return; } stream.write(out); stream.exit(code ?? 2); stream.end(); }); child.stdin.end(input);
      });
    }); }));
  });
  server.on('error', () => {}); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const c of clients) c.end(); for (const c of children) c.kill(); await new Promise(resolve => server.close(resolve)); });
  const p = { id: 'remote', host: '127.0.0.1', port: server.address().port, username: 'fixture', platform: process.platform, directory: remote };
  await f.store.configure(p, 'fixture-only-password', undefined, true, true); await f.store.trust(p, (await discover(p)).fingerprint, true);
  assert.equal((await collaborate(f.root, 'read', { path: 'README.md' }, p.id)).text, 'Authority 文档\n');
  dropPublish = true; const q = { expectedHead: head, target: 'agent/ssh-docs', confirmed: true };
  await assert.rejects(collaborate(f.root, 'publish', q, p.id), /UNKNOWN/); assert.equal(dropped, true); assert.equal((await f.store.journal(p, remote)).status, 'unknown');
  dropPublish = false; await assert.rejects(collaborate(f.root, 'publish', q, p.id), /RECONCILE/); assert.equal(publications, 1);
  const reconciled = await collaborate(f.root, 'reconcile', {}, p.id); assert.equal(reconciled.pushStatus, 'saved'); assert.equal(reconciled.submittedHead, head); assert.equal(publications, 1);
  assert.equal((await f.store.journal(p, remote)).status, 'saved'); assert.equal(git(f.bare, 'rev-parse', 'main'), f.head); assert.equal(git(f.bare, 'rev-parse', reconciled.target), head);
});
test('network authentication cannot discover user HOME/netrc or XDG credentials', async t => {
  const f = await fixture(t); await bind(f);
  for (const call of f.calls.filter(c => c.network)) for (const key of ['HOME', 'USERPROFILE', 'CURL_HOME', 'XDG_CONFIG_HOME']) assert.equal(call.env[key], call.cwd, key + ' must be the isolated network directory');
});
test('sensitive file introduced only by merge result is rejected before push', async t => {
  const f = await fixture(t); await bind(f); await nextCommit(f);
  git(f.root, 'checkout', '-b', 'side', f.head); await fsp.writeFile(path.join(f.root, 'docs', 'side.md'), 'side'); git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'side');
  git(f.root, 'checkout', 'main'); git(f.root, 'merge', '--no-ff', '--no-commit', 'side');
  await fsp.writeFile(path.join(f.root, '.env'), 'fixture-only-value'); git(f.root, 'add', '.env'); git(f.root, 'commit', '-m', 'merge-only sensitive path');
  const head = git(f.root, 'rev-parse', 'HEAD'); assert.equal(git(f.root, 'show', '--format=%P', '--no-patch').split(' ').length, 2);
  await assert.rejects(collaborate(f.root, 'publish', { expectedHead: head, target: 'agent/merge', confirmed: true }), /SENSITIVE_PATH/);
  assert.equal(f.calls.filter(c => c.args.includes('push')).length, 0);
});
