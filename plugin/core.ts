'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
const layers = ['docs', 'contract', 'notes', 'source'];
function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20000)
    throw Error(`${name}: nonempty text required (max 20000)`);
  return value;
}
function route(f: any = {}) {
  const level =
    f.research || f.architecture
      ? 3
      : f.interfaceChange || f.unknownCause || f.modules > 1 || f.files > 5
        ? 2
        : f.files > 1 || f.debugging
          ? 1
          : 0;
  return {
    complexity: level,
    modelTier: ['small', 'medium', 'strong', 'strongest'][level],
    contextLevel: ['docs', 'contract', 'notes', 'source'][level],
    reviewRequired: level >= 2,
    advisoryOnly: true
  };
}
const intentHash = (s: any) =>
  hash(
    JSON.stringify([
      s.task,
      s.goal,
      s.criteria,
      s.scope,
      s.constraints,
      s.current,
      s.next,
      s.blocked,
      s.followUp,
      s.contextFiles
    ])
  );
const idle = (followUp: any = null) => ({
  version: 1,
  task: null,
  status: 'idle',
  followUp: followUp || null,
  current: followUp
    ? 'Approved next task available; start it before working.'
    : 'Waiting for human direction; do not invent work.'
});
function validateTask(a: any) {
  if (!a || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(a.id || '')) throw Error('Invalid task id');
  requireText(a.goal, 'goal');
  if (!Array.isArray(a.criteria) || !a.criteria.length) throw Error('Acceptance criteria required');
  a.criteria.forEach((c) => requireText(c, 'criterion'));
  for (const k of ['scope', 'constraints'])
    if (a[k] !== undefined) {
      if (!Array.isArray(a[k])) throw Error(`${k} must be an array`);
      a[k].forEach((c) => requireText(c, k));
    }
}
class Governance {
  root: string;
  expected?: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }
  async safe(rel) {
    if (
      typeof rel !== 'string' ||
      !rel ||
      rel.includes('\\') ||
      rel.includes(':') ||
      path.isAbsolute(rel)
    )
      throw Error('Invalid relative path');
    const parts = rel.split('/');
    if (
      parts.some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          /^(\.git|\.ssh|\.aws|\.env.*|node_modules|\.npmrc|\.netrc|.*\.(pem|key|p12|pfx))$/i.test(
            p
          )
      )
    )
      throw Error('Unsafe path');
    let current = this.root;
    for (const p of parts) {
      current = path.join(current, p);
      try {
        if ((await fs.lstat(current)).isSymbolicLink()) throw Error('Symlinks are not allowed');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    return current;
  }
  async read(rel) {
    const file = await this.safe(rel);
    if ((await fs.stat(file)).size > 1024 * 1024) throw Error('File exceeds 1 MiB');
    return fs.readFile(file, 'utf8');
  }
  async write(rel, text, exclusive = false) {
    const file = await this.safe(rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    if (exclusive) return fs.writeFile(file, text, { flag: 'wx' });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, text, { flag: 'wx' });
      await fs.rename(temp, file);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  async state(): Promise<any> {
    const s = JSON.parse(await this.read('STATE.json'));
    if (s.version !== 1 || !['idle', 'working', 'verified', 'ready'].includes(s.status))
      throw Error('Invalid STATE schema');
    if (
      s.task !== null &&
      (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(s.task || '') ||
        s.change !== `changes/active/${s.task}` ||
        !Array.isArray(s.criteria) ||
        !Array.isArray(s.blocked) ||
        !layers.includes(s.layer))
    )
      throw Error('Invalid task state');
    if (s.followUp) validateTask(s.followUp);
    if (s.task) {
      validateTask({ ...s, id: s.task });
      if (s.verification && s.verification.intentHash !== intentHash(s)) {
        s.status = 'working';
        delete s.verification;
        delete s.gate;
      }
    }
    return s;
  }
  async save(s: any): Promise<any> {
    if (this.expected !== undefined && (await this.read('STATE.json')) !== this.expected)
      throw Error('STATE changed externally; reload before retrying');
    await this.write('STATE.json', JSON.stringify(s, null, 2) + '\n');
    this.expected = await this.read('STATE.json');
    return s;
  }
  async locked(fn) {
    const lock = await this.safe('.governance.lock');
    const handle = await fs.open(lock, 'wx').catch((e) => {
      if (e.code === 'EEXIST')
        throw Error('Governance busy; if a process crashed, inspect then remove .governance.lock');
      throw e;
    });
    try {
      try {
        this.expected = await this.read('STATE.json');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        this.expected = undefined;
      }
      return await fn();
    } finally {
      this.expected = undefined;
      await handle.close();
      await fs.unlink(lock);
    }
  }
  async init() {
    const templates = {
      'AGENTS.md':
        '# Agent workflow\n\n' +
        'Read STATE.json and README.md before work. Resume the active task or start its approved ' +
        'followUp; otherwise wait for human direction.\n' +
        'STATE is the sole task definition: goal, criteria, scope, constraints, current, next, blocked.\n' +
        'Read further docs or relevant source only as needed; no mandatory layer traversal.\n' +
        'Run checks, update necessary usage docs, verify, then close with a knowledge summary.\n' +
        'Docs contain purpose and usage only. Notes and temporary findings are optional.\n' +
        'Re-read state before writing; human changes invalidate old verification. ' +
        'Never overwrite new human intent.\n' +
        'Keep modifications in Git task branches. Use git_status to resume, git_create to allocate ' +
        'a worktree before assigning a writing delegate; explicitly set its working directory and ' +
        'allowed paths. Read-only delegates need no branch.\n' +
        'Review git_diff, git_commit, then test and git_verify the exact commit. Integrate verified ' +
        'workers into the managed coordinator only; test the combined result again. ' +
        'Main merge/push requires human approval. Never stash/reset user changes automatically.\n',
      'README.md':
        '# Project\n\n## Purpose\nDescribe what this project does.\n\n## Usage\nDescribe how to use it.\n',
      'STATE.json': JSON.stringify(idle(), null, 2) + '\n'
    };
    const created = [],
      preserved = [];
    for (const [p, text] of Object.entries(templates)) {
      try {
        await this.write(p, text, true);
        created.push(p);
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        preserved.push(p);
      }
    }
    return {
      created,
      preserved,
      instruction:
        'If AGENTS.md already existed, manually merge the workflow from plugin documentation.'
    };
  }
  async start(a) {
    const s = await this.state();
    if (s.task) throw Error('An active task already exists');
    a = a.id ? a : { ...s.followUp, ...a };
    validateTask(a);
    const base = `changes/active/${a.id}`;
    try {
      await fs.access(await this.safe(`changes/archive/${a.id}`));
      throw Error('Task id already archived');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await fs.mkdir(path.dirname(await this.safe(base)), { recursive: true });
    await fs.mkdir(await this.safe(base));
    return this.save({
      version: 1,
      task: a.id,
      status: 'working',
      goal: a.goal,
      criteria: a.criteria,
      scope: a.scope || [],
      constraints: a.constraints || [],
      current: a.goal,
      next: [],
      blocked: [],
      followUp: s.followUp && s.followUp.id !== a.id ? s.followUp : null,
      change: base,
      layer: 'docs'
    });
  }
  async fingerprints(files) {
    if (!Array.isArray(files) || !files.length || files.length > 100)
      throw Error('Provide 1–100 changed files');
    const result = {};
    for (const p of files) {
      // STATE changes during the workflow; it must not invalidate its own evidence.
      if (p === 'STATE.json' || p.startsWith('changes/'))
        throw Error('Evidence must reference project files, not workflow state');
      result[p] = hash(await this.read(p));
    }
    return result;
  }
  async budgets(files) {
    for (const p of files) {
      const max =
        p === 'AGENTS.md'
          ? 60
          : p === 'README.md'
            ? 150
            : p === 'docs/overview.md'
              ? 100
              : p === 'docs/architecture.md'
                ? 200
                : p.startsWith('docs/')
                  ? 100
                  : null;
      if (max && (await this.read(p)).trimEnd().split('\n').length > max)
        throw Error(`${p} exceeds ${max} line budget`);
    }
  }
  progress(a, s) {
    requireText(a.current, 'current');
    for (const key of ['next', 'blocked']) {
      if (!Array.isArray(a[key])) throw Error(`${key} must be an array`);
      a[key].forEach((x) => requireText(x, key));
      s[key] = a[key];
    }
    s.current = a.current;
    s.status = 'working';
    delete s.verification;
    delete s.gate;
    return this.save(s);
  }
  async context(a, s) {
    const index = layers.indexOf(a.layer);
    if (index < 0) throw Error('Unknown context layer');
    if (a.layer !== 'docs') requireText(a.reason, 'uncertainty reason');
    if (!Array.isArray(a.files) || !a.files.length || a.files.length > 10)
      throw Error('Provide 1–10 context files');
    const contents = {};
    let size = 0;
    for (const p of a.files) {
      if (index < 2 && !(p.startsWith('docs/') || p === 'AGENTS.md' || p === 'README.md'))
        throw Error('Docs/contracts must come from README.md, docs/ or AGENTS.md');
      if (index === 2 && !p.startsWith('notes/')) throw Error('Notes must come from notes/');
      contents[p] = await this.read(p);
      size += contents[p].length;
      if (size > 40000) throw Error('Context exceeds 40000 characters; narrow the selection');
    }
    s.layer = a.layer;
    s.contextFiles = [...new Set([...(s.contextFiles || []), ...a.files])];
    await this.save(s);
    return { state: s, contents };
  }
  async verify(a, s) {
    requireText(a.evidence, 'verification evidence');
    requireText(a.diffReview, 'diff review');
    if (
      a.passed !== true ||
      !Array.isArray(a.accepted) ||
      s.criteria.some((_, i) => a.accepted[i] !== true) ||
      a.accepted.length !== s.criteria.length
    )
      throw Error('All checks and acceptance criteria must pass');
    if (s.blocked.length) throw Error('Resolve blockers first');
    await this.budgets(a.files || []);
    const files = [
      ...new Set([
        ...(a.files || []),
        ...(s.contextFiles || []).filter((p) => p !== 'STATE.json' && !p.startsWith('changes/'))
      ])
    ];
    for (const p of ['README.md', 'AGENTS.md']) {
      try {
        await this.read(p);
        if (!files.includes(p)) files.push(p);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    if (!a.files?.length) throw Error('Provide changed files');
    await this.budgets(files);
    s.verification = {
      evidence: a.evidence,
      diffReview: a.diffReview,
      intentHash: intentHash(s),
      fingerprints: await this.fingerprints(files),
      at: new Date().toISOString()
    };
    s.status = 'verified';
    delete s.gate;
    return this.save(s);
  }
  async gate(a, s) {
    if (s.status !== 'verified') throw Error('Verify before knowledge gate');
    requireText(a.delta, 'verified delta');
    const decisions = {};
    for (const key of ['behavior', 'contract', 'stableFact', 'pitfall', 'decision']) {
      const d = a.decisions?.[key];
      if (!d || typeof d.changed !== 'boolean') throw Error(`Gate decision required: ${key}`);
      requireText(d.reason, `${key} reason`);
      if (d.changed) {
        const prefix = ['pitfall', 'decision'].includes(key) ? 'notes/' : 'docs/';
        if (
          typeof d.path !== 'string' ||
          !(d.path.startsWith(prefix) || (prefix === 'docs/' && d.path === 'README.md'))
        )
          throw Error(`${key} requires ${prefix} or README reference`);
        const content = await this.read(d.path);
        requireText(content, 'knowledge document');
        await this.budgets([d.path]);
        decisions[key] = { ...d, fingerprint: hash(content) };
      } else decisions[key] = { changed: false, reason: d.reason };
    }
    await this.write(`${s.change}/delta.md`, a.delta + '\n');
    s.gate = { decisions, deltaHash: hash(a.delta + '\n') };
    s.status = 'ready';
    return this.save(s);
  }
  async close(a, s) {
    if (s.status === 'verified' && a.knowledge !== undefined) {
      requireText(a.knowledge, 'knowledge summary');
      s.gate = { decisions: {}, summary: a.knowledge };
      s.status = 'ready';
    }
    if (s.status !== 'ready' || !s.gate || !s.verification)
      throw Error('Verification and knowledge gate required');
    const archived = `changes/archive/${s.task}`;
    try {
      const closure = await this.read(`${archived}/closure.json`);
      if (closure !== JSON.stringify(s, null, 2))
        throw Error('Archive conflicts with active state');
      try {
        await fs.access(await this.safe(s.change));
        throw Error('Both active and archived task exist; inspect manually');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      await this.save(idle(s.followUp));
      return { status: 'closed', archive: archived, recovered: true };
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    for (const [p, h] of Object.entries(s.verification.fingerprints))
      if (hash(await this.read(p)) !== h) throw Error(`Changed after verification: ${p}`);
    for (const d of Object.values(s.gate.decisions) as any[])
      if (d.changed && hash(await this.read(d.path)) !== d.fingerprint)
        throw Error('Knowledge document changed after gate');
    if (s.gate.deltaHash && hash(await this.read(`${s.change}/delta.md`)) !== s.gate.deltaHash)
      throw Error('Delta changed after gate');
    const dest = `changes/archive/${s.task}`;
    await fs.mkdir(path.dirname(await this.safe(dest)), { recursive: true });
    if ((await this.read('STATE.json')) !== this.expected)
      throw Error('STATE changed externally; reload before retrying');
    await this.write(`${s.change}/closure.json`, JSON.stringify(s, null, 2));
    await fs.rename(await this.safe(s.change), await this.safe(dest));
    await this.save(idle(s.followUp));
    return { status: 'closed', archive: dest };
  }
  async run(a) {
    if (!a || typeof a !== 'object') throw Error('Arguments required');
    if (typeof a.action === 'string' && a.action.startsWith('git_'))
      return new (require('./git').GitGovernance)(this.root).run(a);
    if (
      [
        'project_snapshot',
        'architecture_sources',
        'architecture_set',
        'board_create',
        'board_update',
        'board_move',
        'board_accept'
      ].includes(a.action)
    )
      return new (require('./project').ProjectData)(this).run(a);
    if (a.action === 'route') return route(a.features);
    if (a.action === 'status') return this.state();
    return this.locked(async () => {
      if (
        a.expectedState !== undefined &&
        a.expectedState !== hash(JSON.stringify([this.root, this.expected ?? null]))
      )
        throw Error('页面状态已过期或工作区已切换，请刷新后重试');
      if (a.action === 'init') return this.init();
      if (a.action === 'start') return this.start(a);
      const s = await this.state();
      if (!s.task) throw Error('No active task');
      switch (a.action) {
        case 'progress':
          return this.progress(a, s);
        case 'context':
          return this.context(a, s);
        case 'verify':
          return this.verify(a, s);
        case 'gate':
          return this.gate(a, s);
        case 'close':
          return this.close(a, s);
        default:
          throw Error('Unknown action');
      }
    });
  }
}
module.exports = { Governance, route };
