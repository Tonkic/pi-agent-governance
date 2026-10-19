'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const child = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { gitHistory, limits } = require('../plugin/runtime/git-history');

function git(root, args, input) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  return child.execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
    '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', ...args], {
    cwd: root, env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: '作者 Name', GIT_AUTHOR_EMAIL: 'author@example.test', GIT_COMMITTER_NAME: 'Committer',
      GIT_COMMITTER_EMAIL: 'committer@example.test', GIT_TERMINAL_PROMPT: '0' },
    input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 15000, windowsHide: true
  }).trim();
}
function temporary(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'git-history-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function repo(t, format = 'sha1') {
  const root = temporary(t);
  git(root, ['init', '-q', '--initial-branch=main', '--object-format=' + format]);
  return root;
}
function tree(root, files) {
  const top = {}, blobs = new Map();
  for (const [filename, value] of Object.entries(files)) {
    const parts = filename.split('/'); let node = top;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    node[parts.at(-1)] = typeof value === 'object' && !Buffer.isBuffer(value) ? value : { content: value };
  }
  function build(node) {
    const entries = [];
    for (const [name, value] of Object.entries(node)) {
      if (!Object.hasOwn(value, 'content') && !Object.hasOwn(value, 'oid')) entries.push(`040000 tree ${build(value)}\t${name}\0`);
      else {
        const mode = value.mode || '100644', type = mode === '160000' ? 'commit' : 'blob';
        if (!value.oid && !blobs.has(value.content)) blobs.set(value.content, git(root, ['hash-object', '-w', '--stdin'], value.content));
        const sha = value.oid || blobs.get(value.content);
        entries.push(`${mode} ${type} ${sha}\t${name}\0`);
      }
    }
    return git(root, ['mktree', '-z', '--missing'], entries.join(''));
  }
  return build(top);
}
function commit(root, files, parents = [], message = 'subject\n\nbody text\n', update = true) {
  const sha = git(root, ['commit-tree', tree(root, files), ...parents.flatMap(p => ['-p', p])], message);
  if (update) git(root, ['update-ref', 'HEAD', sha]);
  return sha;
}
const list = (root, extra = {}) => gitHistory(root, { action: 'list', ...extra });
const detail = (root, sha, revision) => gitHistory(root, { action: 'detail', sha, revision });
const diff = (root, sha, file, revision) => gitHistory(root, { action: 'diff', sha, path: file, revision });
const errorCode = code => error => error.code === code && error.message === 'Git history: ' + code;
function diskSnapshot(root) {
  const rows = [];
  function scan(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name), stat = fs.lstatSync(full), relative = path.relative(root, full);
      if (stat.isDirectory()) { rows.push([relative, 'dir']); scan(full); }
      else rows.push([relative, stat.size, stat.mtimeMs, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')]);
    }
  }
  scan(root); return rows;
}

test('non-repository and unborn are explicit, with no setup or file creation', async t => {
  const nonrepo = temporary(t), before = diskSnapshot(nonrepo);
  const missing = await list(nonrepo);
  assert.equal(missing.status, 'not-repository'); assert.equal(missing.revision, '');
  assert.deepEqual(missing.refs, []); assert.deepEqual(diskSnapshot(nonrepo), before);
  const root = repo(t), original = diskSnapshot(root), empty = await list(root);
  assert.equal(empty.status, 'empty'); assert.equal(empty.head, null); assert.equal(empty.branch, 'main');
  assert.match(empty.revision, /^[a-f0-9]{64}$/); assert.deepEqual(empty.commits, []);
  assert.deepEqual(diskSnapshot(root), original);
  const sha = commit(root, { 'file.txt': 'content\n' });
  git(root, ['symbolic-ref', 'HEAD', 'refs/heads/unborn']);
  const withRefs = await list(root);
  assert.equal(withRefs.head, null); assert.equal(withRefs.status, 'ready'); assert.equal(withRefs.commits[0].sha, sha);
});

test('strict action schemas reject primitives, unknown fields, expressions and invalid budgets', async t => {
  const root = repo(t);
  const invalid = [null, false, 1, 'list', [], {}, { action: 'fetch' }, { action: 'toString' },
    { action: 'list', path: 'file' }, { action: 'list', limit: 0 }, { action: 'list', limit: 201 },
    { action: 'list', limit: '2' }, { action: 'list', offset: 1.5 }, { action: 'list', offset: -1 },
    { action: 'list', offset: 5001 }, { action: 'list', offset: 1 }, { action: 'list', revision: null },
    { action: 'detail', sha: 'HEAD', revision: 'a'.repeat(64) },
    { action: 'detail', sha: 'a'.repeat(40), revision: 'x'.repeat(64) },
    { action: 'diff', sha: 'a'.repeat(40), revision: 'a'.repeat(64), path: 'x\0y' },
    { action: 'diff', sha: 'a'.repeat(40), revision: 'a'.repeat(64), path: 1 }];
  for (const payload of invalid) await assert.rejects(gitHistory(root, payload), /Git history: invalid-/);
  assert.equal(Object.isFrozen(limits), true);
});

test('root identity rejects missing, relative, subdirectory, linked root and linked ancestor', async t => {
  const root = repo(t), directory = path.join(root, 'sub'); fs.mkdirSync(directory);
  for (const bad of ['.', path.join(root, 'missing')]) await assert.rejects(list(bad), errorCode('invalid-workspace'));
  await assert.rejects(list(directory), errorCode('repository-root-mismatch'));
  const outer = temporary(t), link = path.join(outer, 'linked');
  fs.symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(list(link), errorCode('linked-workspace'));
  await assert.rejects(list(path.join(link, 'sub')), errorCode('linked-workspace'));
  fs.writeFileSync(path.join(root, 'regular'), 'x');
  await assert.rejects(list(path.join(root, 'regular')), /Git history: (linked|invalid)-workspace/);
});

test('linked Git worktree is supported without governance registration', async t => {
  const root = repo(t), sha = commit(root, { 'one.txt': 'one\n' });
  const outer = temporary(t), linked = path.join(outer, 'worktree');
  git(root, ['worktree', 'add', '-q', '--detach', linked, sha]);
  const before = diskSnapshot(outer), original = diskSnapshot(root), result = await list(linked);
  assert.equal(result.head, sha); assert.equal(result.branch, null);
  assert.deepEqual(diskSnapshot(outer), before); assert.deepEqual(diskSnapshot(root), original);
});

function graph(t) {
  const root = repo(t), base = commit(root, { 'base.txt': 'base\n' }, [], 'root subject\n\nroot body\n');
  const main = commit(root, { 'base.txt': 'base\n', 'main.txt': 'main\n' }, [base], 'main subject\n');
  const side = commit(root, { 'base.txt': 'base\n', 'side.txt': 'side\n' }, [base], 'side subject\n', false);
  git(root, ['update-ref', 'refs/heads/side', side]);
  const merge = commit(root, { 'base.txt': 'base\n', 'main.txt': 'main\n', 'side.txt': 'side\n' }, [main, side], 'merge subject\n\nmerge body\n');
  return { root, base, main, side, merge };
}

test('topological graph preserves both merge parents and declared tag/remote/detached refs only', async t => {
  const { root, base, main, side, merge } = graph(t);
  git(root, ['tag', '-a', 'v-test', '-m', 'annotated tag', side]);
  git(root, ['update-ref', 'refs/remotes/origin/main', main]);
  const hidden = commit(root, {}, [], 'hidden\n', false);
  git(root, ['update-ref', 'refs/stash', hidden]); git(root, ['update-ref', 'refs/private/hidden', hidden]);
  const result = await list(root);
  assert.equal(result.head, merge); assert.equal(result.branch, 'main');
  assert.deepEqual(new Set(result.commits.map(c => c.sha)), new Set([base, main, side, merge]));
  assert.deepEqual(result.commits[0].parents, [main, side]);
  for (const c of result.commits) for (const parent of c.parents) assert.ok(result.commits.findIndex(x => x.sha === parent) > result.commits.indexOf(c));
  assert.ok(result.refs.some(r => r.kind === 'tag' && r.name === 'refs/tags/v-test'));
  assert.ok(result.refs.some(r => r.kind === 'remote')); assert.equal(result.refs.length, 4);
  const detached = commit(root, { 'detached.txt': 'detached\n' }, [base], 'detached\n', false);
  git(root, ['checkout', '-q', '--detach', detached]);
  const detachedList = await list(root);
  assert.equal(detachedList.branch, null); assert.equal(detachedList.head, detached);
  assert.ok(detachedList.commits.some(c => c.sha === detached));
  await assert.rejects(detail(root, hidden, detachedList.revision), errorCode('unreachable-commit'));
});

test('pagination is complete, stable and rejects HEAD/branch/ref stale revisions', async t => {
  const { root, merge } = graph(t), full = await list(root), first = await list(root, { limit: 2 });
  assert.equal(first.offset, 0); assert.equal(first.nextOffset, 2);
  const second = await list(root, { offset: first.nextOffset, limit: 2, revision: first.revision });
  assert.equal(second.nextOffset, null);
  assert.deepEqual([...first.commits, ...second.commits], full.commits);
  git(root, ['update-ref', 'refs/heads/new-ref', merge]);
  await assert.rejects(list(root, { offset: 2, revision: first.revision }), errorCode('stale-revision'));
  await assert.rejects(detail(root, merge, first.revision), errorCode('stale-revision'));
  await assert.rejects(diff(root, merge, 'side.txt', first.revision), errorCode('stale-revision'));
  const fresh = await list(root); git(root, ['symbolic-ref', 'HEAD', 'refs/heads/new-ref']);
  await assert.rejects(list(root, { revision: fresh.revision }), errorCode('stale-revision'));
});

test('refs changed during an operation are rejected before returning data', async t => {
  const { root, merge } = graph(t), original = child.execFile; let mutated = false;
  child.execFile = function (command, args, ...rest) {
    if (!mutated && args.includes('cat-file')) { mutated = true; git(root, ['update-ref', 'refs/heads/race', merge]); }
    return original.call(this, command, args, ...rest);
  };
  t.after(() => { child.execFile = original; });
  await assert.rejects(list(root), errorCode('stale-revision'));
  assert.equal(mutated, true);
});

test('detail uses first parent and root uses no fabricated parent; full message is bounded', async t => {
  const { root, base, main, side, merge } = graph(t), { revision } = await list(root);
  const result = (await detail(root, merge, revision)).commit;
  assert.deepEqual(result.parents, [main, side]); assert.equal(result.comparisonParent, main);
  assert.match(result.body, /merge body/); assert.equal(result.bodyTruncated, false);
  assert.deepEqual(result.files.map(f => [f.path, f.status, f.additions, f.deletions]), [['side.txt', 'A', 1, 0]]);
  const initial = (await detail(root, base, revision)).commit;
  assert.equal(initial.comparisonParent, null); assert.deepEqual(initial.parents, []);
  assert.equal(initial.subject, 'root subject'); assert.equal(initial.authorName, '作者 Name');
  assert.match(initial.authoredAt, /^\d{4}-/); assert.match(initial.committedAt, /^\d{4}-/);
  const large = commit(root, {}, [merge], 'long subject\n\n' + '中'.repeat(limits.metadataBytes));
  const fresh = await list(root), bounded = (await detail(root, large, fresh.revision)).commit;
  assert.equal(bounded.body.length, limits.body); assert.equal(bounded.bodyTruncated, true);
});

test('NUL-safe Unicode, spaces, tabs, newline and literal wildcard paths diff exactly', async t => {
  const root = repo(t), names = ['中文 file.txt', 'line\nbreak.txt', 'tab\tfile.txt', 'a[1].txt', 'a1.txt'];
  const sha = commit(root, Object.fromEntries(names.map((name, i) => [name, 'VALUE_' + i + '\n']))), { revision } = await list(root);
  const files = (await detail(root, sha, revision)).commit.files;
  assert.deepEqual(new Set(files.map(f => f.path)), new Set(names));
  for (const [i, name] of names.entries()) {
    const result = await diff(root, sha, name, revision);
    assert.equal(result.kind, 'text'); assert.match(result.patch, new RegExp('\\+VALUE_' + i));
    for (let n = 0; n < names.length; n++) if (n !== i) assert.ok(!result.patch.includes('VALUE_' + n));
  }
});

test('modify/delete/root diffs read objects, binary and invalid UTF-8 return metadata only', async t => {
  const root = repo(t), first = commit(root, { 'change.txt': 'old\n', 'delete.txt': 'gone\n' });
  const sha = commit(root, { 'change.txt': 'new\n', 'binary.bin': Buffer.from([1, 0, 2]), 'invalid.bin': Buffer.from([255, 254]) }, [first]);
  const { revision } = await list(root), result = (await detail(root, sha, revision)).commit;
  assert.equal(result.files.find(f => f.path === 'delete.txt').status, 'D');
  assert.equal(result.files.find(f => f.path === 'binary.bin').binary, true);
  assert.match((await diff(root, sha, 'change.txt', revision)).patch, /-old\n\+new/);
  assert.match((await diff(root, sha, 'delete.txt', revision)).patch, /-gone/);
  for (const name of ['binary.bin', 'invalid.bin']) {
    const binary = await diff(root, sha, name, revision); assert.equal(binary.kind, 'binary'); assert.equal(binary.patch, '');
  }
});

test('old/new blob size and patch byte budgets return bounded too-large metadata', async t => {
  const root = repo(t), first = commit(root, { 'old-huge.txt': 'o'.repeat(limits.blobBytes + 1) });
  const sha = commit(root, { 'old-huge.txt': 'small\n', 'new-huge.txt': 'n'.repeat(limits.blobBytes + 1),
    'patch-huge.txt': 'many small lines\n'.repeat(12000) }, [first]);
  const { revision } = await list(root);
  for (const name of ['old-huge.txt', 'new-huge.txt', 'patch-huge.txt']) {
    const result = await diff(root, sha, name, revision);
    assert.equal(result.kind, 'too-large'); assert.equal(result.patch, ''); assert.equal(result.truncated, true);
  }
});

test('sensitive, option-like, symlink and gitlink paths expose names but never patches', async t => {
  const root = repo(t), base = commit(root, {}), names = ['.env', 'src/.env.local', '.git/config', '.secrets/token',
    '.ssh/config', 'private.key', 'id_ed25519', 'credentials.json', 'secrets.txt', '-option.txt', 'C:/outside', ':(literal)file'];
  const files = Object.fromEntries(names.map(name => [name, 'DO_NOT_EXPOSE\n']));
  files['link.txt'] = { mode: '120000', content: '/outside/secret\n' };
  files['module'] = { mode: '160000', oid: base };
  const sha = commit(root, files, [base]), { revision } = await list(root);
  const result = (await detail(root, sha, revision)).commit;
  assert.equal(result.files.length, names.length + 2);
  assert.ok(result.files.every(f => f.restricted && f.additions === null && f.deletions === null));
  assert.ok(!JSON.stringify(result).includes('DO_NOT_EXPOSE'));
  for (const name of Object.keys(files)) {
    const output = await diff(root, sha, name, revision);
    assert.equal(output.kind, 'restricted', name); assert.equal(output.patch, '');
  }
});

test('file-to-directory collision cannot turn an allowed path into a sensitive subtree diff', async t => {
  const root = repo(t), base = commit(root, { 'container': 'safe\n' });
  const sha = commit(root, { 'container/.env': 'SENSITIVE_SUBTREE\n' }, [base]), { revision } = await list(root);
  const result = (await detail(root, sha, revision)).commit;
  assert.ok(result.files.every(f => f.restricted));
  assert.equal((await diff(root, sha, 'container', revision)).kind, 'restricted');
  assert.ok(!JSON.stringify(result).includes('SENSITIVE_SUBTREE'));
});

test('only exact changed paths and reachable commits are accepted, never revision expressions', async t => {
  const root = repo(t), base = commit(root, { 'unchanged.txt': 'old\n' });
  const sha = commit(root, { 'unchanged.txt': 'old\n', 'changed.txt': 'new\n' }, [base]);
  const dangling = commit(root, { 'dangling.txt': 'not reachable\n' }, [], 'dangling\n', false), { revision } = await list(root);
  await assert.rejects(detail(root, dangling, revision), errorCode('unreachable-commit'));
  for (const name of ['unchanged.txt', '../changed.txt', '/changed.txt', 'C:\\secret', '--output=outside', ':(glob)**', '.git/config', '.env', '.secrets/token', 'changed.txt/'])
    await assert.rejects(diff(root, sha, name, revision), errorCode('path-not-changed'));
  for (const bad of ['HEAD', sha + '^', sha.slice(0, 12), '--all', 'a'.repeat(41)])
    await assert.rejects(detail(root, bad, revision), errorCode('invalid-sha'));
});

test('file count cap is explicit and denies diff when the complete changed set is unproven', async t => {
  const root = repo(t), files = Object.fromEntries(Array.from({ length: limits.files + 1 }, (_, i) => ['file-' + String(i).padStart(4, '0'), 'same\n']));
  const sha = commit(root, files), { revision } = await list(root), result = (await detail(root, sha, revision)).commit;
  assert.equal(result.files.length, limits.files); assert.equal(result.filesTruncated, true);
  await assert.rejects(diff(root, sha, result.files[0].path, revision), errorCode('files-truncated'));
});

test('refs cap rejects explicitly instead of enumerating an unbounded namespace', async t => {
  const root = repo(t), sha = commit(root, {});
  git(root, ['update-ref', '--stdin'], Array.from({ length: limits.refs }, (_, i) => `create refs/heads/branch-${i} ${sha}\n`).join(''));
  await assert.rejects(list(root), errorCode('too-many-refs'));
});

test('shallow list keeps actual missing parents rather than inventing roots', async t => {
  const root = repo(t), base = commit(root, { 'base': 'base\n' }), sha = commit(root, { 'top': 'top\n' }, [base]);
  const destination = path.join(temporary(t), 'clone');
  git(root, ['-c', 'protocol.file.allow=always', 'clone', '-q', '--depth=1', '--no-local', pathToFileURL(root).href, destination]);
  const result = await list(destination);
  assert.equal(result.shallow, true); assert.equal(result.commits.length, 1); assert.equal(result.commits[0].sha, sha);
  assert.deepEqual(result.commits[0].parents, [base]);
});

test('SHA-256 repositories return full 64-hex object IDs', async t => {
  const root = repo(t, 'sha256'), sha = commit(root, { 'sha256.txt': 'object format\n' }), result = await list(root);
  assert.match(sha, /^[a-f0-9]{64}$/); assert.equal(result.head, sha);
  assert.equal((await detail(root, sha, result.revision)).commit.files[0].path, 'sha256.txt');
  assert.match((await diff(root, sha, 'sha256.txt', result.revision)).patch, /\+object format/);
});

test('dirty/staged worktree, index, objects, locks and governance data are byte/mtime unchanged', async t => {
  const root = repo(t), sha = commit(root, { 'tracked.txt': 'COMMITTED\n', 'deleted.txt': 'object\n' });
  git(root, ['checkout', '-q', '-f', 'HEAD']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'STAGED\n'); git(root, ['add', 'tracked.txt']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'WORKTREE\n'); fs.unlinkSync(path.join(root, 'deleted.txt'));
  fs.mkdirSync(path.join(root, '.governance')); fs.writeFileSync(path.join(root, '.governance', 'keep'), 'preserve');
  fs.writeFileSync(path.join(root, 'STATE.json'), '{"keep":true}\n');
  fs.writeFileSync(path.join(root, '.git', 'index.lock'), 'existing lock');
  const before = diskSnapshot(root), result = await list(root);
  await detail(root, sha, result.revision);
  const patch = await diff(root, sha, 'tracked.txt', result.revision);
  assert.match(patch.patch, /COMMITTED/); assert.ok(!patch.patch.includes('STAGED')); assert.ok(!patch.patch.includes('WORKTREE'));
  assert.deepEqual(diskSnapshot(root), before);
});

test('Git environment hijacking is filtered and external diff/textconv/fsmonitor/hooks never run', async t => {
  const root = repo(t), other = repo(t), sha = commit(root, { 'safe.txt': 'SAFE_OBJECT\n', '.gitattributes': '*.txt diff=evil\n' });
  commit(other, { 'foreign.txt': 'FOREIGN\n' });
  const marker = path.join(root, 'EXECUTED');
  const script = path.join(temporary(t), 'evil.cjs'); fs.writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad');`);
  const executable = '"' + process.execPath.replaceAll('\\', '/') + '" "' + script.replaceAll('\\', '/') + '"';
  for (const key of ['diff.external', 'diff.evil.command', 'diff.evil.textconv', 'core.fsmonitor']) git(root, ['config', key, executable]);
  const hijack = { GIT_DIR: path.join(other, '.git'), GIT_WORK_TREE: other, GIT_INDEX_FILE: marker,
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: executable,
    GIT_EXTERNAL_DIFF: executable, GIT_OBJECT_DIRECTORY: path.join(other, '.git', 'objects'), GIT_CONFIG: marker };
  const old = Object.fromEntries(Object.keys(hijack).map(key => [key, process.env[key]]));
  Object.assign(process.env, hijack);
  try {
    const result = await list(root); assert.equal(result.head, sha); assert.ok(!JSON.stringify(result).includes('FOREIGN'));
    await detail(root, sha, result.revision);
    assert.match((await diff(root, sha, 'safe.txt', result.revision)).patch, /SAFE_OBJECT/);
    assert.equal(fs.existsSync(marker), false);
  } finally { for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test('committed attributes, not dirty attributes or configured order files, control metadata', async t => {
  const root = repo(t), sha = commit(root, { '.gitattributes': 'tracked.txt -diff\n', 'tracked.txt': 'OBJECT_ONLY\n' });
  git(root, ['checkout', '-q', '-f', 'HEAD']);
  fs.writeFileSync(path.join(root, '.gitattributes'), 'tracked.txt diff\n');
  git(root, ['config', 'diff.orderFile', 'nonexistent-worktree-order-file']);
  const before = diskSnapshot(root), result = await list(root);
  const metadata = (await detail(root, sha, result.revision)).commit;
  assert.equal(metadata.files.find(f => f.path === 'tracked.txt').binary, true);
  assert.match((await diff(root, sha, 'tracked.txt', result.revision)).patch, /\+OBJECT_ONLY/);
  assert.deepEqual(diskSnapshot(root), before);
});

test('annotated tag target badges are commit IDs but retagging the same target invalidates revision', async t => {
  const root = repo(t), sha = commit(root, { 'one.txt': 'one\n' });
  git(root, ['tag', '-a', 'annotated', '-m', 'first annotation', sha]);
  const result = await list(root);
  assert.equal(result.refs.find(r => r.kind === 'tag').sha, sha);
  git(root, ['tag', '-f', '-a', 'annotated', '-m', 'second annotation', sha]);
  await assert.rejects(list(root, { revision: result.revision }), errorCode('stale-revision'));
});

test('Git replace and graft metadata cannot rewrite the visible parent graph', async t => {
  const root = repo(t), base = commit(root, { 'base.txt': 'base\n' });
  const sha = commit(root, { 'top.txt': 'top\n' }, [base]);
  const replacement = commit(root, { 'replacement.txt': 'wrong\n' }, [], 'replacement\n', false);
  git(root, ['replace', sha, replacement]);
  fs.mkdirSync(path.join(root, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'info', 'grafts'), sha + '\n');
  const result = await list(root);
  assert.deepEqual(result.commits.map(c => c.sha), [sha, base]);
  assert.deepEqual(result.commits[0].parents, [base]);
  assert.ok(!result.commits.some(c => c.sha === replacement));
});

test('default/max page sizes and maximum offset stop explicitly with limited=true', async t => {
  const root = repo(t), input = [];
  for (let i = 0; i < limits.offset + limits.page + 2; i++) {
    const message = 'commit-' + i + '\n';
    input.push(`commit refs/heads/main\ncommitter Test <test@example.test> ${1000000000 + i} +0000\ndata ${Buffer.byteLength(message)}\n${message}\n`);
  }
  git(root, ['fast-import', '--quiet'], input.join('') + 'done\n');
  const first = await list(root);
  assert.equal(first.commits.length, limits.defaultPage); assert.equal(first.nextOffset, limits.defaultPage);
  const last = await list(root, { offset: limits.offset, limit: limits.page, revision: first.revision });
  assert.equal(last.commits.length, limits.page); assert.equal(last.nextOffset, null); assert.equal(last.limited, true);
  assert.equal(last.commits[0].subject, 'commit-201');
});

test('renames are explicit delete/add entries rather than ambiguous filename parsing', async t => {
  const root = repo(t), base = commit(root, { 'old name.txt': 'same content\n' });
  const sha = commit(root, { 'new name.txt': 'same content\n' }, [base]), { revision } = await list(root);
  assert.deepEqual((await detail(root, sha, revision)).commit.files.map(f => [f.path, f.status]), [['new name.txt', 'A'], ['old name.txt', 'D']]);
  assert.match((await diff(root, sha, 'old name.txt', revision)).patch, /-same content/);
  assert.match((await diff(root, sha, 'new name.txt', revision)).patch, /\+same content/);
});

test('missing objects fail with bounded public errors, not raw stderr or lazy fetch', async t => {
  const root = repo(t), sha = commit(root, { 'missing.txt': 'object\n' });
  const blob = git(root, ['rev-parse', `${sha}:missing.txt`]);
  fs.unlinkSync(path.join(root, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
  const { revision } = await list(root);
  await assert.rejects(diff(root, sha, 'missing.txt', revision), errorCode('missing-object'));
});

test('shallow boundary changes invalidate revisions between and during reads', async t => {
  const root = repo(t), first = commit(root, { 'a.txt': 'one\n' }), second = commit(root, { 'a.txt': 'two\n' }, [first]), third = commit(root, { 'a.txt': 'three\n' }, [second]);
  const shallowFile = path.join(root, '.git', 'shallow'); fs.writeFileSync(shallowFile, third + '\n');
  const before = await list(root); assert.equal(before.shallow, true); assert.equal(before.commits.length, 1);
  fs.writeFileSync(shallowFile, second + '\n');
  await assert.rejects(list(root, { offset: 1, revision: before.revision }), errorCode('stale-revision'));
  const fresh = await list(root); assert.equal(fresh.shallow, true); assert.equal(fresh.commits.length, 2); assert.notEqual(fresh.revision, before.revision);
  const original = child.execFile; let mutated = false;
  child.execFile = function (command, args, ...rest) { if (!mutated && args.includes('cat-file')) { mutated = true; fs.writeFileSync(shallowFile, first + '\n'); } return original.call(this, command, args, ...rest); };
  t.after(() => { child.execFile = original; });
  await assert.rejects(list(root), errorCode('stale-revision')); assert.equal(mutated, true);
});
