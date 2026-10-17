'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const limits = Object.freeze({ files: 500, entries: 4000, depth: 8, bytes: 262144 });
const rootFiles = ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE.md'];
const invisible = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const sensitive = /secret|credential|token|private|^(?:node_modules|id_rsa|id_ed25519)(?:\.|$)|\.(?:pem|key|p12|pfx)(?:\.|$)/i;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function component(value) {
    return !!value && value === value.trim() && !value.startsWith('.') &&
        !value.endsWith('.') && !invisible.test(value) && value.normalize('NFKC') === value &&
        !/[\\/:%?*|"<>]/.test(value) && !sensitive.test(value) &&
        !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value);
}
function documentPath(value) {
    if (typeof value !== 'string' || value.length > 2048 || path.isAbsolute(value))
        throw Error('Invalid document path');
    const parts = value.split('/');
    if (!parts.every(component) || parts.length > limits.depth ||
        !(rootFiles.includes(value) ||
            (parts.length >= 2 && ['docs', 'notes'].includes(parts[0]) && value.endsWith('.md'))))
        throw Error('Invalid document path');
    return value;
}
function request(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(payload)))
        throw Error('Invalid documents request');
    if (Reflect.ownKeys(payload).some(key => typeof key !== 'string' || !Object.hasOwn(Object.getOwnPropertyDescriptor(payload, key), 'value')))
        throw Error('Invalid documents request');
    const allowed = payload.action === 'list' ? ['action', 'workspace'] :
        payload.action === 'read' ? ['action', 'path', 'workspace'] : [];
    if (!allowed.length || Reflect.ownKeys(payload).some(key => !allowed.includes(key)) ||
        !Object.hasOwn(payload, 'action') ||
        (payload.action === 'read' && !Object.hasOwn(payload, 'path')))
        throw Error('Invalid documents request');
    if (payload.action === 'read')
        documentPath(payload.path);
}
// Validate the explicitly bound root, including ancestors. Never resolve a relative
// caller root against cwd and never initialize governance data or acquire a lock.
async function boundRoot(root) {
    if (typeof root !== 'string' || !path.isAbsolute(root) || invisible.test(root) ||
        root.startsWith('\\\\?\\') || root.startsWith('\\\\.\\') ||
        (process.platform === 'win32' && !/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/]?)/i.test(root)) ||
        root.split(/[\\/]/).some(part => part === '.' || part === '..'))
        throw Error('Invalid document workspace');
    const normalized = path.normalize(root);
    let current = path.parse(normalized).root;
    const parts = normalized.slice(current.length).split(path.sep).filter(Boolean);
    for (const part of ['', ...parts]) {
        if (part)
            current = path.join(current, part);
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink() || !stat.isDirectory() ||
            path.relative(current, await fs.realpath(current)) !== '')
            throw Error('Invalid document workspace');
    }
    return fs.realpath(normalized);
}
// Every existing component must be a real, correctly cased in-root entry.
// lstat catches Windows junctions as well as POSIX symlinks.
async function safeEntry(root, rel) {
    const parts = rel.split('/');
    if (!parts.every(component))
        throw Error('Unsafe document entry');
    let current = root, stat;
    for (let i = 0; i < parts.length; i++) {
        current = path.join(current, parts[i]);
        stat = await fs.lstat(current);
        if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory()))
            throw Error('Unsafe document entry');
        const real = await fs.realpath(current);
        if (path.relative(root, real).split(path.sep).join('/') !== parts.slice(0, i + 1).join('/'))
            throw Error('Unsafe document entry');
    }
    return { file: current, stat };
}
async function list(root) {
    const files = [];
    let entries = 0, truncated = false;
    const stopped = () => entries >= limits.entries || files.length >= limits.files;
    const add = (rel, stat) => {
        if (!stat.isFile())
            return;
        if (stat.size > limits.bytes) {
            truncated = true;
            return;
        }
        files.push({ path: rel, bytes: stat.size });
    };
    async function walk(rel) {
        let dir;
        try {
            const { file, stat } = await safeEntry(root, rel);
            if (!stat.isDirectory())
                return;
            if (rel.split('/').length >= limits.depth) {
                truncated = true;
                return;
            }
            dir = await fs.opendir(file, { bufferSize: 1 });
            const names = [];
            // Count *all* scanned entries, including hidden, non-Markdown and unsafe
            // names. Buffer only this bounded window, then sort for stable output.
            while (entries < limits.entries) {
                const entry = await dir.read();
                if (!entry)
                    break;
                entries++;
                names.push(entry.name);
            }
            await dir.close();
            dir = null;
            if (entries >= limits.entries)
                truncated = true;
            for (const name of names.sort(compare)) {
                if (files.length >= limits.files) {
                    truncated = true;
                    break;
                }
                if (!component(name) || `${rel}/${name}`.length > 2048)
                    continue;
                const child = `${rel}/${name}`;
                try {
                    const { stat } = await safeEntry(root, child);
                    if (stat.isDirectory()) {
                        if (stopped()) {
                            truncated = true;
                            continue;
                        }
                        await walk(child);
                    }
                    else if (name.endsWith('.md'))
                        add(child, stat);
                }
                catch { /* Unavailable or unsafe entries are never exposed. */ }
            }
        }
        catch { /* Missing or unsafe optional docs/notes trees are skipped. */ }
        finally {
            if (dir)
                await dir.close().catch(() => { });
        }
    }
    for (const rel of rootFiles) {
        entries++;
        try {
            add(rel, (await safeEntry(root, rel)).stat);
        }
        catch { /* Optional root file. */ }
    }
    for (const rel of ['docs', 'notes']) {
        if (stopped()) {
            truncated = true;
            break;
        }
        entries++;
        await walk(rel);
    }
    files.sort((a, b) => compare(a.path, b.path));
    return { workspace: root, files, truncated, limits };
}
async function read(root, rel) {
    const { file, stat } = await safeEntry(root, rel);
    if (!stat.isFile() || stat.size > limits.bytes)
        throw Error('Document unavailable');
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) |
        (constants.O_NONBLOCK || 0));
    try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.size > limits.bytes ||
            opened.dev !== stat.dev || opened.ino !== stat.ino)
            throw Error('Document unavailable');
        const checked = (await safeEntry(root, rel)).stat;
        if (checked.dev !== opened.dev || checked.ino !== opened.ino)
            throw Error('Document unavailable');
        const buffer = Buffer.alloc(limits.bytes + 1);
        let bytes = 0;
        while (bytes < buffer.length) {
            const result = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
            if (!result.bytesRead)
                break;
            bytes += result.bytesRead;
        }
        const after = await handle.stat();
        if (bytes > limits.bytes || bytes !== opened.size || after.size !== bytes ||
            after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs)
            throw Error('Document unavailable');
        const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(content))
            throw Error('Document unavailable');
        return { workspace: root, path: rel, content, bytes };
    }
    finally {
        await handle.close();
    }
}
async function documents(root, payload) {
    request(payload);
    // Workspace is an optional assertion, never a way to select another root.
    if (Object.hasOwn(payload, 'workspace') && payload.workspace !== root)
        throw Error('Document workspace mismatch');
    let canonical;
    try {
        canonical = await boundRoot(root);
    }
    catch {
        throw Error('Invalid document workspace');
    }
    try {
        return payload.action === 'list' ? await list(canonical) : await read(canonical, payload.path);
    }
    catch {
        throw Error('Document unavailable');
    }
}
module.exports = { documents, limits };
