'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const repository = 'Tonkic/pi-agent-governance';
const fail = message => { throw Error(message); };
function fullSha(ref) { if (!/^[a-f0-9]{40}$/.test(ref || '')) fail('A full commit SHA is required'); return ref; }
function gitAt(root) {
  return (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
function validatePushRemote(remote) {
  if (!['https://github.com/Tonkic/pi-agent-governance.git', 'https://github.com/Tonkic/pi-agent-governance', 'git@github.com:Tonkic/pi-agent-governance.git'].includes(remote)) fail('Unexpected push remote');
}
function untrackedGuard(raw) {
  if (raw.split('\0').filter(Boolean).some(file => !file.startsWith('.pi/') && !file.startsWith('changes/archive/redesign-governance-panel/'))) fail('Unexpected untracked files; inspect before release');
}
function clean(root, sourceRef) {
  fullSha(sourceRef);
  const git = gitAt(root);
  if (git('rev-parse', 'HEAD').trim() !== sourceRef || git('status', '--porcelain', '--untracked-files=no').trim()) fail('HEAD changed or tracked worktree is dirty');
  untrackedGuard(git('ls-files', '-z', '--others', '--exclude-standard'));
}
function containsCredential(object, bytes, token) {
  // Actual supplied credentials take precedence over the sole approved fixture exception.
  if (token && bytes.includes(Buffer.from(token))) return true;
  let text = bytes.toString('utf8');
  if (object === 'd2c45515b924a1f69d92ef00b771e77b7318bbfe') {
    for (const fixture of ['fixtureCredential123', 'otherCredential123']) text = text.split('pi_pat_' + fixture).join('');
  }
  return /pi_pat_[A-Za-z0-9_-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
    || new RegExp('gh[pousr]_' + '[A-Za-z0-9]{30,}|github_pat_' + '[A-Za-z0-9_]{30,}').test(text);
}
function secretScan(root, sourceRef, tokens = []) {
  fullSha(sourceRef);
  const git = gitAt(root);
  for (const row of git('rev-list', '--objects', sourceRef).trim().split('\n')) {
    if (/\s(?:.*\/)?\.secrets(?:\/|$)/.test(row)) fail('Secret path found in reachable history');
    const object = row.split(' ')[0];
    const bytes = execFileSync('git', ['cat-file', '-p', object], { cwd: root, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    if (containsCredential(object, bytes) || tokens.some(token => containsCredential(object, bytes, token))) fail('Credential-like content found in reachable history');
  }
}
function refreshGeneratedIndex(runGit) {
  const outputs = ['plugin/runtime/', 'plugin/docs/', 'plugin/main.js', 'plugin/manifest.json', 'plugin/README.md'];
  const rows = runGit('status', '--porcelain=v1', '--untracked-files=no', '--', ...outputs).split(/\r?\n/).filter(Boolean);
  const files = [];
  for (const row of rows) {
    const file = row.slice(3);
    const generated = outputs.some(output => output.endsWith('/') ? file.startsWith(output) : file === output);
    if (!row.startsWith(' M ') || !generated) fail('Unexpected generated-output status; inspect before release');
    const head = runGit('rev-parse', 'HEAD:' + file).trim();
    const index = runGit('rev-parse', ':' + file).trim();
    const actual = runGit('hash-object', '--path=' + file, '--', file).trim();
    if (actual !== head || index !== head) fail('Generated output differs from HEAD/index; inspect before release');
    files.push(file);
  }
  if (files.length) runGit('add', '--', ...files);
}
function safeFile(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.startsWith('/') || relative.split('/').some(p => !p || p === '.' || p === '..' || /[:\x00-\x1f]/.test(p))) fail('Unsafe path');
  let current = root;
  if (fs.lstatSync(current).isSymbolicLink()) fail('Linked source/output refused');
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) fail('Linked source/output refused'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return current;
}
module.exports = { repository, fullSha, gitAt, validatePushRemote, untrackedGuard, clean, containsCredential, secretScan, refreshGeneratedIndex, safeFile };
