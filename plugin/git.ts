'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const text = (v, name) => {
  if (typeof v !== 'string' || !v.trim() || v.length > 20000) throw Error(`${name} required`);
  return v;
};
const idOK = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
const split = (s) => s.split('\0').filter(Boolean);
function safePath(p) {
  if (
    typeof p !== 'string' ||
    !p ||
    /[\\:*?\[\]\x00-\x1f]/.test(p) ||
    p.startsWith('/') ||
    p.endsWith('/') ||
    p
      .split('/')
      .some(
        (x) =>
          !x ||
          x === '.' ||
          x === '..' ||
          /^(\.git|\.env.*|\.ssh|\.aws|\.npmrc|\.netrc|.*\.(pem|key|p12|pfx))$/i.test(x)
      )
  )
    throw Error(`Unsafe Git path: ${p}`);
}
function allows(t, p) {
  safePath(p);
  if (t.role === 'worker' && (/^(STATE\.json|AGENTS\.md)$/i.test(p) || /^changes\//i.test(p)))
    return false;
  return t.allowedPaths.some((a) => (a.endsWith('/') ? p.startsWith(a) : p === a));
}
class GitGovernance {
  root: string;
  common: string;
  store: string;
  hooks: string;
  file: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }
  async git(cwd, args): Promise<string> {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_LITERAL_PATHSPECS = '1';
    const opts = [
      '-c',
      'core.hooksPath=' + (this.hooks || path.join(cwd, '.git', 'pi-disabled-hooks')),
      '-c',
      'commit.gpgSign=false',
      '-c',
      'merge.gpgSign=false',
      '-c',
      'core.fsmonitor=false'
    ];
    return new Promise((resolve, reject) =>
      execFile(
        'git',
        [...opts, ...args],
        { cwd, env, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            const e = Error(`git ${args[0]} failed: ${stderr || error.message}`);
            (e as NodeJS.ErrnoException).code = error.code;
            reject(e);
          } else resolve(stdout);
        }
      )
    );
  }
  async setup() {
    const root = (await this.git(this.root, ['rev-parse', '--show-toplevel'])).trim();
    if (path.resolve(root) !== this.root)
      throw Error('Open the repository root, not a subdirectory');
    this.common = (
      await this.git(this.root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).trim();
    this.store = path.join(this.common, 'pi-governance');
    await this.noLinks(this.common, this.store);
    await fs.mkdir(this.store, { recursive: true });
    this.hooks = path.join(this.store, 'disabled-hooks');
    await this.noLinks(this.store, this.hooks);
    await fs.mkdir(this.hooks, { recursive: true });
    this.file = path.join(this.store, 'tasks.json');
    await this.noLinks(this.store, this.file);
  }
  async noLinks(root, target) {
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw Error('Path outside managed area');
    let current = root;
    for (const part of ['', ...rel.split(path.sep).filter(Boolean)]) {
      if (part) current = path.join(current, part);
      try {
        if ((await fs.lstat(current)).isSymbolicLink())
          throw Error('Symlink/junction is not allowed');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  }
  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.tasks))
        throw Error('Invalid Git task registry');
      return data;
    } catch (e) {
      if (e.code === 'ENOENT') return { version: 1, tasks: [] };
      throw e;
    }
  }
  async save(data) {
    const tmp = this.file + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
      await fs.rename(tmp, this.file);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
  async head(cwd) {
    return (await this.git(cwd, ['rev-parse', 'HEAD'])).trim();
  }
  async clean(cwd) {
    if (await this.git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']))
      throw Error('Worktree is dirty; commit or resolve explicitly. No automatic stash/reset.');
    if (await this.merging(cwd)) throw Error('An unresolved merge is in progress');
    for (const name of ['CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
      const p = (await this.git(cwd, ['rev-parse', '--git-path', name])).trim();
      try {
        await fs.access(path.resolve(cwd, p));
        throw Error('Git operation in progress');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  }
  async merging(cwd) {
    const p = (await this.git(cwd, ['rev-parse', '--git-path', 'MERGE_HEAD'])).trim();
    try {
      await fs.access(path.resolve(cwd, p));
      return true;
    } catch (e) {
      if (e.code === 'ENOENT') return false;
      throw e;
    }
  }
  async task(data, id) {
    const t = data.tasks.find((t) => t.id === id);
    if (!t || !idOK(t.id)) throw Error('Unknown managed task');
    const expected = path.join(this.store, 'workspaces', t.id);
    if (
      t.worktree !== expected ||
      t.branch !== `agent/${t.id}` ||
      !/^[0-9a-f]{40,64}$/.test(t.base)
    )
      throw Error('Invalid task registry entry');
    await this.noLinks(this.store, t.worktree);
    const common = (
      await this.git(t.worktree, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).trim();
    const branch = (await this.git(t.worktree, ['symbolic-ref', '--short', 'HEAD'])).trim();
    if (path.resolve(common) !== path.resolve(this.common) || branch !== t.branch)
      throw Error('Worktree repository/branch changed; inspect before continuing');
    return t;
  }
  async changed(t) {
    return [
      ...new Set([
        ...split(
          await this.git(t.worktree, ['diff', '--name-only', '-z', '--no-renames', t.base, '--'])
        ),
        ...split(
          await this.git(t.worktree, ['diff', '--name-only', '-z', '--no-renames', 'HEAD', '--'])
        ),
        ...split(
          await this.git(t.worktree, [
            'diff',
            '--cached',
            '--name-only',
            '-z',
            '--no-renames',
            '--'
          ])
        ),
        ...split(await this.git(t.worktree, ['ls-files', '--others', '--exclude-standard', '-z']))
      ])
    ].sort();
  }
  async inspect(t) {
    const files = await this.changed(t);
    for (const p of files) if (!allows(t, p)) throw Error(`Out-of-scope change: ${p}`);
    await this.git(t.worktree, ['merge-base', '--is-ancestor', t.base, 'HEAD']);
    const head = await this.head(t.worktree);
    const hashes = [];
    for (const p of files) {
      const target = path.join(t.worktree, p);
      await this.noLinks(t.worktree, target);
      try {
        const stat = await fs.lstat(target);
        if (!stat.isFile() || stat.size > 10 * 1024 * 1024)
          throw Error(`Unsupported file (regular files <=10 MiB only): ${p}`);
        hashes.push([p, stat.mode, digest(await fs.readFile(target))]);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        hashes.push([p, null]);
      }
    }
    const staged = await this.git(t.worktree, [
      'diff',
      '--cached',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--binary',
      '--'
    ]);
    const patch = await this.git(t.worktree, [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      t.base,
      '--'
    ]);
    const status = await this.git(t.worktree, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all'
    ]);
    const snapshot = digest(
      JSON.stringify([head, hashes, staged, status, t.allowedPaths, t.criteria, t.goal])
    );
    const workingPatch = await this.git(t.worktree, [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      'HEAD',
      '--'
    ]);
    return {
      head,
      files,
      snapshot,
      status,
      patch,
      workingPatch,
      stagedPatch: staged,
      untracked: split(
        await this.git(t.worktree, ['ls-files', '--others', '--exclude-standard', '-z'])
      )
    };
  }
  async run(a) {
    await this.setup();
    const lock = path.join(this.store, 'operation.lock');
    await this.noLinks(this.store, lock);
    const handle = await fs.open(lock, 'wx').catch((e) => {
      if (e.code === 'EEXIST') throw Error('Git governance busy; inspect stale lock after a crash');
      throw e;
    });
    try {
      const data = await this.load();
      if (a.action === 'git_status') {
        const tasks = [];
        for (const entry of data.tasks) {
          try {
            const t = await this.task(data, entry.id);
            const report = await this.inspect(t);
            tasks.push({
              ...t,
              head: report.head,
              dirty: !!report.status,
              verificationValid: !!t.verification && t.verification.snapshot === report.snapshot,
              mergeInProgress: await this.merging(t.worktree)
            });
          } catch (e) {
            tasks.push({ ...entry, error: e.message });
          }
        }
        return {
          tasks,
          head: await this.head(this.root),
          dirty: !!(await this.git(this.root, [
            'status',
            '--porcelain=v1',
            '--untracked-files=all'
          ])),
          registry: this.file,
          instruction:
            'Resume registered worktrees; never run writing delegates in a shared directory. No automatic host spawning, push or main merge.'
        };
      }
      if (a.action === 'git_create') {
        if (!idOK(a.id) || data.tasks.some((t) => t.id === a.id))
          throw Error('Task id invalid or already used');
        text(a.goal, 'goal');
        text(a.owner, 'owner');
        if (!['coordinator', 'worker'].includes(a.role))
          throw Error('role must be coordinator or worker');
        if (!Array.isArray(a.criteria) || !a.criteria.length) throw Error('criteria required');
        a.criteria.forEach((c) => text(c, 'criterion'));
        if (!Array.isArray(a.allowedPaths) || !a.allowedPaths.length)
          throw Error('Explicit allowedPaths required');
        a.allowedPaths.forEach((p) => safePath(p.endsWith('/') ? p.slice(0, -1) : p));
        let baseDir = this.root;
        if (a.role === 'worker') {
          const parent = await this.task(data, a.parent);
          if (parent.role !== 'coordinator') throw Error('Worker needs coordinator parent');
          baseDir = parent.worktree;
          for (const p of a.allowedPaths)
            if (
              !allows(parent, p.endsWith('/') ? p + '__scope_check__' : p) ||
              !allows({ ...parent, role: 'worker' }, p.endsWith('/') ? p + '__scope_check__' : p)
            )
              throw Error('Worker scope exceeds parent or includes shared state');
          for (const sibling of data.tasks.filter(
            (t) => t.parent === a.parent && t.status !== 'integrated'
          )) {
            if (
              a.allowedPaths.some((p) =>
                sibling.allowedPaths.some(
                  (q) =>
                    p === q ||
                    (p.endsWith('/') && q.startsWith(p)) ||
                    (q.endsWith('/') && p.startsWith(q))
                )
              )
            )
              throw Error('Active worker scopes overlap');
          }
        }
        await this.clean(baseDir);
        const base = await this.head(baseDir);
        if (a.expectedHead !== base) throw Error('expectedHead must match the clean base HEAD');
        const t = {
          id: a.id,
          owner: a.owner,
          role: a.role,
          parent: a.role === 'worker' ? a.parent : null,
          goal: a.goal,
          criteria: a.criteria,
          allowedPaths: a.allowedPaths,
          base,
          branch: `agent/${a.id}`,
          worktree: path.join(this.store, 'workspaces', a.id),
          status: 'working'
        };
        await this.noLinks(this.store, t.worktree);
        await fs.mkdir(path.dirname(t.worktree), { recursive: true });
        await this.git(baseDir, ['worktree', 'add', '-b', t.branch, t.worktree, base]);
        data.tasks.push(t);
        await this.save(data);
        return {
          ...t,
          instruction:
            'Assign the writing agent this exact worktree and scope. Set its working directory explicitly; host Task does not automatically switch cwd.'
        };
      }
      const t = await this.task(data, a.id);
      if (a.action === 'git_recover') {
        await this.clean(t.worktree);
        if (a.expectedHead !== (await this.head(t.worktree)))
          throw Error('HEAD changed; inspect before recovery');
        if (!t.pendingMerge) return { task: t, recovered: false };
        let merged = false;
        try {
          await this.git(t.worktree, ['merge-base', '--is-ancestor', t.pendingMerge.head, 'HEAD']);
          merged = true;
        } catch (e) {
          if (e.code !== 1) throw e;
        }
        if (!merged && a.expectedHead !== t.pendingMerge.targetHead)
          throw Error('Ambiguous interrupted merge; inspect manually');
        if (merged) {
          const source = data.tasks.find((x) => x.id === t.pendingMerge.id);
          if (source) {
            source.status = 'integrated';
            source.integratedHead = t.pendingMerge.head;
          }
        }
        delete t.pendingMerge;
        delete t.verification;
        t.status = 'working';
        await this.save(data);
        return { task: t, recovered: true, merged };
      }
      if (t.status === 'integrated' && a.action !== 'git_diff')
        throw Error('Integrated worker is read-only; create a new task');
      if (a.action === 'git_diff') return this.inspect(t);
      if (a.action === 'git_commit') {
        text(a.message, 'commit message');
        const before = await this.inspect(t);
        if (before.snapshot !== a.expectedDiff)
          throw Error('Diff changed or not reviewed; call git_diff and supply expectedDiff');
        if (!before.status && !(t.pendingMerge && (await this.merging(t.worktree))))
          throw Error('Nothing to commit');
        if (await this.git(t.worktree, ['ls-files', '--unmerged', '-z']))
          throw Error('Resolve merge conflicts first');
        if ((await this.merging(t.worktree)) && !t.pendingMerge)
          throw Error('Unmanaged merge; resolve manually');
        if (t.pendingMerge && !(await this.merging(t.worktree)))
          throw Error('Use git_recover before further commits');
        if ((await this.inspect(t)).snapshot !== before.snapshot)
          throw Error('Concurrent edit detected');
        const pending = [
          ...new Set([
            ...split(
              await this.git(t.worktree, [
                'diff',
                '--name-only',
                '-z',
                '--no-renames',
                'HEAD',
                '--'
              ])
            ),
            ...split(
              await this.git(t.worktree, [
                'diff',
                '--cached',
                '--name-only',
                '-z',
                '--no-renames',
                '--'
              ])
            ),
            ...before.untracked
          ])
        ];
        if (!pending.length && !t.pendingMerge) throw Error('No stageable changes');
        if (pending.length) await this.git(t.worktree, ['add', '-A', '--', ...pending]);
        await this.git(t.worktree, ['commit', '-m', a.message]);
        delete t.verification;
        t.status = 'working';
        if (t.pendingMerge) {
          await this.git(t.worktree, ['merge-base', '--is-ancestor', t.pendingMerge.head, 'HEAD']);
          const source = data.tasks.find((x) => x.id === t.pendingMerge.id);
          if (source) {
            source.status = 'integrated';
            source.integratedHead = t.pendingMerge.head;
          }
          delete t.pendingMerge;
        }
        await this.save(data);
        return {
          head: await this.head(t.worktree),
          worktree: t.worktree,
          next: 'Run tests and review the committed diff, then git_verify.'
        };
      }
      if (a.action === 'git_verify') {
        await this.clean(t.worktree);
        const report = await this.inspect(t);
        if (report.head !== a.expectedHead) throw Error('HEAD changed; verify current commit');
        text(a.evidence, 'actual test evidence');
        text(a.diffReview, 'diff review');
        if (
          a.passed !== true ||
          !Array.isArray(a.accepted) ||
          a.accepted.length !== t.criteria.length ||
          a.accepted.some((v) => v !== true)
        )
          throw Error('All acceptance criteria must pass');
        if (t.pendingMerge) throw Error('Unfinished integration; inspect pendingMerge');
        t.verification = {
          head: report.head,
          snapshot: report.snapshot,
          evidence: a.evidence,
          diffReview: a.diffReview,
          at: new Date().toISOString()
        };
        t.status = 'verified';
        await this.save(data);
        return t;
      }
      if (a.action === 'git_integrate') {
        if (t.role !== 'coordinator')
          throw Error('Integration target must be a managed coordinator, never main');
        const source = await this.task(data, a.source);
        if (source.parent !== t.id || source.role !== 'worker')
          throw Error("Source must be this coordinator's worker");
        await this.clean(t.worktree);
        await this.clean(source.worktree);
        if (t.pendingMerge || source.status === 'integrated')
          throw Error('Recover pending integration or select an unintegrated worker');
        const incoming = await this.inspect(source);
        await this.inspect(t);
        if (a.expectedHead !== (await this.head(t.worktree)))
          throw Error('Target HEAD changed; review integration again');
        if (
          !source.verification ||
          source.verification.snapshot !== incoming.snapshot ||
          a.sourceHead !== incoming.head
        )
          throw Error('Source verification stale or sourceHead mismatch');
        const incomingPaths = split(
          await this.git(t.worktree, [
            'diff',
            '--name-only',
            '-z',
            '--no-renames',
            source.base,
            incoming.head,
            '--'
          ])
        );
        for (const p of incomingPaths)
          if (!allows(t, p) || !allows(source, p)) throw Error(`Out-of-scope integration: ${p}`);
        t.pendingMerge = { id: source.id, head: incoming.head, targetHead: a.expectedHead };
        delete t.verification;
        t.status = 'integrating';
        await this.save(data);
        try {
          await this.git(t.worktree, ['merge', '--no-ff', '--no-edit', incoming.head]);
        } catch (e) {
          return {
            ok: false,
            error: e.message,
            worktree: t.worktree,
            instruction:
              'Changes and conflicts preserved. Resolve and git_commit, or manually abort and inspect registry. Never reset user edits.'
          };
        }
        delete t.pendingMerge;
        t.status = 'working';
        source.status = 'integrated';
        source.integratedHead = incoming.head;
        await this.save(data);
        return {
          head: await this.head(t.worktree),
          worktree: t.worktree,
          next: 'Run combined tests and git_verify. Main merge and remote push remain manual.'
        };
      }
      throw Error('Unknown Git action');
    } finally {
      await handle.close();
      await fs.unlink(lock);
    }
  }
}
module.exports = { GitGovernance };
