'use strict';
// Local/CI validation and planning only. No push, tag creation or publication.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const safety = require('./release-safety.cjs');
const root = path.resolve(__dirname, '..');
const stableTagPattern = /^v[1-9]\d*\.(?:0|[1-9]\d*)\.0(?![\s\S])/; // Strict end, including no final newline.
function decision(tag, version) {
  const eligible = typeof tag === 'string' && stableTagPattern.test(tag);
  if (eligible && tag.slice(1) !== version) throw Error('Tag/package version mismatch');
  return { publish: eligible, reason: eligible ? 'stable-major-minor-tag' : 'not-stable-major-minor-tag' };
}
function validatePolicy(policy) {
  const expected = { enabled: true, rule: 'stable-major-minor-tag-only', repository: safety.repository, targets: ['mcp-skills', 'pi-desktop'], allowSupersede: false, npmPublish: false, marketplacePublish: false, autoInstall: false, createTags: false };
  if (JSON.stringify(policy) !== JSON.stringify(expected)) throw Error('Policy changed; renewed human approval required');
}
function validateSource(rootDir, sourceRef, tag, runGit = safety.gitAt(rootDir)) {
  safety.fullSha(sourceRef);
  if (!stableTagPattern.test(tag || '')) throw Error('Only stable major/minor vX.Y.0 release tags with X>=1 are eligible');
  if (runGit('rev-parse', `refs/tags/${tag}^{commit}`).trim() !== sourceRef) throw Error('Tag/source mismatch');
  runGit('merge-base', '--is-ancestor', sourceRef, 'refs/remotes/origin/main');
}
function refreshGeneratedIndex(runGit = safety.gitAt(root)) { return safety.refreshGeneratedIndex(runGit); }
function runChecks() {
  const npm = process.env.npm_execpath;
  if (!npm || !fs.existsSync(npm)) throw Error('Run through npm run release:auto');
  for (const script of ['typecheck', 'build', 'test', 'check:behaviors', 'test:browser']) execFileSync(process.execPath, [npm, 'run', script], { cwd: root, stdio: 'inherit' });
  refreshGeneratedIndex();
}
function main(args = process.argv.slice(2)) {
  validatePolicy(JSON.parse(fs.readFileSync(path.join(root, 'scripts/release-policy.json'), 'utf8')));
  const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const plan = decision(tag, version);
  if (args[0] === '--gate' && args.length === 1) {
    if (process.env.GITHUB_REPOSITORY !== safety.repository) throw Error('Unexpected repository');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `eligible=${plan.publish}\n`);
    console.log(JSON.stringify(plan)); return plan;
  }
  const preview = args[0] === '--plan';
  if (preview) args = args.slice(1);
  if (args.length > 1) throw Error('Usage: release:auto [--plan] [FULL_SHA]; validation only');
  const git = safety.gitAt(root);
  const sourceRef = safety.fullSha(args[0] || git('rev-parse', 'HEAD').trim());
  if (!preview) runChecks();
  refreshGeneratedIndex(git);
  safety.clean(root, sourceRef);
  safety.validatePushRemote(git('remote', 'get-url', '--push', '--all', 'origin').trim());
  safety.secretScan(root, sourceRef, [process.env.GITHUB_TOKEN].filter(Boolean));
  if (plan.publish) validateSource(root, sourceRef, tag);
  const result = { ...plan, version, sourceRef, mode: preview ? 'plan' : 'validate', mutation: false, publication: 'GitHub Actions final job only; source integration/push remains external' };
  console.log(JSON.stringify(result)); return result;
}
module.exports = { ...safety, decision, validatePolicy, validateSource, refreshGeneratedIndex, main };
if (require.main === module) { try { main(); } catch { console.error('Release validation blocked; inspect local checks/source. No publication or retry performed.'); process.exitCode = 1; } }
