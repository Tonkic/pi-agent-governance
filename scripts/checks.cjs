'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { fromScope, planRange } = require('./check-plan.cjs');
const root = path.resolve(__dirname, '..');
const unitFiles = [
  'build/test/git.test.js', 'build/test/governance.test.js', 'build/test/panel.test.js', 'build/test/project.test.js', 'build/test/operations.test.js',
  'test/release.test.cjs', 'test/layout.test.cjs', 'test/behaviors.test.cjs', 'test/design.test.cjs', 'test/mcp.test.cjs', 'test/distributions.test.cjs',
  'test/web.test.cjs', 'test/host-context.test.cjs', 'test/workbench.test.cjs', 'test/unified-browser.test.cjs', 'test/entry.test.cjs', 'test/documents.test.cjs', 'test/documents-http.test.cjs', 'test/checks.test.cjs',
  'test/collaboration.test.cjs', 'test/ascii-authority.test.cjs',
  'test/git-history.test.cjs', 'test/update-plan.test.cjs', 'test/remote-program.test.cjs', 'test/remote-ssh.test.cjs'
];
function commands(plan) {
  const groups = plan.scope.split(','), result = [];
  if (!plan.build) return result;
  if (plan.full) {
    const tsc = path.resolve(path.dirname(require.resolve('typescript/package.json')), require('typescript/package.json').bin.tsc);
    for (const config of ['tsconfig.json', 'plugin/renderer/tsconfig.json']) result.push([tsc, '--project', config, '--noEmit']);
  }
  result.push(['scripts/build.cjs']);
  if (plan.full || groups.includes('unit')) result.push(['--test', ...unitFiles]);
  else if (!groups.includes('browser')) {
    const tests = new Set(['test/layout.test.cjs', 'test/distributions.test.cjs']);
    if (groups.includes('reader')) { tests.add('test/documents.test.cjs'); tests.add('test/documents-http.test.cjs'); }
    if (groups.includes('entry')) tests.add('test/entry.test.cjs');
    result.push(['--test', ...tests]);
  }
  if (plan.full || groups.includes('browser')) {
    // This runs browser.cjs ONCE and retains its source-bound behavior evidence.
    result.push(['scripts/check-behaviors.cjs'], ['test/web-browser.cjs'], ['test/workbench-browser.cjs'], ['test/entry-browser.cjs']);
  } else {
    if (groups.includes('reader')) result.push(['scripts/check-browser.cjs', 'reader']);
    if (groups.includes('entry')) result.push(['test/entry-browser.cjs']);
  }
  return result;
}
function validateRecords(directory = root) {
  for (const file of ['STATE.json', '.governance/board.json']) {
    const full = path.join(directory, file);
    if (!fs.existsSync(full)) throw Error(`Missing record file: ${file}`);
    const stat = fs.lstatSync(full);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw Error(`Invalid record file: ${file}`);
    const record = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (!record || typeof record !== 'object' || Array.isArray(record) || record.version !== 1 || (file.endsWith('board.json') && !Array.isArray(record.items))) throw Error(`Invalid record shape: ${file}`);
  }
}
function runPlan(plan, { directory = root, ci = false, run = args => execFileSync(process.execPath, args, { cwd: directory, stdio: 'inherit' }), git = args => execFileSync('git', args, { cwd: directory, stdio: 'inherit' }) } = {}) {
  console.log(`Checks: ${plan.scope} (${plan.reason}); build=${plan.build}, browser=${plan.browser}`);
  validateRecords(directory);
  git(['diff', '--check']);
  for (const args of commands(plan)) {
    run(args);
    if (ci && args[0] === 'scripts/build.cjs') git(['diff', '--exit-code', '--', 'plugin', 'scripts', 'test']);
  }
  console.log(`PASS checks: ${plan.scope}`);
}
function main(args = process.argv.slice(2)) {
  let scope, base, head, ci = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--full') { if (scope) throw Error('Choose one scope'); scope = 'full'; }
    else if (args[i] === '--unit' || args[i] === '--browser') { if (scope) throw Error('Choose one scope'); scope = args[i].slice(2); }
    else if (args[i] === '--scope' && args[i + 1]) { if (scope) throw Error('Choose one scope'); scope = args[++i]; }
    else if (args[i] === '--base' && args[i + 1]) base = args[++i];
    else if (args[i] === '--head' && args[i + 1]) head = args[++i];
    else if (args[i] === '--ci') ci = true;
    else throw Error('Usage: check [--full | --scope records|docs|reader|entry | --base FULL_SHA --head FULL_SHA] [--ci]');
  }
  if (scope && (base || head)) throw Error('Choose scope or committed range, not both');
  const plan = scope ? fromScope(scope) : base || head ? planRange(base, head) : fromScope('full', 'safe-default');
  // A CI-selected scope is fixed by check-plan; callers cannot supply arbitrary commands.
  runPlan(plan, { ci });
}
module.exports = { unitFiles, commands, validateRecords, runPlan, main };
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
