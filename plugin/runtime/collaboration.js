'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.authority = authority;
exports.bindingOK = bindingOK;
exports.collaborate = collaborate;
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { collaborationProgram } = require('./collaboration-program');
const exec = promisify(execFile);
const fail = (code) => { throw Error(code); };
function bindingOK(b) {
    if (!b ||
        Object.keys(b).some((k) => !['version', 'repository', 'branch'].includes(k)) ||
        b.version !== 1 ||
        typeof b.repository !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(b.repository) ||
        b.repository.endsWith('.git') ||
        typeof b.branch !== 'string' ||
        b.branch.length > 160 ||
        !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(b.branch) ||
        b.branch.includes('..') ||
        b.branch.includes('//') ||
        b.branch.split('/').some((x) => !x || x.startsWith('.') || x.endsWith('.') || x.endsWith('.lock')))
        fail('INVALID_GITHUB_BINDING');
    return b;
}
class LocalBindingStore {
    root;
    constructor(workspace) {
        if (typeof workspace !== 'string' || !path.isAbsolute(workspace))
            fail('ABSOLUTE_LOCAL_WORKSPACE_REQUIRED');
        this.root = path.resolve(workspace);
    }
    async safe(relative = '', createDirs = false) {
        let cur = path.parse(this.root).root;
        for (const part of this.root.slice(cur.length).split(path.sep).filter(Boolean)) {
            cur = path.join(cur, part);
            const st = await fs.lstat(cur);
            if (!st.isDirectory() || st.isSymbolicLink())
                fail('UNSAFE_LOCAL_ROOT');
        }
        if ((await fs.realpath(this.root)) !== this.root)
            fail('UNSAFE_LOCAL_ROOT');
        const parts = ['.remote-local', ...relative.split('/').filter(Boolean)];
        if (parts.some((p) => p === '.' || p === '..' || !/^[A-Za-z0-9._-]+$/.test(p)))
            fail('UNSAFE_LOCAL_PATH');
        cur = this.root;
        for (let i = 0; i < parts.length; i++) {
            cur = path.join(cur, parts[i]);
            try {
                const st = await fs.lstat(cur);
                if (st.isSymbolicLink() || (i < parts.length - 1 && !st.isDirectory()))
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
    async read(relative) {
        const file = await this.safe(relative);
        const st = await fs.lstat(file);
        if (!st.isFile() || st.size > 65536)
            fail('LOCAL_FILE_LIMIT');
        return JSON.parse(await fs.readFile(file, 'utf8'));
    }
    async writeExclusive(relative, value) {
        const file = await this.safe(relative, true);
        const text = JSON.stringify(value, null, 2) + '\n';
        if (Buffer.byteLength(text) > 65536)
            fail('LOCAL_FILE_LIMIT');
        const tmp = await this.safe(relative + '.' + crypto.randomBytes(8).toString('hex') + '.tmp', true);
        try {
            await fs.writeFile(tmp, text, { flag: 'wx', mode: 0o600 });
            await fs.rename(tmp, file);
        }
        finally {
            await fs.unlink(tmp).catch(() => { });
        }
    }
    async lock(callback) {
        const file = await this.safe('operation.lock', true);
        const handle = await fs.open(file, 'wx', 0o600);
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
}
async function readBinding(store) {
    try {
        const file = await store.safe('github.json');
        await fs.lstat(file);
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return null;
        throw e;
    }
    return bindingOK(await store.read('github.json'));
}
async function authority(store) {
    // A malformed or unreachable GitHub binding is never treated as absence.
    const b = await readBinding(store);
    if (b !== null)
        return { authority: 'github', ...bindingOK(b), available: 'unchecked' };
    return { authority: 'local', root: store.root, available: true };
}
async function collaborate(workspace, action, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        fail('INVALID_INPUT');
    const allowed = {
        authority: [],
        bind: ['repository', 'branch', 'token', 'confirmed'],
        inspect: ['token'],
        read: ['token', 'path'],
        publish: ['token', 'expectedHead', 'target', 'confirmed'],
        reconcile: ['token']
    };
    const keys = allowed[action];
    if (!keys || Object.keys(input).some((k) => !keys.includes(k)))
        fail('INVALID_INPUT');
    const store = new LocalBindingStore(workspace);
    if (action === 'bind') {
        if (input.confirmed !== true)
            fail('CONFIRMATION_REQUIRED');
        const b = bindingOK({ version: 1, repository: input.repository, branch: input.branch });
        await store.guardGit();
        return store.lock(async () => {
            if ((await readBinding(store)) !== null)
                fail('GITHUB_ALREADY_BOUND');
            const inspected = await collaborationProgram({
                root: store.root,
                action: 'inspect',
                repository: b.repository,
                branch: b.branch,
                token: input.token
            });
            await store.writeExclusive('github.json', b);
            return { ...inspected, bound: true };
        });
    }
    const selected = await authority(store);
    if (action === 'authority')
        return selected;
    if (selected.authority !== 'github') {
        if (action === 'inspect')
            return selected;
        if (action !== 'read')
            fail('GITHUB_BINDING_REQUIRED');
        const r = await require('./documents').documents(store.root, { action: 'read', path: input.path });
        return { authority: 'local', result: r };
    }
    return collaborationProgram({
        root: store.root,
        action,
        repository: selected.repository,
        branch: selected.branch,
        token: input.token,
        ...(action === 'read' ? { path: input.path } : {}),
        ...(action === 'publish' ? { expectedHead: input.expectedHead, target: input.target, confirmed: input.confirmed } : {})
    });
}
