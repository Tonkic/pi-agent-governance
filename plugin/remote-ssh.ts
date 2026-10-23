'use strict';
const crypto = require('node:crypto'), path = require('node:path');
const { remoteProgram } = require('./remote-program'), { profileOK, hash } = require('./remote-store');
const fingerprint = (key: any) => 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
// Constant cross-shell command: neither passwords, remote paths nor user commands are interpolated.
const bootstrap = `node -e "let b=[],n=0;process.stdin.on('data',x=>{n+=x.length;if(n>2200000)process.exit(2);b.push(x)});process.stdin.on('end',()=>{let q=JSON.parse(Buffer.concat(b));Object.defineProperty(process,'stdin',{value:require('stream').Readable.from([Buffer.from(JSON.stringify(q.request))])});eval(q.program)})"`;
const rootOK = (root: any, p: any) => typeof root === 'string' && root.length <= 2048 && !/[\p{C}]/u.test(root) && (p.platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(root) && !root.startsWith('\\\\') : root.startsWith('/'));
const normalized = (root: string, p: any) => (p.platform === 'win32' ? path.win32 : path.posix).resolve(root);
function backupPath(name: any) {
  if (typeof name !== 'string' || name.length > 2048) return false;
  const parts = name.split('/');
  if (parts.length > 8 || !parts.every((s, i) => i === 0 && s === '.governance' || s && s === s.trim() && !s.startsWith('.') && !s.endsWith('.') && s.normalize('NFKC') === s && !/[\p{C}\\/:%?*|"<>]/u.test(s) && !/secret|password|credential|token|private|^id_(rsa|ed25519)|\.(pem|key|p12|pfx)$/i.test(s) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s))) return false;
  return ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE.md', 'STATE.json'].includes(name) || parts.length > 1 && ['docs', 'notes', 'changes'].includes(parts[0]) && name.endsWith('.md') || parts.length === 2 && parts[0] === '.governance' && ['board.json', 'architecture.json', 'architecture-design.json', 'behavior-evidence.json'].includes(parts[1]);
}
function validateSnapshot(data: any, p: any) {
  if (!data || !rootOK(data.root, p) || data.platform !== p.platform || typeof data.truncated !== 'boolean' || !Array.isArray(data.files) || data.files.length > 500) throw Error('INVALID_SNAPSHOT');
  let total = 0; const seen = new Set();
  for (const f of data.files) {
    if (!f || !backupPath(f.path) || typeof f.text !== 'string' || f.text.includes('\0') || !/^[a-f0-9]{64}$/.test(f.hash) || Buffer.byteLength(f.text) > 262144 || hash(Buffer.from(f.text)) !== f.hash || seen.has(f.path.toLowerCase()) || (total += Buffer.byteLength(f.text)) > 8388608) throw Error('INVALID_SNAPSHOT');
    seen.add(f.path.toLowerCase());
  }
}
function client() { try { return new (require('./ssh-runtime').Client)(); } catch { throw Error('SSH_RUNTIME_DEPENDENCY_MISSING_INSTALL_PORTABLE_PACKAGE'); } }
async function discover(p: any) {
  profileOK(p);
  return new Promise((resolve, reject) => {
    const c = client(); let observed, settled = false;
    const timer = setTimeout(() => finish(), 15000);
    const finish = () => { if (settled) return; settled = true; clearTimeout(timer); c.destroy(); observed ? resolve({ fingerprint: observed, verified: false, instruction: 'Verify this fingerprint with the server owner before trust. No password was sent.' }) : reject(Error('SSH_FINGERPRINT_UNAVAILABLE')); };
    c.on('error', finish); c.on('close', finish);
    try { c.connect({ host: p.host, port: p.port, username: p.username, readyTimeout: 12000, authHandler: ['none'], hostVerifier: (key: any) => { observed = fingerprint(key); return false; } }); } catch { finish(); }
  });
}
async function connect(p: any, password: string, trusted: string) {
  profileOK(p); if (!trusted) throw Error('HOST_FINGERPRINT_NOT_TRUSTED');
  return new Promise<any>((resolve, reject) => {
    const c = client(); let ready = false, mismatch = false;
    const timer = setTimeout(() => { c.destroy(); reject(Error('SSH_CONNECTION_FAILED')); }, 20000);
    c.on('error', () => { clearTimeout(timer); if (!ready) reject(Error(mismatch ? 'HOST_FINGERPRINT_CHANGED' : 'SSH_CONNECTION_FAILED')); });
    c.once('close', () => { clearTimeout(timer); if (!ready) reject(Error(mismatch ? 'HOST_FINGERPRINT_CHANGED' : 'SSH_CONNECTION_FAILED')); });
    c.once('ready', () => { ready = true; clearTimeout(timer); resolve(c); });
    try { c.connect({ host: p.host, port: p.port, username: p.username, password, authHandler: ['password'], tryKeyboard: false, readyTimeout: 15000, keepaliveInterval: 10000, keepaliveCountMax: 2, hostVerifier: (key: any) => { mismatch = fingerprint(key) !== trusted; return !mismatch; } }); } catch { clearTimeout(timer); c.destroy(); reject(Error('SSH_CONNECTION_FAILED')); }
  });
}
async function rpc(c: any, q: any, collaboration = false) {
  if (Buffer.byteLength(JSON.stringify(q)) > 2097152) throw Error('INPUT_LIMIT');
  return new Promise<any>((resolve, reject) => {
    let stream, settled = false, chunks = [], size = 0, stderrSize = 0;
    const finish = (error?: any, result?: any) => { if (settled) return; settled = true; clearTimeout(timer); stream?.close(); c.removeListener('close', gone); c.removeListener('error', gone); error ? reject(error) : resolve(result); };
    const gone = () => finish(Error('REMOTE_RESULT_UNKNOWN'));
    const timer = setTimeout(gone, 45000); c.once('close', gone); c.once('error', gone);
    c.exec(bootstrap, { pty: false }, (error: any, s: any) => {
      if (error) return gone(); stream = s;
      stream.on('data', b => { size += b.length; if (size > 12582912) gone(); else chunks.push(b); });
      stream.stderr.on('data', b => { stderrSize += b.length; if (stderrSize > 65536) gone(); });
      stream.once('error', gone);
      stream.once('close', (code: any) => {
        try { if (code !== 0) return gone(); const raw = Buffer.concat(chunks), text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw), response = JSON.parse(text); if (!response || response.version !== 1 || typeof response.ok !== 'boolean') return gone();
          if (!response.ok) { const e: any = Error(/^[A-Z_]{3,40}$/.test(response.error) ? response.error : 'REMOTE_REJECTED'); e.rejected = true; return finish(e); } finish(null, response.result);
        } catch { gone(); }
      });
      const program = collaboration ? require('./collaboration-program').collaborationProgram : remoteProgram;
      stream.end(JSON.stringify({ program: '(' + program.toString() + ')()', request: q }));
    });
  });
}
async function operation(store: any, id: string, input: any) {
  const p = await store.profile(id), root = input.root ?? p.directory;
  if (!rootOK(root, p)) throw Error('ABSOLUTE_REMOTE_DIRECTORY_REQUIRED');
  const base = { version: 1, root, platform: p.platform };
  const action = input.action;
  if (!['probe', 'read', 'write', 'exec', 'sync', 'offline', 'resolve'].includes(action)) throw Error('INVALID_ACTION');
  if (action === 'offline') return store.offline(p, normalized(root, p), input.path);
  if (action === 'resolve') { if (input.confirmed !== true) throw Error('CONFIRMATION_REQUIRED'); return store.lock(async () => { const previous = await store.journal(p, normalized(root, p)); if (!previous || previous.status !== 'unknown') throw Error('NO_UNKNOWN_OPERATION'); return store.journal(p, normalized(root, p), { ...previous, status: 'resolved', resolvedAt: new Date().toISOString() }); }); }
  const mutation = ['write', 'exec'].includes(action);
  if (mutation && input.confirmed !== true) throw Error('CONFIRMATION_REQUIRED');
  return store.lock(async () => {
    await store.guardGit(); const trusted = await store.trusted(p); if (!trusted) throw Error('HOST_FINGERPRINT_NOT_TRUSTED');
    let password = await store.password(p, input.passphrase), c;
    try {
      c = await connect(p, password, trusted);
      const probe = await rpc(c, { ...base, action: 'probe' });
      if (!probe || probe.platform !== p.platform || probe.root !== normalized(root, p)) throw Error('REMOTE_ROOT_MISMATCH');
      const q: any = { ...base, root: probe.root, action: action === 'sync' ? 'snapshot' : action };
      if (action === 'probe') return probe;
      if (action === 'read') { q.path = input.path; const r = await rpc(c, q); if (!r || r.root !== probe.root || r.path !== input.path || typeof r.text !== 'string' || Buffer.byteLength(r.text) > 262144 || hash(Buffer.from(r.text)) !== r.hash) throw Error('INVALID_READ_RESPONSE'); return redact(r, password); }
      if (mutation) {
        const old = await store.journal(p, probe.root); if (old?.status === 'unknown') throw Error('PREVIOUS_RESULT_UNKNOWN_RECONCILE_FIRST');
        q.confirmed = true; q.expectedRoot = probe.root;
        if (action === 'write') { q.path = input.path; q.text = input.text; q.expectedHash = input.expectedHash; }
        else { q.file = input.file; q.args = input.args; }
        await store.journal(p, probe.root, { status: 'unknown', action, startedAt: new Date().toISOString() });
        let result;
        try { result = await rpc(c, q); } catch (e) { if (e.rejected && ['STALE_FILE', 'INVALID_PATH', 'INVALID_WRITE', 'INVALID_TEXT', 'CONFIRMATION_REQUIRED', 'INVALID_REQUEST', 'INVALID_COMMAND'].includes(e.message)) await store.journal(p, probe.root, { status: 'rejected', action }); throw e; }
        if (!result || result.root !== probe.root || (action === 'write' ? result.written !== true || result.path !== input.path || result.hash !== hash(Buffer.from(input.text)) : !Number.isInteger(result.code))) throw Error('REMOTE_RESULT_UNKNOWN');
        await store.journal(p, probe.root, { status: 'saved-backup-pending', action, savedAt: new Date().toISOString() });
        try { const snapshot = await rpc(c, { ...base, root: probe.root, action: 'snapshot' }); if (snapshot.root !== probe.root) throw Error(); const backup = await store.saveSnapshot(p, snapshot, password); await store.journal(p, probe.root, { status: 'saved', action, savedAt: new Date().toISOString(), backup: backup.snapshot }); return redact({ remoteSaved: true, result, backup }, password); }
        catch { return redact({ remoteSaved: true, result, backupPending: true, instruction: 'Run sync only. Do not replay the remote operation.' }, password); }
      }
      const snapshot = await rpc(c, q); if (snapshot?.root !== probe.root) throw Error('REMOTE_ROOT_MISMATCH'); const backup = await store.saveSnapshot(p, snapshot, password);
      const previous = await store.journal(p, probe.root); if (previous?.status === 'saved-backup-pending') await store.journal(p, probe.root, { ...previous, status: 'saved', backup: backup.snapshot });
      return backup;
    } finally { password = ''; c?.end(); c?.destroy(); }
  });
}
function redact(value: any, password: string): any { if (!password) return value; if (typeof value === 'string') return value.split(password).join('[REDACTED]'); if (Array.isArray(value)) return value.map(x => redact(x, password)); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, password)])); return value; }
export { discover, connect, rpc, operation, fingerprint, bootstrap, validateSnapshot, backupPath, rootOK, redact };
