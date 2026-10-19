'use strict';
// Deliberately independent of governance setup: these operations never initialize state.
import fs = require('node:fs');
import path = require('node:path');
import crypto = require('node:crypto');
import child = require('node:child_process');
import { isUtf8 } from 'node:buffer';

const limits = Object.freeze({ page: 200, defaultPage: 100, offset: 5000, refs: 512,
  files: 500, body: 32768, subject: 1024, identity: 512, pathBytes: 4096,
  blobBytes: 262144, patchBytes: 131072, metadataBytes: 262144,
  outputBytes: 1048576, timeoutMs: 10000, operationMs: 30000 });
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const revisionPattern = /^[a-f0-9]{64}$/;
class HistoryError extends Error {
  code: string;
  constructor(code: string) { super(`Git history: ${code}`); this.code = code; }
}
const fail = (code: string): never => { throw new HistoryError(code); };
const canonical = (p: string) => process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p);
function workspaceRoot(root: unknown): string {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) fail('invalid-workspace');
  const resolved = path.resolve(root as string);
  if ((root as string).split(/[\\/]/).some(part => part === '.' || part === '..')) fail('invalid-workspace');
  try {
    let current = resolved;
    for (;;) {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('linked-workspace');
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    const real = fs.realpathSync.native(resolved);
    if (canonical(real) !== canonical(resolved)) fail('linked-workspace');
    return real;
  } catch (error) {
    if (error instanceof HistoryError) throw error;
    return fail('invalid-workspace');
  }
}
function request(payload: unknown): any {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(payload))) fail('invalid-request');
  const a: any = payload;
  const fields = { list: ['action', 'offset', 'limit', 'revision'], detail: ['action', 'sha', 'revision'], diff: ['action', 'sha', 'path', 'revision'] };
  if (!Object.hasOwn(fields, a.action) || Object.keys(a).some(k => !fields[a.action].includes(k))) fail('invalid-request');
  if (a.action === 'list') {
    const offset = a.offset === undefined ? 0 : a.offset, limit = a.limit === undefined ? limits.defaultPage : a.limit;
    if (!Number.isInteger(offset) || offset < 0 || offset > limits.offset || !Number.isInteger(limit) || limit < 1 || limit > limits.page) fail('invalid-request');
    if ((offset > 0 || a.revision !== undefined) && (typeof a.revision !== 'string' || !revisionPattern.test(a.revision))) fail('invalid-revision');
    return { ...a, offset, limit };
  }
  if (typeof a.sha !== 'string' || !oid.test(a.sha)) fail('invalid-sha');
  if (typeof a.revision !== 'string' || !revisionPattern.test(a.revision)) fail('invalid-revision');
  if (a.action === 'diff' && (typeof a.path !== 'string' || !a.path || Buffer.byteLength(a.path) > limits.pathBytes || a.path.includes('\0'))) fail('invalid-path');
  return a;
}
function environment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^GIT_/i.test(key)) env[key] = value;
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1', GIT_LITERAL_PATHSPECS: '1', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_ATTR_NOSYSTEM: '1', GIT_GRAFT_FILE: '/dev/null' };
}
class Reader {
  root: string;
  deadline = Date.now() + limits.operationMs;
  constructor(root: string) { this.root = root; }
  async git(args: string[], options: { max?: number, partial?: boolean, input?: string, allowFailure?: boolean } = {}): Promise<{ text: string, buffer: Buffer, overflow: boolean, failed: boolean }> {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) fail('timeout');
    const maxBuffer = options.max ?? limits.outputBytes;
    return new Promise((resolve, reject) => {
      const proc = child.execFile('git', ['--no-pager', '--no-optional-locks', '--no-replace-objects',
        '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false',
        '-c', 'tag.gpgSign=false', '-c', 'gpg.program=', '-c', 'diff.external=',
        '-c', 'core.attributesFile=/dev/null', '-c', 'protocol.allow=never',
        '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'core.quotePath=false', ...args],
      { cwd: this.root, env: environment(), shell: false, windowsHide: true, encoding: 'buffer',
        timeout: Math.min(limits.timeoutMs, remaining), maxBuffer }, (error: any, stdout: Buffer) => {
        const overflow = error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        if (error && !(overflow && options.partial) && !(options.allowFailure && !overflow && !error.killed && typeof error.code === 'number')) {
          reject(new HistoryError(overflow ? 'output-too-large' : error.killed ? 'timeout' : 'git-read-failed')); return;
        }
        const buffer = (stdout || Buffer.alloc(0)).subarray(0, maxBuffer);
        resolve({ text: buffer.toString('utf8'), buffer, overflow, failed: Boolean(error) });
      });
      // Input is only internally constructed full object IDs, never protocol commands.
      proc.stdin?.on('error', () => {});
      proc.stdin?.end(options.input);
    });
  }
  async snapshot() {
    const refData = await this.git(['for-each-ref', `--count=${limits.refs + 1}`, '--sort=refname',
      '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)', 'refs/heads/', 'refs/remotes/', 'refs/tags/']);
    const rows = refData.text.trimEnd().split('\n').filter(Boolean);
    if (rows.length > limits.refs) fail('too-many-refs');
    const refs: { name: string, sha: string, kind: string }[] = [], starts = new Set<string>();
    for (const row of rows) {
      const [name, sha, type, peeled, peeledType] = row.split('\0');
      if (!oid.test(sha) || !/^refs\/(heads|remotes|tags)\//.test(name) || name.length > limits.pathBytes) fail('invalid-ref-metadata');
      let target = sha;
      if (type === 'commit') starts.add(sha);
      else if (peeledType === 'commit' && oid.test(peeled)) { target = peeled; starts.add(peeled); }
      else if (type === 'tag') {
        const commit = await this.git(['rev-parse', '--verify', `${sha}^{commit}`], { allowFailure: true });
        if (!commit.failed && oid.test(commit.text.trim())) { target = commit.text.trim(); starts.add(target); }
      }
      refs.push({ name, sha: target, kind: name.startsWith('refs/heads/') ? 'branch' : name.startsWith('refs/remotes/') ? 'remote' : 'tag' });
    }
    const h = await this.git(['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
    const head = !h.failed && oid.test(h.text.trim()) ? h.text.trim() : null;
    const b = await this.git(['symbolic-ref', '--quiet', 'HEAD'], { allowFailure: true });
    const branch = b.failed ? null : b.text.replace(/\r?\n$/, '').replace(/^refs\/heads\//, '');
    if (branch && branch.length > limits.pathBytes) fail('invalid-ref-metadata');
    const shallow = (await this.git(['rev-parse', '--is-shallow-repository'])).text.trim() === 'true';
    if (head) starts.add(head);
    const revision = crypto.createHash('sha256').update(JSON.stringify({ refState: refData.text, head, branch, shallow })).digest('hex');
    return { refs, head, branch, shallow, revision, starts: head ? [head, ...[...starts].filter(id => id !== head)] : [...starts] };
  }
  async commit(sha: string, detail = false) {
    const raw = await this.git(['cat-file', 'commit', sha], { max: limits.metadataBytes, partial: true });
    const boundary = raw.text.indexOf('\n\n');
    if (boundary < 0) fail('commit-metadata-too-large');
    const header = raw.text.slice(0, boundary).split('\n');
    const parents = header.filter(x => x.startsWith('parent ')).map(x => x.slice(7));
    if (parents.some(x => !oid.test(x))) fail('invalid-commit-metadata');
    function identity(name: string) {
      const value = header.find(x => x.startsWith(name + ' '));
      const match = value?.match(/^[^ ]+ (.*) <(.*)> (-?\d+) [+-]\d{4}$/);
      if (!match) fail('invalid-commit-metadata');
      const date = new Date(Number(match[3]) * 1000);
      if (!Number.isFinite(date.getTime())) fail('invalid-commit-metadata');
      return { name: match[1].slice(0, limits.identity), email: match[2].slice(0, limits.identity), at: date.toISOString() };
    }
    const author = identity('author'), committer = identity('committer');
    const message = raw.text.slice(boundary + 2), newline = message.indexOf('\n');
    const subject = (newline < 0 ? message : message.slice(0, newline)).slice(0, limits.subject);
    const result = { sha, parents, subject, authorName: author.name, authorEmail: author.email, authoredAt: author.at, committedAt: committer.at };
    return detail ? { ...result, body: message.slice(0, limits.body), bodyTruncated: raw.overflow || message.length > limits.body } : result;
  }
  async reachable(sha: string, starts: string[]) {
    const type = await this.git(['cat-file', '-t', sha], { allowFailure: true });
    if (type.failed || type.text.trim() !== 'commit') fail('unreachable-commit');
    if (starts.includes(sha)) return;
    for (const tip of starts) {
      const ancestor = await this.git(['merge-base', '--is-ancestor', sha, tip], { allowFailure: true });
      if (!ancestor.failed) return;
    }
    fail('unreachable-commit');
  }
  async files(sha: string, parent: string | null) {
    const data = await this.git([`--attr-source=${sha}`, 'diff-tree', '--no-commit-id', '--raw', '-z', '--no-abbrev', '--no-renames', '-r',
      ...(parent ? [parent, sha] : ['--root', sha]), '--'], { partial: true });
    const entries: any[] = [];
    let position = 0;
    while (position < data.buffer.length && entries.length <= limits.files) {
      const metadataEnd = data.buffer.indexOf(0, position), filenameEnd = data.buffer.indexOf(0, metadataEnd + 1);
      if (metadataEnd < 0 || filenameEnd < 0) { if (!data.overflow) fail('invalid-file-metadata'); break; }
      const meta = data.buffer.subarray(position, metadataEnd).toString('ascii');
      const filenameBytes = data.buffer.subarray(metadataEnd + 1, filenameEnd);
      position = filenameEnd + 1;
      const m = meta.match(/^:(\d{6}) (\d{6}) ([a-f0-9]+) ([a-f0-9]+) ([A-Z])$/);
      if (!m || !oid.test(m[3]) || !oid.test(m[4])) fail('invalid-file-metadata');
      if (!isUtf8(filenameBytes)) fail('unsupported-path-encoding');
      const filename = filenameBytes.toString('utf8');
      entries.push({ path: filename, status: m[5], additions: null, deletions: null, binary: false,
        restricted: restricted(filename) || [m[1], m[2]].some(mode => !['000000', '100644', '100755'].includes(mode)),
        oldMode: m[1], newMode: m[2], oldOid: m[3], newOid: m[4] });
    }
    const truncated = data.overflow || entries.length > limits.files;
    // A literal file path can also select descendants after a file-to-directory change.
    // Never let that pathspec cause Git to inspect another (possibly sensitive) file.
    for (const entry of entries) if (entries.some(other => other.path.startsWith(entry.path + '/'))) entry.restricted = true;
    return { entries: entries.slice(0, limits.files), truncated };
  }
  async sizes(entries: any[]) {
    const ids = [...new Set<string>(entries.filter(e => !e.restricted).flatMap(e => [e.oldOid, e.newOid]).filter(x => !/^0+$/.test(x)))];
    const result = new Map<string, number>();
    if (!ids.length) return result;
    const data = await this.git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], { input: ids.join('\n') + '\n' });
    for (const line of data.text.trim().split('\n')) {
      const [sha, type, size] = line.split(' ');
      if (!oid.test(sha) || type !== 'blob' || !/^\d+$/.test(size) || !Number.isSafeInteger(Number(size))) fail('missing-object');
      result.set(sha, Number(size));
    }
    if (result.size !== ids.length) fail('missing-object');
    return result;
  }
  async comparison(parent: string | null, sha: string, paths: string[], extra: string[], max: number, partial = false) {
    // diff-tree --root avoids hashing/writing an empty-tree object in the repository.
    return this.git([`--attr-source=${sha}`, 'diff-tree', '--root', '--no-commit-id', '-r', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '-O/dev/null',
      ...extra, ...(parent ? [parent, sha] : [sha]), '--', ...paths], { max, partial });
  }
}
function restricted(filename: string) {
  if (!filename || Buffer.byteLength(filename) > limits.pathBytes || filename.startsWith('-') || filename.includes('\\') ||
      /^[\/]|^[a-z]:/i.test(filename) || filename.includes(':') || filename.includes('\0')) return true;
  return filename.split('/').some(part => !part || part === '.' || part === '..' ||
    /^(?:\.git(?:$|[. ])|\.governance$|\.env(?:$|[.])|\.secrets?(?:$|[.])|\.(?:ssh|gnupg|aws|azure|kube|pi|codex|claude)$|\.npmrc$|\.netrc$|\.pypirc$|credentials?(?:$|[.])|(?:secrets?|tokens?|passwords?|keys?)(?:$|[._-])|id_(?:rsa|dsa|ecdsa|ed25519)(?:$|[.])|.*\.(?:pem|key|p12|pfx|keystore)$)/i.test(part));
}
function tooLarge(entry: any, sizes: Map<string, number>) {
  return [entry.oldOid, entry.newOid].some(id => !/^0+$/.test(id) && (!sizes.has(id) || sizes.get(id) > limits.blobBytes));
}
function publicFile(e: any) {
  return { path: e.path, status: e.status, additions: e.additions, deletions: e.deletions, binary: e.binary, restricted: e.restricted };
}
async function gitHistory(root: unknown, payload: unknown) {
  const a = request(payload), workspace = workspaceRoot(root), reader = new Reader(workspace);
  const repository = await reader.git(['rev-parse', '--show-toplevel'], { allowFailure: true });
  if (repository.failed) {
    if (a.action !== 'list') fail('not-repository');
    return { workspace, status: 'not-repository', revision: '', head: null, branch: null, shallow: false, refs: [], commits: [], offset: a.offset, nextOffset: null, limited: false };
  }
  if (canonical(repository.text.trim()) !== canonical(workspace)) fail('repository-root-mismatch');
  const snapshot = await reader.snapshot();
  if (a.revision !== undefined && a.revision !== snapshot.revision) fail('stale-revision');
  let result: any;
  if (a.action === 'list') {
    const ids = snapshot.starts.length ? (await reader.git(['rev-list', '--topo-order', `--skip=${a.offset}`, `--max-count=${a.limit + 1}`, ...snapshot.starts, '--'])).text.trim().split('\n').filter(Boolean) : [];
    if (ids.some(id => !oid.test(id))) fail('invalid-commit-metadata');
    const commits = [];
    for (const sha of ids.slice(0, a.limit)) commits.push(await reader.commit(sha));
    const more = ids.length > a.limit, next = a.offset + commits.length;
    result = { workspace, status: snapshot.starts.length ? 'ready' : 'empty', revision: snapshot.revision, head: snapshot.head,
      branch: snapshot.branch, shallow: snapshot.shallow, refs: snapshot.refs, commits, offset: a.offset,
      nextOffset: more && next <= limits.offset ? next : null, limited: more && next > limits.offset };
  } else {
    await reader.reachable(a.sha, snapshot.starts);
    const commit: any = await reader.commit(a.sha, true), parent = commit.parents[0] ?? null;
    const files = await reader.files(a.sha, parent);
    if (a.action === 'detail') {
      const sizes = await reader.sizes(files.entries);
      const candidates = files.truncated ? [] : files.entries.filter(e => !e.restricted && !tooLarge(e, sizes));
      const chunks: any[][] = [];
      for (const entry of candidates) {
        let chunk = chunks[chunks.length - 1];
        if (!chunk || chunk.reduce((n, e) => n + e.path.length + 3, 0) + entry.path.length > 12000) chunks.push(chunk = []);
        chunk.push(entry);
      }
      for (const chunk of chunks) {
        const stats = await reader.comparison(parent, a.sha, chunk.map(e => e.path), ['--numstat', '-z'], limits.outputBytes);
        const byPath = new Map(chunk.map(e => [e.path, e]));
        for (const row of stats.text.split('\0').filter(Boolean)) {
          const m = row.match(/^(\d+|-)\t(\d+|-)\t([\s\S]*)$/), entry = m && byPath.get(m[3]);
          if (!entry) fail('invalid-file-metadata');
          entry.binary = m[1] === '-'; entry.additions = entry.binary ? null : Number(m[1]); entry.deletions = entry.binary ? null : Number(m[2]);
        }
      }
      result = { workspace, revision: snapshot.revision, commit: { ...commit, files: files.entries.map(publicFile), filesTruncated: files.truncated, comparisonParent: parent } };
    } else {
      // Never search arbitrary trees or the worktree for a user-supplied path.
      if (files.truncated) fail('files-truncated');
      const entry = files.entries.find(e => e.path === a.path);
      if (!entry) fail(files.truncated ? 'files-truncated' : 'path-not-changed');
      let kind = 'text', patch = '', truncated = false;
      if (entry.restricted) kind = 'restricted';
      else {
        const sizes = await reader.sizes([entry]);
        if (tooLarge(entry, sizes)) { kind = 'too-large'; truncated = true; }
        else {
          for (const id of [entry.oldOid, entry.newOid].filter(id => !/^0+$/.test(id))) {
            const blob = await reader.git(['cat-file', 'blob', id], { max: limits.blobBytes + 1 });
            if (blob.buffer.includes(0) || !Buffer.from(blob.text).equals(blob.buffer)) kind = 'binary';
          }
          if (kind === 'text') {
            const diff = await reader.comparison(parent, a.sha, [entry.path], ['--patch', '--text', '--unified=3'], limits.patchBytes, true);
            if (diff.overflow) { kind = 'too-large'; truncated = true; }
            else patch = diff.text;
          }
        }
      }
      result = { workspace, revision: snapshot.revision, sha: a.sha, path: a.path, kind, patch, truncated };
    }
  }
  if ((await reader.snapshot()).revision !== snapshot.revision) fail('stale-revision');
  return result;
}
module.exports = { gitHistory, limits };
