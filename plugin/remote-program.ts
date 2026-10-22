'use strict';
// Stringified and sent to Node over SSH. Keep every dependency inside this function.
function remoteProgram() {
  const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
  const { spawn } = require('node:child_process'), { TextDecoder } = require('node:util');
  const cap = { file: 262144, total: 8388608, files: 500, scan: 4000, depth: 8, input: 2097152, output: 12582912 };
  const roots = ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE.md', 'STATE.json'];
  const records = ['board.json', 'architecture.json', 'architecture-design.json', 'behavior-evidence.json'];
  const invisible = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
  const fail = (code: string) => { throw Error(code); };
  const hash = (bytes: any) => crypto.createHash('sha256').update(bytes).digest('hex');
  const utf8 = (bytes: any) => { const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); if (text.includes('\0')) fail('INVALID_TEXT'); return text; };
  function component(s: any) {
    return typeof s === 'string' && s && s === s.trim() && s !== '.' && s !== '..' && !s.endsWith('.') && s.normalize('NFKC') === s && !invisible.test(s) &&
      !/[\\/:%?*|"<>]/.test(s) && !/secret|password|credential|token|private|^id_(?:rsa|ed25519)|\.(?:pem|key|p12|pfx)$/i.test(s) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s);
  }
  function allowed(name: any, write = false) {
    if (typeof name !== 'string' || name.length > 2048) return false;
    const parts = name.split('/');
    if (parts.length > cap.depth || !parts.every((p: string, i: number) => i === 0 && p === '.governance' ? true : component(p) && !p.startsWith('.'))) return false;
    if (write) return roots.slice(0, 5).includes(name) || parts.length > 1 && ['docs', 'notes', 'changes'].includes(parts[0]) && name.endsWith('.md');
    return roots.includes(name) || parts.length === 2 && parts[0] === '.governance' && records.includes(parts[1]) || parts.length > 1 && ['docs', 'notes', 'changes'].includes(parts[0]) && name.endsWith('.md');
  }
  async function rootAt(value: any) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || invisible.test(value) || value.startsWith('\\\\?\\') || value.startsWith('\\\\.\\')) fail('INVALID_ROOT');
    const resolved = path.resolve(value); let cur = path.parse(resolved).root;
    for (const part of resolved.slice(cur.length).split(path.sep).filter(Boolean)) { cur = path.join(cur, part); const s = await fs.lstat(cur); if (s.isSymbolicLink() || !s.isDirectory()) fail('UNSAFE_ROOT'); }
    const real = await fs.realpath(resolved); if (real !== resolved) fail('UNSAFE_ROOT'); return real;
  }
  async function target(root: string, name: string, missing = false) {
    if (!allowed(name)) fail('INVALID_PATH'); let cur = root;
    const parts = name.split('/');
    for (let i = 0; i < parts.length; i++) {
      cur = path.join(cur, parts[i]);
      const siblings = await fs.opendir(path.dirname(cur), { bufferSize: 1 }); let count = 0;
      for await (const ent of siblings) { if (++count > cap.scan) fail('PATH_SCAN_LIMIT'); if (ent.name.toLowerCase() === parts[i].toLowerCase() && ent.name !== parts[i]) fail('PATH_ALIAS'); }
      let st; try { st = await fs.lstat(cur); } catch (e) { if (missing && i === parts.length - 1 && e.code === 'ENOENT') return cur; throw e; }
      if (st.isSymbolicLink() || (i < parts.length - 1 ? !st.isDirectory() : !st.isFile())) fail('UNSAFE_PATH');
    }
    return cur;
  }
  async function read(root: string, name: string) {
    const file = await target(root, name), before = await fs.lstat(file);
    if (before.size > cap.file) fail('FILE_LIMIT');
    const handle = await fs.open(file, 'r'); let bytes;
    try { const st = await handle.stat(); if (!st.isFile() || st.ino !== before.ino || st.dev !== before.dev || st.size > cap.file) fail('FILE_CHANGED'); const b = Buffer.alloc(cap.file + 1); const { bytesRead } = await handle.read(b, 0, b.length, 0); bytes = b.subarray(0, bytesRead); const after = await handle.stat(); if (bytesRead > cap.file || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail('FILE_CHANGED'); } finally { await handle.close(); }
    await target(root, name); const after = await fs.lstat(file); if (after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail('FILE_CHANGED');
    return { path: name, text: utf8(bytes), hash: hash(bytes) };
  }
  async function run(q: any) {
    if (!q || q.version !== 1 || !['probe', 'read', 'write', 'snapshot', 'exec'].includes(q.action) || !['linux', 'win32'].includes(q.platform) || process.platform !== q.platform || Number(process.versions.node.split('.')[0]) < 22) fail('INVALID_REQUEST');
    const keys = { probe: [], read: ['path'], write: ['path', 'text', 'expectedHash', 'confirmed', 'expectedRoot'], snapshot: [], exec: ['file', 'args', 'confirmed', 'expectedRoot'] }[q.action];
    if (Object.keys(q).some(k => !['version', 'action', 'root', 'platform', ...keys].includes(k))) fail('INVALID_REQUEST');
    const root = await rootAt(q.root);
    if (q.action === 'probe') return { root, platform: process.platform, nodeVersion: process.versions.node };
    if (q.action === 'read') return { root, ...await read(root, q.path) };
    if (q.action === 'snapshot') {
      let scanned = 0, total = 0, truncated = false; const files = [], names = new Set<string>();
      async function add(name: string) {
        if (files.length >= cap.files) { truncated = true; return; }
        try { const item = await read(root, name), size = Buffer.byteLength(item.text); if (total + size > cap.total) { truncated = true; return; } total += size; files.push(item); } catch (e) { if (e.code !== 'ENOENT') truncated = true; }
      }
      for (const name of [...roots, ...records.map(r => '.governance/' + r)]) await add(name);
      async function walk(prefix: string, depth: number) {
        let dir; try { const s = await fs.lstat(path.join(root, prefix)); if (!s.isDirectory() || s.isSymbolicLink()) { truncated = true; return; } dir = await fs.opendir(path.join(root, prefix), { bufferSize: 1 }); } catch (e) { if (e.code !== 'ENOENT') truncated = true; return; }
        try { for await (const ent of dir) {
          if (++scanned > cap.scan) { truncated = true; break; }
          const name = prefix + '/' + ent.name; if (!component(ent.name) || ent.name.startsWith('.')) continue;
          const alias = name.toLowerCase(); if (names.has(alias)) fail('PATH_ALIAS'); names.add(alias);
          if (ent.isSymbolicLink()) { truncated = true; continue; }
          if (ent.isDirectory()) { if (depth < cap.depth - 1) await walk(name, depth + 1); else truncated = true; }
          else if (ent.isFile() && allowed(name)) await add(name);
          if (scanned > cap.scan || files.length >= cap.files) { truncated = true; break; }
        } } finally { try { await dir.close(); } catch {} }
      }
      for (const prefix of ['docs', 'notes', 'changes']) { if (scanned <= cap.scan && files.length < cap.files) await walk(prefix, 1); else truncated = true; }
      // Re-read the bounded set: reject changes during collection rather than mixing generations.
      for (const item of files) if ((await read(root, item.path)).hash !== item.hash) fail('SNAPSHOT_CHANGED');
      if (await rootAt(root) !== root) fail('ROOT_CHANGED');
      return { root, platform: process.platform, files: files.sort((a, b) => a.path < b.path ? -1 : 1), truncated };
    }
    if (q.confirmed !== true || q.expectedRoot !== root) fail('CONFIRMATION_REQUIRED');
    if (q.action === 'write') {
      if (!allowed(q.path, true) || typeof q.text !== 'string' || Buffer.byteLength(q.text) > cap.file || q.text.includes('\0') || !Object.hasOwn(q, 'expectedHash') || q.expectedHash !== null && !/^[a-f0-9]{64}$/.test(q.expectedHash)) fail('INVALID_WRITE');
      const bytes = Buffer.from(q.text); if (utf8(bytes) !== q.text) fail('INVALID_TEXT');
      const lock = path.join(root, '.remote-write.lock'), handle = await fs.open(lock, 'wx', 0o600); let temp;
      try {
        const file = await target(root, q.path, true); let actual = null;
        try { actual = (await read(root, q.path)).hash; } catch (e) { if (e.code !== 'ENOENT') throw e; }
        if (actual !== q.expectedHash) fail('STALE_FILE');
        temp = path.join(path.dirname(file), '.remote-' + crypto.randomBytes(12).toString('hex') + '.tmp');
        await fs.writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
        await target(root, q.path, true); let latest = null;
        try { latest = (await read(root, q.path)).hash; } catch (e) { if (e.code !== 'ENOENT') throw e; }
        if (latest !== actual) fail('STALE_FILE'); await fs.rename(temp, file); temp = null;
        return { root, path: q.path, hash: hash(bytes), written: true };
      } finally { if (temp) await fs.unlink(temp).catch(() => {}); await handle.close(); await fs.unlink(lock); }
    }
    if (typeof q.file !== 'string' || !q.file || q.file.length > 2048 || invisible.test(q.file) || !Array.isArray(q.args) || q.args.length > 128 || q.args.some(a => typeof a !== 'string' || a.includes('\0')) || Buffer.byteLength(JSON.stringify(q.args)) > 65536) fail('INVALID_COMMAND');
    return await new Promise((resolve, reject) => {
      let child, size = 0, truncated = false, stdout = '', stderr = '', settled = false;
      const finish = (err: any, result?: any) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(result); };
      const timer = setTimeout(() => { child?.kill(); finish(Error('COMMAND_TIMEOUT_UNKNOWN')); }, 30000);
      try { child = spawn(q.file, q.args, { cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { finish(Error('COMMAND_FAILED')); return; }
      const collect = (which: string, b: any) => { const room = Math.max(0, 1048576 - size), chunk = b.subarray(0, room).toString('utf8'); size += b.length; if (size > 1048576) truncated = true; if (which === 'stdout') stdout += chunk; else stderr += chunk; };
      child.stdout.on('data', b => collect('stdout', b)); child.stderr.on('data', b => collect('stderr', b));
      child.once('error', () => finish(Error('COMMAND_FAILED'))); child.once('close', code => finish(null, { root, code, stdout, stderr, truncated }));
    });
  }
  let input = [], size = 0, done = false;
  const finish = (value: any) => { if (done) return; done = true; clearTimeout(timer); const text = JSON.stringify(value); process.stdout.write(Buffer.byteLength(text) <= cap.output ? text : '{"version":1,"ok":false,"error":"OUTPUT_LIMIT"}'); };
  const timer = setTimeout(() => { finish({ version: 1, ok: false, error: 'REQUEST_TIMEOUT_UNKNOWN' }); process.exitCode = 1; process.stdin.destroy(); }, 35000);
  process.stdin.on('data', b => { size += b.length; if (size > cap.input) { finish({ version: 1, ok: false, error: 'INPUT_LIMIT' }); process.stdin.destroy(); } else input.push(b); });
  process.stdin.on('end', async () => { if (done) return; try { finish({ version: 1, ok: true, result: await run(JSON.parse(utf8(Buffer.concat(input)))) }); } catch (e) { const safe = /^[A-Z_]{3,40}$/.test(e.message) ? e.message : 'REMOTE_OPERATION_FAILED'; finish({ version: 1, ok: false, error: safe }); } });
  process.stdin.on('error', () => finish({ version: 1, ok: false, error: 'INPUT_FAILED' }));
}
export { remoteProgram };
