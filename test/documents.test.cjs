'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { documents, limits } = require('../plugin/runtime/documents');

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'document-files-'));
  const root = await fs.realpath(temp);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const put = async (rel, content = '') => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), content);
  };
  return { root, put, list: () => documents(root, { action: 'list' }),
    read: rel => documents(root, { action: 'read', path: rel }) };
}
const paths = result => result.files.map(file => file.path);
async function rejects(promise, pattern = /^(?:Invalid document(?:s request| path| workspace)|Document (?:unavailable|workspace mismatch))$/) {
  await assert.rejects(promise, error => { assert.match(error.message, pattern); return true; });
}

test('documents: empty uninitialized workspace is noncreating; existing governance bytes stay unchanged', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.list(), { workspace: f.root, files: [], truncated: false,
    limits: { files: 500, entries: 4000, depth: 8, bytes: 262144 } });
  await rejects(f.read('README.md'));
  assert.deepEqual(await fs.readdir(f.root), []);
  await f.put('README.md', '# Project');
  await f.put('STATE.json', 'not parsed or changed');
  await f.put('.governance.lock', 'foreign lock - no acquisition');
  await f.put('.governance/board.json', 'not read or changed');
  const before = await fs.readdir(f.root);
  await f.list();
  await f.read('README.md');
  assert.deepEqual(await fs.readdir(f.root), before);
  assert.equal(await fs.readFile(path.join(f.root, 'STATE.json'), 'utf8'), 'not parsed or changed');
  assert.equal(await fs.readFile(path.join(f.root, '.governance.lock'), 'utf8'), 'foreign lock - no acquisition');
  assert.equal(await fs.readFile(path.join(f.root, '.governance/board.json'), 'utf8'), 'not read or changed');
});

test('documents: exact fixed roots, nested Markdown, Chinese, empty files and stable sorted metadata', async t => {
  const f = await fixture(t);
  for (const rel of ['LICENSE.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'AGENTS.md', 'README.md',
    'docs/z.md', 'docs/中文/开始.md', 'docs/a.md', 'notes/archive/day.md']) await f.put(rel, rel);
  await f.put('docs/empty.md');
  for (const rel of ['OTHER.md', 'LICENSE', 'docs/no.txt', 'docs/upper.MD', 'src/ignored.md'])
    await f.put(rel, 'not listed');
  const expected = ['AGENTS.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE.md', 'README.md',
    'docs/a.md', 'docs/empty.md', 'docs/z.md', 'docs/中文/开始.md', 'notes/archive/day.md'];
  const result = await f.list();
  assert.deepEqual(paths(result), expected);
  assert.equal(result.truncated, false);
  assert.deepEqual(await f.list(), result);
  for (const file of result.files) {
    assert.deepEqual(Object.keys(file).sort(), ['bytes', 'path']);
    assert.equal(file.bytes, Buffer.byteLength(file.path === 'docs/empty.md' ? '' : file.path));
  }
  assert.deepEqual(await f.read('docs/empty.md'), { workspace: f.root, path: 'docs/empty.md', content: '', bytes: 0 });
  const text = '# 中文标题\r\n\n正文\t🙂\n';
  await f.put('docs/中文/开始.md', text);
  assert.deepEqual(await documents(f.root, { action: 'read', path: 'docs/中文/开始.md', workspace: f.root }),
    { workspace: f.root, path: 'docs/中文/开始.md', content: text, bytes: Buffer.byteLength(text) });
  assert.equal((await documents(f.root + path.sep, { action: 'list' })).workspace, f.root);
});

test('documents: reject primitives, extra fields, wrong actions, accessors and workspace selectors', async t => {
  const f = await fixture(t);
  for (const payload of [null, undefined, false, 3, 'list', [], {}, new Date(),
    { action: 'write', path: 'README.md' }, { action: 'list', path: 'README.md' },
    { action: 'list', extra: true }, { action: 'read' },
    { action: 'read', path: 'README.md', extra: undefined },
    { action: 'list', workspace: f.root + '-other' }, { action: 'list', workspace: null },
    { action: 'list', workspace: undefined }, { action: 'list', [Symbol('extra')]: 1 }])
    await rejects(documents(f.root, payload));
  await rejects(documents(f.root, { get action() { throw Error('MUST NOT EXECUTE'); } }));
  assert.equal((await documents(f.root, Object.assign(Object.create(null), { action: 'list' }))).workspace, f.root);
});

test('documents: reject absolute/traversal/encoded/invisible/hidden/sensitive and ambiguous paths', async t => {
  const f = await fixture(t);
  const bad = ['', '.', '..', '/README.md', 'C:/README.md', '\\\\server\\share\\README.md',
    'docs\\file.md', 'docs/../README.md', 'docs/./x.md', 'docs//x.md', 'docs/a.md/',
    'docs/x.md:stream', 'docs/%2e%2e/x.md', 'docs/%252e/x.md', 'docs/x%00.md',
    'docs/a\0.md', 'docs/a\n.md', 'docs/a\u200b.md', 'docs/a\u202e.md', 'docs/．hidden/x.md',
    'docs/a／b.md', 'docs/.git/x.md', 'docs/.env.md', 'docs/.ssh/key.md', 'docs/.hidden/x.md',
    'docs/secrets/x.md', 'docs/credentials.md', 'docs/token-notes.md', 'docs/private/x.md',
    'docs/API-TOKEN.md', 'docs/id_rsa.md', 'docs/cert.pem.md', 'docs/node_modules/x.md',
    'docs/ x.md', 'docs/x.md ', 'docs/sub./x.md', 'docs/NUL.md', 'docs/x?.md',
    'docs/a.txt', 'notes/a.MD', 'other/a.md', 'readme.md', 'Readme.md', 'DOCS/a.md', 'STATE.json'];
  for (const rel of bad) await rejects(f.read(rel));
  for (const value of [null, 0, {}, []]) await rejects(f.read(value));
  await f.put('docs/ok.md', 'public');
  for (const rel of ['docs/.hidden/x.md', 'docs/secrets/x.md', 'docs/private.md',
    'docs/credentials.md', 'docs/token.md', 'docs/a\u200b.md']) await f.put(rel, 'MUST NOT LIST');
  assert.deepEqual(paths(await f.list()), ['docs/ok.md']);
});

test('documents: actual disk case must match explicit root and directory spelling', async t => {
  const f = await fixture(t);
  await f.put('readme.md', 'wrong root case');
  await f.put('DOCS/a.md', 'wrong directory case');
  await f.put('notes/Actual.md', 'correct case');
  assert.deepEqual(paths(await f.list()), ['notes/Actual.md']);
  await rejects(f.read('README.md'));
  await rejects(f.read('docs/a.md'));
  await rejects(f.read('notes/actual.md'));
  assert.equal((await f.read('notes/Actual.md')).content, 'correct case');
});

test('documents: bound root must be explicitly absolute, existing and a directory', async t => {
  const f = await fixture(t);
  await f.put('README.md', 'root file');
  for (const root of ['', '.', 'relative', '..', null, undefined, 1, {}, 'C:relative',
    path.join(f.root, 'missing'), path.join(f.root, 'README.md'), f.root + '/docs/..'])
    await rejects(documents(root, { action: 'list' }));
  if (process.platform === 'win32') {
    await rejects(documents('\\rooted-without-drive', { action: 'list' }));
    await rejects(documents('/rooted-without-drive', { action: 'list' }));
  }
});

test('documents: linked root, linked ancestor and linked docs/nested/root-file paths fail closed (Windows junctions)', async t => {
  const f = await fixture(t), outside = await fixture(t);
  await outside.put('README.md', 'OUTSIDE CONTENT');
  await outside.put('inside/docs/page.md', 'OUTSIDE CONTENT');
  await outside.put('page.md', 'OUTSIDE CONTENT');
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  const alias = path.join(f.root, 'alias');
  await fs.symlink(outside.root, alias, type);
  await rejects(documents(alias, { action: 'list' }));
  await rejects(documents(path.join(alias, 'inside'), { action: 'list' }));
  await fs.symlink(outside.root, path.join(f.root, 'docs'), type);
  assert.deepEqual(paths(await f.list()), []);
  await rejects(f.read('docs/page.md'));
  await fs.unlink(path.join(f.root, 'docs'));
  await fs.mkdir(path.join(f.root, 'docs'));
  await fs.symlink(outside.root, path.join(f.root, 'docs/linked'), type);
  await fs.symlink(outside.root, path.join(f.root, 'README.md'), type);
  await rejects(f.read('docs/linked/page.md'));
  await rejects(f.read('README.md'));
  assert.deepEqual(paths(await f.list()), []);
  if (process.platform !== 'win32') {
    await fs.symlink(path.join(outside.root, 'page.md'), path.join(f.root, 'docs/file.md'), 'file');
    await rejects(f.read('docs/file.md'));
    assert.deepEqual(paths(await f.list()), []);
  }
  await fs.unlink(alias);
  await fs.unlink(path.join(f.root, 'docs/linked'));
  await fs.unlink(path.join(f.root, 'README.md'));
});

test('documents: directories are not readable files and optional non-directory trees are skipped', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, 'README.md'));
  await f.put('docs', 'not a directory');
  await fs.mkdir(path.join(f.root, 'notes/folder.md'), { recursive: true });
  await rejects(f.read('README.md'));
  await rejects(f.read('notes/folder.md'));
  assert.deepEqual(paths(await f.list()), []);
});

test('documents: exact byte limit accepted, oversized sparse file rejected before open and omitted with truncation', async t => {
  const f = await fixture(t);
  await f.put('docs/exact.md', 'a'.repeat(limits.bytes));
  await f.put('docs/huge.md');
  await fs.truncate(path.join(f.root, 'docs/huge.md'), 64 * 1024 * 1024);
  assert.equal((await f.read('docs/exact.md')).bytes, limits.bytes);
  const result = await f.list();
  assert.deepEqual(paths(result), ['docs/exact.md']);
  assert.equal(result.truncated, true);
  t.mock.method(fs, 'open', () => { throw Error('must reject before open'); });
  await rejects(f.read('docs/huge.md'), /^Document unavailable$/);
  assert.equal(fs.open.mock.callCount(), 0);
});

test('documents: fatal UTF8 and NUL/binary controls rejected; Markdown HTML is returned only as inert text', async t => {
  const f = await fixture(t);
  for (const [name, buffer] of [['bad', Buffer.from([0xc3, 0x28])], ['short', Buffer.from([0xf0, 0x9f])],
    ['zero', Buffer.from('a\0b')], ['escape', Buffer.from('a\x1bb')], ['del', Buffer.from([0x7f])],
    ['c1', Buffer.from('\u0085')]]) {
    await f.put(`docs/${name}.md`, buffer);
    await rejects(f.read(`docs/${name}.md`), /^Document unavailable$/);
  }
  const text = '<script>throw 1</script>\n![remote](https://example.invalid/image)\n';
  await f.put('docs/html.md', text);
  assert.equal((await f.read('docs/html.md')).content, text);
});

test('documents: list never opens/reads contents; read uses bounded handle reads and closes handles', async t => {
  const f = await fixture(t);
  await f.put('docs/page.md', 'x'.repeat(limits.bytes));
  const originalOpen = fs.open.bind(fs);
  let requested = 0, closed = 0;
  t.mock.method(fs, 'readFile', () => { throw Error('unbounded read forbidden'); });
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    const originalRead = handle.read.bind(handle), originalClose = handle.close.bind(handle);
    handle.read = async (...readArgs) => {
      requested += readArgs[2];
      assert.ok(readArgs[2] <= limits.bytes + 1);
      return originalRead(...readArgs);
    };
    handle.close = async () => { closed++; return originalClose(); };
    return handle;
  });
  assert.deepEqual(paths(await f.list()), ['docs/page.md']);
  assert.equal(fs.open.mock.callCount(), 0);
  assert.equal((await f.read('docs/page.md')).bytes, limits.bytes);
  assert.ok(requested <= limits.bytes + 2);
  assert.equal(closed, 1);
  await f.put('docs/bad.md', Buffer.from([0xff]));
  await rejects(f.read('docs/bad.md'));
  assert.equal(closed, 2);
});

test('documents: growing file cannot cause an unbounded read', async t => {
  const f = await fixture(t);
  await f.put('docs/page.md', 'small');
  const originalOpen = fs.open.bind(fs);
  let readBytes = 0, closed = false;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    const originalRead = handle.read.bind(handle), originalClose = handle.close.bind(handle);
    handle.read = async (...readArgs) => {
      if (!readBytes) await fs.truncate(path.join(f.root, 'docs/page.md'), limits.bytes * 4);
      const result = await originalRead(...readArgs);
      readBytes += result.bytesRead;
      return result;
    };
    handle.close = async () => { closed = true; return originalClose(); };
    return handle;
  });
  await rejects(f.read('docs/page.md'));
  assert.equal(readBytes, limits.bytes + 1);
  assert.equal(closed, true);
});

test('documents: opened handle identity must match the checked file; mismatched handle closes without reading', async t => {
  const f = await fixture(t), outside = await fixture(t);
  await f.put('docs/page.md', 'public');
  await outside.put('page.md', 'HIDDEN');
  const originalOpen = fs.open.bind(fs);
  let closed = false, reads = 0;
  t.mock.method(fs, 'open', async () => {
    const handle = await originalOpen(path.join(outside.root, 'page.md'), 'r');
    const originalClose = handle.close.bind(handle);
    handle.read = async () => { reads++; throw Error('must not read mismatched handle'); };
    handle.close = async () => { closed = true; return originalClose(); };
    return handle;
  });
  await rejects(f.read('docs/page.md'), /^Document unavailable$/);
  assert.equal(reads, 0);
  assert.equal(closed, true);
});

async function many(f, count, extension) {
  for (let start = 0; start < count; start += 100)
    await Promise.all(Array.from({ length: Math.min(100, count - start) }, (_, n) =>
      f.put(`docs/f${String(start + n).padStart(5, '0')}.${extension}`)));
}

test('documents: 500-result cap and deterministic bounded result order', async t => {
  const f = await fixture(t);
  await many(f, 520, 'md');
  const result = await f.list();
  assert.equal(result.files.length, limits.files);
  assert.equal(result.truncated, true);
  assert.deepEqual(paths(result), Array.from({ length: limits.files }, (_, n) => `docs/f${String(n).padStart(5, '0')}.md`));
  assert.deepEqual(await f.list(), result);
});

test('documents: 4000-entry cap counts non-Markdown/hidden entries, bounded opendir, no readdir or other root scans', async t => {
  const f = await fixture(t);
  await many(f, limits.entries + 20, 'txt');
  await f.put('docs/.hidden.md', 'hidden');
  await f.put('notes/page.md', 'not reached after budget');
  await f.put('src/page.md', 'not scanned');
  const original = fs.opendir.bind(fs);
  let entries = 0, closed = 0;
  t.mock.method(fs, 'readdir', () => { throw Error('unbounded enumeration forbidden'); });
  t.mock.method(fs, 'opendir', async (name, options) => {
    assert.equal(name, path.join(f.root, 'docs'));
    assert.equal(options.bufferSize, 1);
    const dir = await original(name, options);
    return { read: async () => { const entry = await dir.read(); if (entry) entries++; return entry; },
      close: async () => { closed++; await dir.close(); } };
  });
  const result = await f.list();
  assert.deepEqual(result.files, []);
  assert.equal(result.truncated, true);
  assert.equal(entries, limits.entries - 6); // five fixed roots plus docs itself
  assert.equal(closed, 1);
});

test('documents: eight-component depth includes docs/notes and file, over-depth read rejects', async t => {
  const f = await fixture(t);
  const parent = 'docs/a/b/c/d/e/f';
  await f.put(`${parent}/ok.md`, 'at depth eight');
  await f.put(`${parent}/g/too-deep.md`, 'not scanned');
  const result = await f.list();
  assert.deepEqual(paths(result), [`${parent}/ok.md`]);
  assert.equal(result.truncated, true);
  assert.equal((await f.read(`${parent}/ok.md`)).content, 'at depth eight');
  await rejects(f.read(`${parent}/g/too-deep.md`));
});

test('documents: errors never expose absolute filesystem paths or outside content', async t => {
  const f = await fixture(t);
  for (const action of [{ action: 'read', path: 'docs/missing.md' }, { action: 'list', workspace: '/sensitive/absolute' }])
    await assert.rejects(documents(f.root, action), error => {
      assert.ok(!error.message.includes(f.root));
      assert.ok(!error.message.includes('sensitive'));
      assert.ok(!error.message.includes('ENOENT'));
      return true;
    });
});
