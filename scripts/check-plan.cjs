'use strict';
// Deliberately small allowlist, not a dependency-graph or risk-scoring framework.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sha = /^[a-f0-9]{40}$/;
const localFiles = {
  reader: ['plugin/renderer/documents.ts', 'plugin/renderer/documents.css', 'plugin/runtime/renderer/documents.js', 'test/documents-browser.cjs', 'test/reader-typography-browser.cjs'],
  entry: ['plugin/entry/index.html', 'plugin/entry/entry.css', 'plugin/entry/entry.js', 'test/entry-browser.cjs']
};
function fromScope(scope, reason = 'explicit-scope') {
  const groups = scope.split(',');
  if (!groups.length || new Set(groups).size !== groups.length || groups.some(g => !['records', 'docs', 'reader', 'entry', 'full', 'unit', 'browser'].includes(g))) throw Error('Unknown check scope');
  if (groups.length > 1 && groups.some(g => ['records', 'full', 'unit', 'browser'].includes(g))) throw Error('Invalid combined scope');
  const full = groups.includes('full');
  return { scope, reason, full, build: scope !== 'records', browser: full || groups.some(g => ['reader', 'entry', 'browser'].includes(g)), matrix: full || ['unit', 'browser'].includes(scope) ? ['ubuntu-latest', 'windows-latest'] : ['ubuntu-latest'] };
}
function classify(files) {
  const groups = new Set();
  for (const file of files) {
    if (typeof file !== 'string' || !file || file.startsWith('/') || file.includes('\\') || file.split('/').some(p => !p || p === '.' || p === '..')) return fromScope('full', 'unknown-path');
    if (['STATE.json', '.governance/board.json'].includes(file) || /^(?:notes|changes)\/.+\.(?:md|png|html)$/.test(file)) continue;
    if (['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'LICENSE.md', 'plugin/README.md'].includes(file) || /^(?:docs|plugin\/docs)\/.+\.md$/.test(file)) { groups.add('docs'); continue; }
    const group = Object.keys(localFiles).find(key => localFiles[key].includes(file));
    if (!group) return fromScope('full', 'public-or-unknown-change');
    groups.add(group);
  }
  return fromScope([...groups].sort().join(',') || 'records', files.length ? 'changed-files' : 'no-product-change');
}
function planRange(base, head, git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 60000 })) {
  if (!sha.test(base || '') || /^0+$/.test(base) || !sha.test(head || '')) return fromScope('full', 'base-unavailable');
  try {
    // No rename detection: both old and new paths must be classified. NUL keeps odd names intact.
    const names = git('diff', '--name-only', '--no-renames', '-z', base, head, '--').split('\0').filter(Boolean);
    return classify(names);
  } catch { return fromScope('full', 'base-unavailable'); }
}
function main(args = process.argv.slice(2), env = process.env) {
  let base = env.CHECK_BASE, head = env.CHECK_HEAD, full = env.CHECK_FULL === 'true', output = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--full') full = true;
    else if (args[i] === '--github-output') output = true;
    else if (args[i] === '--base' && args[i + 1]) base = args[++i];
    else if (args[i] === '--head' && args[i + 1]) head = args[++i];
    else throw Error('Usage: check:plan [--base FULL_SHA --head FULL_SHA] [--full] [--github-output]');
  }
  const plan = full ? fromScope('full', 'forced-full') : planRange(base, head);
  if (output) {
    if (!env.GITHUB_OUTPUT) throw Error('Missing GitHub output file');
    fs.appendFileSync(env.GITHUB_OUTPUT, `scope=${plan.scope}\nbrowser=${plan.browser}\nmatrix=${JSON.stringify(plan.matrix)}\n`);
  }
  console.log(JSON.stringify(plan));
  return plan;
}
module.exports = { classify, fromScope, planRange, main };
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
