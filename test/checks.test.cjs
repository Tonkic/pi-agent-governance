'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { classify, fromScope, planRange } = require('../scripts/check-plan.cjs');
const { commands, runPlan, validateRecords, unitFiles } = require('../scripts/checks.cjs');
const sha = 'a'.repeat(40), head = 'b'.repeat(40);
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'checks-'));
  fs.mkdirSync(path.join(dir, '.governance'));
  fs.writeFileSync(path.join(dir, 'STATE.json'), '{"version":1}');
  fs.writeFileSync(path.join(dir, '.governance/board.json'), '{"version":1,"items":[]}');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('record-only lane needs no build, dependency install, browser or product suite', () => {
  for (const files of [[], ['STATE.json', '.governance/board.json', 'notes/changes.md', 'changes/active/example/proof.html', 'changes/active/example/screen.png']]) {
    const p = classify(files);
    assert.equal(p.scope, 'records'); assert.equal(p.build, false); assert.equal(p.browser, false);
    assert.deepEqual(p.matrix, ['ubuntu-latest']); assert.deepEqual(commands(p), []);
  }
});
test('canonical and generated docs get layout/distribution checks but no browser', () => {
  const p = classify(['docs/development.md', 'AGENTS.md', 'README.md', 'plugin/docs/development.md', 'plugin/README.md']);
  assert.equal(p.scope, 'docs'); assert.equal(p.browser, false);
  const c = commands(p); assert.deepEqual(c[0], ['scripts/build.cjs']);
  assert.deepEqual(c[1], ['--test', 'test/layout.test.cjs', 'test/distributions.test.cjs']);
});
test('known local reader and entry changes select their existing safety and browser regressions', () => {
  const p = classify(['plugin/renderer/documents.ts', 'plugin/runtime/renderer/documents.js', 'plugin/entry/entry.css', 'docs/web-console.md']);
  assert.equal(p.scope, 'docs,entry,reader');
  const c = commands(p), tests = c.find(a => a[0] === '--test');
  for (const f of ['test/documents.test.cjs', 'test/documents-http.test.cjs', 'test/entry.test.cjs', 'test/layout.test.cjs', 'test/distributions.test.cjs']) assert.ok(tests.includes(f));
  assert.ok(c.some(a => a.join(' ') === 'scripts/check-browser.cjs reader'));
  assert.ok(c.some(a => a[0] === 'test/entry-browser.cjs'));
  assert.equal(c.some(a => a[0] === 'scripts/check-behaviors.cjs'), false, 'No unrelated core browser run');
});
test('shared, safety, package, dependency, workflow and unknown changes always escalate even when mixed with records', () => {
  for (const file of ['plugin/renderer/views.css', 'plugin/renderer/panel.ts', 'plugin/renderer/i18n.ts', 'plugin/documents.ts', 'plugin/entry-bridge.ts', 'plugin/git.ts', 'mcp/server.ts', 'web/bridge.js', 'package.json', 'package-lock.json', 'plugin/manifest.json', 'plugin/dist/new.piplug', 'scripts/build.cjs', '.github/workflows/test.yml', 'docs/behavior-bindings.json', 'test/new.test.cjs', 'unknown.txt']) {
    const p = classify(['STATE.json', file]); assert.equal(p.full, true, file); assert.equal(p.browser, true); assert.equal(p.matrix.length, 2);
  }
});
test('odd or unsafe names cannot disguise unknown product changes as a record', () => {
  for (const file of ['/docs/a.md', '../docs/a.md', 'docs/../plugin/core.ts', 'docs\\a.md', 'docs//a.md', 'plugin/core.ts\nnotes/change.md', 'README.md\n', 'docs/a.md\0plugin/core.ts']) assert.equal(classify([file]).full, true, file);
});
test('range comparison preserves NUL names and disables rename detection, missing history falls back to full', () => {
  const calls = [];
  const p = planRange(sha, head, (...args) => { calls.push(args); return 'plugin/core.ts\0docs/renamed.md\0'; });
  assert.equal(p.full, true); assert.deepEqual(calls, [['diff', '--name-only', '--no-renames', '-z', sha, head, '--']]);
  assert.equal(planRange(sha, head, () => { throw Error('shallow'); }).full, true);
  for (const base of [undefined, '', '0'.repeat(40), '--name-only', 'main']) assert.equal(planRange(base, head, () => assert.fail('must not invoke Git')).full, true);
  assert.equal(planRange(sha, head, () => 'docs/中文标题.md\0').scope, 'docs');
  assert.equal(planRange(sha, head, () => 'docs/中文\n标题.md\0').scope, 'full');
});
test('real Git rename from product to docs and mixed commits cannot enter the docs fast lane', t => {
  const dir = temporary(t), git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '--quiet'); git('config', 'user.name', 'Check Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.mkdirSync(path.join(dir, 'plugin')); fs.writeFileSync(path.join(dir, 'plugin/core.ts'), 'source');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'base'); const base = git('rev-parse', 'HEAD').trim();
  fs.mkdirSync(path.join(dir, 'docs')); fs.renameSync(path.join(dir, 'plugin/core.ts'), path.join(dir, 'docs/renamed.md'));
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'rename');
  assert.equal(planRange(base, git('rev-parse', 'HEAD').trim(), git).full, true);
});
test('full and browser commands build once and execute core browser only through behavior verification', () => {
  for (const scope of ['full', 'browser', 'unit', 'docs', 'reader', 'entry', 'docs,reader,entry']) {
    const c = commands(fromScope(scope)); assert.equal(c.filter(a => a[0] === 'scripts/build.cjs').length, 1, scope);
    assert.equal(c.some(a => a[0] === 'test/browser.cjs'), false);
    assert.equal(c.filter(a => a[0] === 'scripts/check-behaviors.cjs').length, ['full', 'browser'].includes(scope) ? 1 : 0);
  }
  const full = commands(fromScope('full'));
  assert.deepEqual(full.find(a => a[0] === '--test').slice(1), unitFiles);
  for (const file of ['test/web-browser.cjs', 'test/workbench-browser.cjs', 'test/entry-browser.cjs']) assert.equal(full.filter(a => a[0] === file).length, 1);
  const behavior = fs.readFileSync(path.join(__dirname, '../scripts/check-behaviors.cjs'), 'utf8');
  assert.match(behavior, /run\(path\.join\(root, 'test\/browser\.cjs'\)/);
  for (const key of ['sourceCommit', 'workingTree', 'contractFingerprint', 'runId']) assert.ok(behavior.includes(key));
});
test('failure stops later checks and CI checks generated files immediately after its single build', t => {
  const dir = temporary(t), calls = [];
  assert.throws(() => runPlan(fromScope('entry'), { directory: dir, ci: true, git: a => calls.push(['git', ...a]), run: a => { calls.push(a); if (a[0] === '--test') throw Error('test failed'); } }), /test failed/);
  assert.deepEqual(calls.slice(0, 3), [['git', 'diff', '--check'], ['scripts/build.cjs'], ['git', 'diff', '--exit-code', '--', 'plugin', 'scripts', 'test']]);
  assert.equal(calls.some(a => a[0] === 'test/entry-browser.cjs'), false);
});
test('record lane validates JSON and never starts a child test or build', t => {
  const dir = temporary(t); fs.writeFileSync(path.join(dir, 'STATE.json'), '{"version":1}');
  runPlan(fromScope('records'), { directory: dir, git: () => {}, run: () => assert.fail('No child command') });
  for (const text of ['{', 'null', '[]', '{"version":2}']) { fs.writeFileSync(path.join(dir, 'STATE.json'), text); assert.throws(() => validateRecords(dir)); }
  fs.unlinkSync(path.join(dir, 'STATE.json')); assert.throws(() => validateRecords(dir), /Missing record/);
  fs.writeFileSync(path.join(dir, 'STATE.json'), '{"version":1}');
  fs.writeFileSync(path.join(dir, '.governance/board.json'), '{"version":1,"items":null}'); assert.throws(() => validateRecords(dir), /Invalid record shape/);
});
test('unknown or combined privileged scopes fail closed; CLI rejects invalid flags before running commands', () => {
  for (const scope of ['other', '', 'docs,full', 'records,reader', 'docs,docs', 'browser,reader', 'reader;echo x']) assert.throws(() => fromScope(scope));
  const result = require('node:child_process').spawnSync(process.execPath, ['scripts/checks.cjs', '--scope', 'other'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /Unknown check scope/); assert.doesNotMatch(result.stdout, /Built/);
});
