'use strict';
// Read-only update classification. This never edits versions or calls publication APIs.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const rank = { none: 0, patch: 1, minor: 2, major: 3 };
function nextVersion(version, impact) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/.test(version)) throw Error('Stable semantic version required');
  const parts = version.split('.').map(Number);
  if (parts.some(n => !Number.isSafeInteger(n))) throw Error('Version outside safe range');
  if (!Object.hasOwn(rank, impact)) throw Error('Invalid impact');
  if (impact === 'major') { if (parts[0] === 0) { parts[1]++; parts[2] = 0; } else { parts[0]++; parts[1] = parts[2] = 0; } }
  else if (impact === 'minor') { parts[1]++; parts[2] = 0; }
  else if (impact === 'patch') parts[2]++;
  if (parts.some(n => !Number.isSafeInteger(n))) throw Error('Version outside safe range');
  return parts.join('.');
}
function updatePlan({ version, messages, productChanged, impact }) {
  nextVersion(version, 'none');
  if (typeof productChanged !== 'boolean' || !Array.isArray(messages) || messages.some(m => typeof m !== 'string') || impact !== undefined && !['patch', 'minor', 'major'].includes(impact)) throw Error('Invalid update assessment');
  let level = 'none', unknown = false;
  if (productChanged) for (const message of messages) {
    const subject = message.split(/\r?\n/)[0];
    const header = subject.match(/^(feat|fix|perf|refactor|build|test|ci|docs|chore)(?:\([^\r\n)]*\))?(!)?: /);
    let candidate;
    if (/^BREAKING[ -]CHANGE: /m.test(message) || header?.[2]) candidate = 'major';
    else if (header?.[1] === 'feat') candidate = 'minor';
    else if (header) candidate = 'patch';
    else if (/^Merge\b/.test(subject)) continue;
    else { unknown = true; continue; }
    if (rank[candidate] > rank[level]) level = candidate;
  }
  if (!productChanged) level = 'none';
  else if (impact) level = impact;
  else if (unknown || level === 'none') return { status: 'needs-assessment', currentVersion: version, nextVersion: null, impact: null, marketplaceRequired: false, mutation: false, reason: 'Agent must assess approved behavior/contract changes, not file counts or version size' };
  return { status: 'ready', currentVersion: version, nextVersion: nextVersion(version, level), impact: level, marketplaceRequired: level === 'minor' || level === 'major', mutation: false, reason: impact && productChanged ? 'reviewed-semantic-assessment' : productChanged ? 'conventional-commit-assessment' : 'records-only' };
}
function main(argv, cwd = path.resolve(__dirname, '..')) {
  const options = {}; let check = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check' && !check) { check = true; continue; }
    const key = argv[i]; if (!['--base', '--head', '--impact'].includes(key) || options[key] !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('Use --base FULL_SHA --head FULL_SHA [--impact patch|minor|major] [--check]');
    options[key] = argv[++i];
  }
  if (![options['--base'], options['--head']].every(s => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s))) throw Error('Exact committed base/head SHAs required');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  const base = options['--base'], head = options['--head'];
  git('merge-base', '--is-ancestor', base, head);
  const paths = git('diff', '--no-renames', '--name-only', '-z', base, head, '--').split('\0').filter(Boolean);
  const productChanged = paths.some(p => /^(?:plugin\/(?!docs\/|dist\/|README\.md)|mcp\/|web\/|types\/|scripts\/|package(?:-lock)?\.json$)/.test(p));
  const messages = git('log', '--no-merges', '--format=%B%x00', `${base}..${head}`, '--').split('\0').map(m => m.trim()).filter(Boolean);
  const version = JSON.parse(git('show', `${base}:package.json`)).version;
  const actualVersion = JSON.parse(git('show', `${head}:package.json`)).version;
  const result = { ...updatePlan({ version, messages, productChanged, impact: options['--impact'] }), base, head, actualVersion };
  result.versionMatches = result.status === 'ready' && actualVersion === result.nextVersion;
  console.log(JSON.stringify(result));
  if (check && (!result.versionMatches || result.status !== 'ready')) throw Error('Version/update assessment must be resolved before delivery');
  return result;
}
module.exports = { nextVersion, updatePlan, main };
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
