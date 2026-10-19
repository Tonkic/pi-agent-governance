'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { nextVersion, updatePlan, main } = require('../scripts/update-plan.cjs');
const plan = (messages, extra = {}) => updatePlan({ version: '0.8.3', productChanged: true, messages, ...extra });
test('fix and performance polish increment patch and never require marketplace', () => {
  for (const message of ['fix: correct Git popup', 'perf(git): batch reads', 'refactor: simplify graph']) {
    const p = plan([message]); assert.equal(p.nextVersion, '0.8.4'); assert.equal(p.marketplaceRequired, false); assert.equal(p.mutation, false);
  }
});
test('new features are minor and require checked marketplace delivery', () => {
  const p = plan(['fix: tooltip', 'feat: add new capability']); assert.equal(p.nextVersion, '0.9.0'); assert.equal(p.marketplaceRequired, true);
  assert.equal(nextVersion('1.2.4', 'minor'), '1.3.0');
});
test('breaking changes obey pre-1 and stable SemVer with marketplace assessment', () => {
  assert.equal(plan(['feat(api)!: remove contract']).nextVersion, '0.9.0');
  assert.equal(plan(['fix: migration\n\nBREAKING CHANGE: remove endpoint'], { version: '1.2.4' }).nextVersion, '2.0.0');
  assert.equal(plan(['fix!: migration']).marketplaceRequired, true);
});
test('records-only never changes version or publishes even when messages say feat', () => {
  const p = plan(['feat: documented feature'], { productChanged: false, impact: 'major' }); assert.equal(p.nextVersion, '0.8.3'); assert.equal(p.impact, 'none'); assert.equal(p.marketplaceRequired, false);
});
test('unknown product changes require semantic assessment instead of guessing from size', () => {
  assert.equal(plan(['Changed many files']).status, 'needs-assessment'); assert.equal(plan([]).status, 'needs-assessment');
  assert.equal(plan(['fix: known', 'unknown change']).status, 'needs-assessment');
  const p = plan(['unknown change'], { impact: 'patch' }); assert.equal(p.nextVersion, '0.8.4'); assert.equal(p.reason, 'reviewed-semantic-assessment');
});
test('invalid versions, impacts and revision expressions fail closed', () => {
  for (const v of ['v1.0.0', '01.0.0', '1.0.0-beta', '1.0.0\n', '99999999999999999999.0.0']) assert.throws(() => nextVersion(v, 'patch'));
  assert.throws(() => nextVersion('1.0.0', '__proto__')); assert.throws(() => plan(['fix: x'], { impact: 'automatic' }));
  assert.throws(() => main(['--base', 'HEAD~1', '--head', 'HEAD']), /Exact/);
  assert.throws(() => main(['--write']), /Use/);
});
test('CLI binds actual base and head, checks version, and leaves repository bytes unchanged', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'update-plan-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.8.3"}'); git('add', '.'); git('commit', '-m', 'chore: base'); const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.8.4"}'); git('add', '.'); git('commit', '-m', 'fix: release patch'); const head = git('rev-parse', 'HEAD');
  const original = fs.readFileSync(path.join(root, 'package.json')), output = console.log; console.log = () => {}; t.after(() => { console.log = output; });
  const result = main(['--base', base, '--head', head, '--check'], root); assert.equal(result.versionMatches, true); assert.equal(result.marketplaceRequired, false);
  assert.throws(() => main(['--base', base, '--head', head, '--impact', 'minor', '--check'], root), /resolved/);
  assert.equal(git('status', '--porcelain'), ''); assert.deepEqual(fs.readFileSync(path.join(root, 'package.json')), original);
});
