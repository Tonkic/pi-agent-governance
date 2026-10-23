'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.collaborationProgram = collaborationProgram;
// Self-contained: the same fixed implementation runs locally and over the trusted SSH RPC.
async function collaborationProgram(q) {
    const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
    const exec = (file, args, options) => new Promise((resolve, reject) => require('node:child_process').execFile(file, args, options, (error, stdout) => error ? reject(error) : resolve({ stdout })));
    const fail = (s) => { throw Error(s); };
    const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
    const branchOK = (s) => typeof s === 'string' && s.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(s) && !s.includes('..') && !s.includes('//') && s.split('/').every(x => x && !x.startsWith('.') && !x.endsWith('.') && !x.endsWith('.lock'));
    async function run(r) {
        if (!r || Object.keys(r).some(k => !['root', 'action', 'repository', 'branch', 'token', 'path', 'expectedHead', 'target', 'confirmed'].includes(k)) || !['inspect', 'read', 'publish', 'reconcile'].includes(r.action))
            fail('INVALID_COLLABORATION_REQUEST');
        if (typeof r.repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(r.repository) || r.repository.endsWith('.git') || !branchOK(r.branch))
            fail('INVALID_GITHUB_BINDING');
        if (r.token !== undefined && (typeof r.token !== 'string' || !r.token || r.token.length > 4096 || /[\s\p{C}]/u.test(r.token)))
            fail('INVALID_GITHUB_TOKEN');
        if (typeof r.root !== 'string' || !path.isAbsolute(r.root) || path.resolve(r.root) !== r.root)
            fail('ABSOLUTE_COLLABORATION_ROOT_REQUIRED');
        let cur = path.parse(r.root).root;
        for (const part of r.root.slice(cur.length).split(path.sep).filter(Boolean)) {
            cur = path.join(cur, part);
            const st = await fs.lstat(cur);
            if (!st.isDirectory() || st.isSymbolicLink())
                fail('UNSAFE_COLLABORATION_ROOT');
        }
        if (await fs.realpath(r.root) !== r.root)
            fail('UNSAFE_COLLABORATION_ROOT');
        const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_|^SSH_|^GCM_/i.test(k)));
        Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '' });
        const sourceEnv = { ...env };
        delete sourceEnv.GIT_CONFIG_NOSYSTEM;
        delete sourceEnv.GIT_CONFIG_GLOBAL;
        if (r.token)
            Object.assign(env, { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_1: 'http.https://github.com/.extraHeader', GIT_CONFIG_VALUE_1: 'Authorization: Basic ' + Buffer.from('x-access-token:' + r.token).toString('base64') });
        const git = async (cwd, args, limit = 1048576) => {
            try {
                return (await exec('git', ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'protocol.file.allow=never', ...args], { cwd, env: cwd === r.root ? sourceEnv : env, encoding: 'buffer', timeout: 20000, maxBuffer: limit, windowsHide: true })).stdout;
            }
            catch {
                fail('GITHUB_GIT_OPERATION_FAILED');
            }
        };
        const top = (await git(r.root, ['rev-parse', '--show-toplevel'])).toString().trim();
        if (path.resolve(top) !== r.root)
            fail('COLLABORATION_REPOSITORY_ROOT_REQUIRED');
        if ((await git(r.root, ['ls-files', '-z', '--', '.remote-local'])).length)
            fail('PRIVATE_DIRECTORY_ALREADY_TRACKED');
        await git(r.root, ['check-ignore', '--no-index', '-q', '--', '.remote-local/']);
        const privateDir = path.join(r.root, '.remote-local');
        try {
            await fs.mkdir(privateDir, { mode: 0o700 });
        }
        catch (e) {
            if (e.code !== 'EEXIST')
                throw e;
        }
        const st = await fs.lstat(privateDir);
        if (!st.isDirectory() || st.isSymbolicLink())
            fail('UNSAFE_COLLABORATION_PATH');
        const lockPath = path.join(privateDir, 'collaboration.lock'), lock = await fs.open(lockPath, 'wx', 0o600);
        let cache;
        try {
            cache = await fs.mkdtemp(path.join(privateDir, 'github-cache-'));
            Object.assign(env, { HOME: cache, USERPROFILE: cache, CURL_HOME: cache, XDG_CONFIG_HOME: cache });
            delete env.NETRC;
            await git(cache, ['init', '--bare', '--template=', '.']);
            const url = 'https://github.com/' + r.repository + '.git';
            const text = (b) => new TextDecoder('utf-8', { fatal: true }).decode(b);
            const remoteHead = async (ref) => {
                const output = text(await git(cache, ['ls-remote', '--refs', '--', url, 'refs/heads/' + ref])).trim();
                if (!output)
                    return null;
                const rows = output.split('\n');
                if (rows.length !== 1 || !new RegExp('^[a-f0-9]{40,64}\\s+refs/heads/' + ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$').test(rows[0]))
                    fail('INVALID_GITHUB_REF_RESPONSE');
                return rows[0].split(/\s/)[0];
            };
            const authorityHead = await remoteHead(r.branch);
            if (!authorityHead)
                fail('GITHUB_AUTHORITY_BRANCH_MISSING');
            const info = { authority: 'github', repository: r.repository, branch: r.branch, head: authorityHead, root: r.root };
            if (r.action === 'inspect')
                return info;
            const key = sha(JSON.stringify([r.repository.toLowerCase(), r.branch])), journalPath = path.join(privateDir, 'github-push-' + key + '.json');
            const readJournal = async () => { try {
                const s = await fs.lstat(journalPath);
                if (!s.isFile() || s.isSymbolicLink() || s.size > 4096)
                    fail('INVALID_PUSH_JOURNAL');
                return JSON.parse(await fs.readFile(journalPath, 'utf8'));
            }
            catch (e) {
                if (e.code === 'ENOENT')
                    return null;
                throw e;
            } };
            const saveJournal = async (value) => { const tmp = journalPath + '.' + crypto.randomBytes(8).toString('hex'); try {
                await fs.writeFile(tmp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
                await fs.rename(tmp, journalPath);
            }
            finally {
                await fs.unlink(tmp).catch(() => { });
            } };
            if (r.action === 'reconcile') {
                const j = await readJournal();
                if (!j || !['unknown', 'saved'].includes(j.status) || !branchOK(j.target) || !/^[a-f0-9]{40,64}$/.test(j.head))
                    fail('NO_UNKNOWN_GITHUB_PUSH');
                const actual = await remoteHead(j.target);
                if (actual !== j.head)
                    return { ...info, pushStatus: 'unknown', target: j.target, instruction: 'Inspect the target branch and reconcile manually; no push was repeated.' };
                await saveJournal({ ...j, status: 'saved' });
                return { ...info, pushStatus: 'saved', target: j.target, submittedHead: j.head };
            }
            await git(cache, ['fetch', '--no-tags', '--no-recurse-submodules', '--', url, 'refs/heads/' + r.branch + ':refs/heads/authority']);
            const fetched = text(await git(cache, ['rev-parse', 'refs/heads/authority'])).trim();
            if (fetched !== authorityHead)
                fail('GITHUB_AUTHORITY_CHANGED_RETRY_READ');
            if (r.action === 'read') {
                const name = r.path;
                if (typeof name !== 'string' || name.length > 1024 || !/^(README|AGENTS|CHANGELOG|CONTRIBUTING|LICENSE)\.md$/.test(name) && !/^(docs|notes)\/.+\.md$/.test(name) || name.split('/').some(x => !x || x.startsWith('.') || x.endsWith('.') || /[\\:\p{C}*?\[\]]/u.test(x) || /secret|password|credential|token|private/i.test(x)))
                    fail('INVALID_AUTHORITY_DOCUMENT');
                const entry = text(await git(cache, ['ls-tree', '-z', fetched, '--', name]));
                if (!/^100(644|755) blob [a-f0-9]{40,64}\t/.test(entry) || entry.split('\0').filter(Boolean).length !== 1 || entry.slice(entry.indexOf('\t') + 1, -1) !== name)
                    fail('AUTHORITY_DOCUMENT_NOT_REGULAR');
                const oid = entry.split(' ')[2].split('\t')[0], size = Number(text(await git(cache, ['cat-file', '-s', oid])).trim());
                if (!Number.isSafeInteger(size) || size > 262144)
                    fail('AUTHORITY_DOCUMENT_LIMIT');
                const bytes = await git(cache, ['cat-file', 'blob', oid], 262145), body = text(bytes);
                if (body.includes('\0'))
                    fail('INVALID_AUTHORITY_DOCUMENT');
                return { ...info, path: name, text: body, hash: sha(bytes), readOnly: true };
            }
            if (r.confirmed !== true || !/^[a-f0-9]{40,64}$/.test(r.expectedHead))
                fail('CONFIRMED_EXPECTED_HEAD_REQUIRED');
            if (!branchOK(r.target) || !r.target.startsWith('agent/') || r.target === r.branch)
                fail('INDEPENDENT_TARGET_BRANCH_REQUIRED');
            const old = await readJournal();
            if (old?.status === 'unknown')
                fail('PREVIOUS_GITHUB_PUSH_UNKNOWN');
            const target = r.target + '-' + crypto.randomBytes(16).toString('hex');
            if (!branchOK(target) || await remoteHead(target))
                fail('INVALID_TARGET_BRANCH');
            if ((await git(r.root, ['status', '--porcelain=v1', '--untracked-files=all'])).length)
                fail('COMMIT_WORKSPACE_CHANGES_FIRST');
            const head = text(await git(r.root, ['rev-parse', 'HEAD'])).trim();
            if (head !== r.expectedHead)
                fail('STALE_COLLABORATION_HEAD');
            // Local source import is explicitly file-only; network commands never use workspace config.
            await git(cache, ['-c', 'protocol.file.allow=always', 'fetch', '--no-tags', '--no-recurse-submodules', '--', r.root, head + ':refs/heads/submission']);
            await git(cache, ['merge-base', '--is-ancestor', authorityHead, head]);
            if ((await git(cache, ['ls-tree', '-r', '--name-only', head, '--', '.remote-local'])).length)
                fail('PRIVATE_DIRECTORY_ALREADY_TRACKED');
            const pending = text(await git(cache, ['log', '-m', '--format=', '--name-only', '-z', authorityHead + '..' + head]));
            if (pending.split(/[\0\n]/).some(name => /(^|\/)(\.remote-local|\.secrets|\.env(?:\..*)?|id_rsa|id_ed25519)(\/|$)|\.(pem|p12|pfx|key)$/i.test(name)))
                fail('SENSITIVE_PATH_IN_PENDING_HISTORY');
            if (text(await git(r.root, ['rev-parse', 'HEAD'])).trim() !== head)
                fail('STALE_COLLABORATION_HEAD');
            await saveJournal({ status: 'unknown', target, head, authorityHead, startedAt: new Date().toISOString() });
            await git(cache, ['push', '--porcelain', '--', url, head + ':refs/heads/' + target]);
            if (await remoteHead(target) !== head)
                fail('GITHUB_PUSH_RESULT_UNKNOWN');
            await saveJournal({ status: 'saved', target, head, authorityHead });
            return { ...info, pushStatus: 'saved', target, submittedHead: head, merged: false, instruction: 'Open and review a pull request. The authority branch was not changed.' };
        }
        finally {
            try {
                if (cache)
                    await fs.rm(cache, { recursive: true, force: true });
            }
            finally {
                await lock.close();
                await fs.unlink(lockPath);
            }
        }
    }
    if (q !== undefined)
        return run(q);
    // SSH RPC uses bounded stdin and opaque failures, never stderr or token-bearing subprocess messages.
    try {
        const chunks = [];
        let n = 0;
        for await (const b of process.stdin) {
            n += b.length;
            if (n > 65536)
                fail('INPUT_LIMIT');
            chunks.push(b);
        }
        const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const result = await run(request);
        process.stdout.write(JSON.stringify({ version: 1, ok: true, result }));
    }
    catch (e) {
        process.stdout.write(JSON.stringify({ version: 1, ok: false, error: /^[A-Z_]{3,80}$/.test(e.message) ? e.message : 'COLLABORATION_FAILED' }));
    }
}
