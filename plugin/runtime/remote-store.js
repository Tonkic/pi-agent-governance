'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.binding = exports.hash = exports.RemoteStore = void 0;
exports.profileOK = profileOK;
exports.seal = seal;
exports.unseal = unseal;
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
const exec = promisify(execFile), derive = promisify(crypto.scrypt);
const hash = (x) => crypto.createHash('sha256').update(x).digest('hex');
exports.hash = hash;
const fail = (code) => { throw Error(code); };
const idOK = (s) => typeof s === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(s);
const fpOK = (s) => typeof s === 'string' && /^SHA256:[A-Za-z0-9+/]{43}$/.test(s);
function profileOK(p) {
    if (!p || !idOK(p.id) || Object.keys(p).some(k => !['id', 'host', 'port', 'username', 'platform', 'directory'].includes(k)) || typeof p.host !== 'string' || !/^[A-Za-z0-9.:[\]_-]{1,253}$/.test(p.host) || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535 || typeof p.username !== 'string' || !p.username || p.username.length > 256 || /[\p{C}]/u.test(p.username) || !['linux', 'win32'].includes(p.platform) || p.directory !== undefined && (typeof p.directory !== 'string' || p.directory.length > 2048 || /[\p{C}]/u.test(p.directory)))
        fail('INVALID_PROFILE');
    if (p.directory !== undefined && !(p.platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(p.directory) : p.directory.startsWith('/')))
        fail('ABSOLUTE_REMOTE_DIRECTORY_REQUIRED');
    return p;
}
const binding = (p) => hash(JSON.stringify([p.host, p.port, p.username, p.platform]));
exports.binding = binding;
async function seal(password, passphrase, aad) {
    if (typeof password !== 'string' || !password || Buffer.byteLength(password) > 4096 || typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024)
        fail('PASSWORD_AND_12_CHARACTER_PASSPHRASE_REQUIRED');
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = await derive(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 67108864 });
    try {
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(Buffer.from(aad));
        const data = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
        return { version: 1, mode: 'encrypted', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
    }
    finally {
        key.fill(0);
    }
}
async function unseal(e, passphrase, aad) {
    try {
        if (!e || e.version !== 1)
            throw Error();
        if (e.mode === 'plaintext') {
            if (Object.keys(e).length !== 3 || typeof e.password !== 'string' || !e.password || Buffer.byteLength(e.password) > 4096)
                throw Error();
            return e.password;
        }
        if (e.mode !== 'encrypted' || Object.keys(e).length !== 6 || typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024)
            throw Error();
        const bytes = (s, length) => { if (typeof s !== 'string' || s.length > 8192 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s))
            throw Error(); const b = Buffer.from(s, 'base64'); if (b.toString('base64') !== s || length && b.length !== length)
            throw Error(); return b; };
        const salt = bytes(e.salt, 16), iv = bytes(e.iv, 12), tag = bytes(e.tag, 16), data = bytes(e.data);
        const key = await derive(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 67108864 });
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAAD(Buffer.from(aad));
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
        }
        finally {
            key.fill(0);
        }
    }
    catch {
        fail('CREDENTIAL_UNLOCK_FAILED');
    }
}
class RemoteStore {
    root;
    directory;
    constructor(root) { if (typeof root !== 'string' || !path.isAbsolute(root))
        fail('ABSOLUTE_LOCAL_WORKSPACE_REQUIRED'); this.root = path.resolve(root); this.directory = path.join(this.root, '.remote-local'); }
    async safe(relative = '', createDirs = false) {
        let cur = path.parse(this.root).root;
        for (const part of this.root.slice(cur.length).split(path.sep).filter(Boolean)) {
            cur = path.join(cur, part);
            const st = await fs.lstat(cur);
            if (!st.isDirectory() || st.isSymbolicLink())
                fail('UNSAFE_LOCAL_ROOT');
        }
        if (await fs.realpath(this.root) !== this.root)
            fail('UNSAFE_LOCAL_ROOT');
        const parts = ['.remote-local', ...relative.split('/').filter(Boolean)];
        if (parts.some(p => p === '.' || p === '..' || !/^[A-Za-z0-9._-]+$/.test(p)))
            fail('UNSAFE_LOCAL_PATH');
        cur = this.root;
        for (let i = 0; i < parts.length; i++) {
            cur = path.join(cur, parts[i]);
            try {
                const st = await fs.lstat(cur);
                if (st.isSymbolicLink() || i < parts.length - 1 && !st.isDirectory())
                    fail('UNSAFE_LOCAL_PATH');
            }
            catch (e) {
                if (e.code !== 'ENOENT')
                    throw e;
                if (createDirs && (i < parts.length - 1 || !relative))
                    await fs.mkdir(cur, { mode: 0o700 });
                else if (i < parts.length - 1)
                    throw e;
            }
        }
        return cur;
    }
    async read(relative, optional = false) {
        try {
            const file = await this.safe(relative), st = await fs.lstat(file);
            if (!st.isFile() || st.size > 12582912)
                fail('LOCAL_FILE_LIMIT');
            const handle = await fs.open(file, 'r');
            try {
                const b = Buffer.alloc(Math.min(st.size + 1, 12582913)), r = await handle.read(b, 0, b.length, 0);
                if (r.bytesRead !== st.size)
                    fail('LOCAL_FILE_CHANGED');
                return JSON.parse(b.subarray(0, r.bytesRead).toString('utf8'));
            }
            finally {
                await handle.close();
            }
        }
        catch (e) {
            if (optional && e.code === 'ENOENT')
                return null;
            throw e;
        }
    }
    async atomic(relative, value, exclusive = false) {
        const file = await this.safe(relative, true), text = JSON.stringify(value, null, 2) + '\n';
        if (Buffer.byteLength(text) > 12582912)
            fail('LOCAL_FILE_LIMIT');
        if (exclusive) {
            await fs.writeFile(file, text, { flag: 'wx', mode: 0o600 });
            return;
        }
        const tmpRel = relative + '.' + crypto.randomBytes(8).toString('hex') + '.tmp', tmp = await this.safe(tmpRel, true);
        try {
            await fs.writeFile(tmp, text, { flag: 'wx', mode: 0o600 });
            await this.safe(relative);
            await fs.rename(tmp, file);
        }
        finally {
            await fs.unlink(tmp).catch(() => { });
        }
    }
    async lock(callback) {
        const file = await this.safe('operation.lock', true), handle = await fs.open(file, 'wx', 0o600);
        try {
            return await callback();
        }
        finally {
            await handle.close();
            await fs.unlink(file);
        }
    }
    async guardGit() {
        let inside = false;
        try {
            await exec('git', ['rev-parse', '--show-toplevel'], { cwd: this.root, timeout: 10000, windowsHide: true });
            inside = true;
        }
        catch (e) {
            if (e.code === 'ENOENT')
                fail('GIT_REQUIRED_FOR_CREDENTIAL_GUARD');
            if (!String(e.stderr || '').includes('not a git repository'))
                fail('GIT_GUARD_FAILED');
        }
        if (!inside)
            return;
        const tracked = await exec('git', ['ls-files', '-z', '--', '.remote-local'], { cwd: this.root, timeout: 10000, windowsHide: true });
        if (tracked.stdout)
            fail('PRIVATE_DIRECTORY_ALREADY_TRACKED');
        try {
            await exec('git', ['check-ignore', '--no-index', '-q', '--', '.remote-local/'], { cwd: this.root, timeout: 10000, windowsHide: true });
        }
        catch {
            fail('ADD_REMOTE_LOCAL_TO_GITIGNORE_FIRST');
        }
    }
    async profiles() {
        const data = await this.read('connections.json', true);
        if (!data)
            return [];
        if (data.version !== 1 || !Array.isArray(data.profiles) || data.profiles.length > 32)
            fail('INVALID_CONNECTIONS');
        const ids = new Set();
        for (const p of data.profiles) {
            profileOK(p);
            if (ids.has(p.id))
                fail('INVALID_CONNECTIONS');
            ids.add(p.id);
        }
        return data.profiles;
    }
    async profile(id) { const p = (await this.profiles()).find(x => x.id === id); if (!p)
        fail('UNKNOWN_PROFILE'); return p; }
    async configure(p, password, passphrase, plaintext = false, confirmed = false) {
        profileOK(p);
        if (!confirmed || typeof password !== 'string' || !password || Buffer.byteLength(password) > 4096)
            fail('CONFIRMED_PASSWORD_REQUIRED');
        await this.guardGit();
        const envelope = plaintext ? { version: 1, mode: 'plaintext', password } : await seal(password, passphrase, binding(p));
        return await this.lock(async () => { const profiles = await this.profiles(); if (profiles.some(x => x.id === p.id))
            fail('PROFILE_EXISTS_USE_NEW_ID'); if (profiles.length >= 32)
            fail('PROFILE_LIMIT'); await this.atomic('credentials/' + p.id + '.json', envelope, true); await this.atomic('connections.json', { version: 1, profiles: [...profiles, p] }); return { configured: true, id: p.id, credentialMode: plaintext ? 'plaintext' : 'encrypted' }; });
    }
    async password(p, passphrase) { await this.guardGit(); return await unseal(await this.read('credentials/' + p.id + '.json'), passphrase, binding(p)); }
    async hosts() { const d = await this.read('known-hosts.json', true); if (!d)
        return { version: 1, hosts: {} }; if (d.version !== 1 || !d.hosts || Array.isArray(d.hosts) || typeof d.hosts !== 'object' || Object.keys(d.hosts).length > 64 || Object.entries(d.hosts).some(([k, v]) => !/^[a-f0-9]{64}$/.test(k) || !fpOK(v)))
        fail('INVALID_KNOWN_HOSTS'); return d; }
    hostKey(p) { return hash(JSON.stringify([p.host, p.port])); }
    async trusted(p) { return (await this.hosts()).hosts[this.hostKey(p)] || null; }
    async trust(p, fingerprint, confirmed) {
        if (!confirmed || !fpOK(fingerprint))
            fail('CONFIRMED_FINGERPRINT_REQUIRED');
        return this.lock(async () => { const d = await this.hosts(), key = this.hostKey(p); if (d.hosts[key] && d.hosts[key] !== fingerprint)
            fail('HOST_KEY_CHANGED_USE_NEW_PROFILE_AND_REVIEW'); d.hosts[key] = fingerprint; await this.atomic('known-hosts.json', d); return { trusted: true, fingerprint }; });
    }
    backupKey(p, root) { return hash(JSON.stringify([binding(p), root])); }
    async journal(p, root, value) { const name = 'journals/' + this.backupKey(p, root) + '.json'; if (value)
        await this.atomic(name, { version: 1, ...value }); return await this.read(name, true); }
    async saveSnapshot(p, data, password) {
        const { validateSnapshot } = require('./remote-ssh');
        validateSnapshot(data, p);
        if (password && data.files.some(f => f.text.includes(password)))
            fail('PASSWORD_FOUND_IN_BACKUP');
        const key = this.backupKey(p, data.root), stamp = Date.now() + '-' + crypto.randomBytes(6).toString('hex');
        const name = 'backups/' + key + '/' + stamp + '.json';
        await this.atomic(name, { version: 1, source: { host: p.host, port: p.port, username: p.username, platform: p.platform, directory: data.root }, savedAt: new Date().toISOString(), readOnly: true, root: data.root, platform: data.platform, files: data.files, truncated: data.truncated }, true);
        await this.atomic('latest/' + key + '.json', { version: 1, snapshot: name });
        return { snapshot: '.remote-local/' + name, files: data.files.length, partial: data.truncated, readOnly: true };
    }
    async offline(p, root, file) {
        const key = this.backupKey(p, root), pointer = await this.read('latest/' + key + '.json');
        if (pointer.version !== 1 || typeof pointer.snapshot !== 'string' || !new RegExp('^backups/' + key + '/[0-9]+-[a-f0-9]{12}\\.json$').test(pointer.snapshot))
            fail('INVALID_BACKUP_POINTER');
        const snap = await this.read(pointer.snapshot);
        require('./remote-ssh').validateSnapshot(snap, p);
        if (snap.root !== root || snap.readOnly !== true || !snap.source || snap.source.directory !== root || snap.source.host !== p.host || snap.source.port !== p.port || snap.source.username !== p.username)
            fail('BACKUP_IDENTITY_MISMATCH');
        return file === undefined ? { offline: true, readOnly: true, savedAt: snap.savedAt, partial: snap.truncated, files: snap.files.map(f => ({ path: f.path, hash: f.hash })) } : { offline: true, readOnly: true, savedAt: snap.savedAt, file: snap.files.find(f => f.path === file) || fail('FILE_NOT_IN_BACKUP') };
    }
}
exports.RemoteStore = RemoteStore;
