'use strict';
const fs = require('node:fs');
const path = require('node:path');
const docFiles = [
  'README.md',
  'start/mcp.md',
  'start/web-console.md',
  'guides/doc-driven.md',
  'guides/documentation.md',
  'guides/git.md',
  'guides/collaboration.md',
  'reference/architecture.md',
  'reference/governance.md',
  'reference/project.md',
  'reference/architecture-design.md',
  'reference/behavior-workspace.md',
  'ops/development.md',
  'ops/publishing.md',
  'ops/releasing.md',
  'ops/ui-sources.md'
];
const marker = '<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->\n';
const repository = 'https://github.com/Tonkic/pi-agent-governance/blob/main/';
function render(text, entry = false) {
  return (
    marker +
    text.replace(/\r\n/g, '\n').replace(/\]\(([^)]+)\)/g, (match, link) => {
      if (/^(?:https?:|#)/.test(link)) return match;
      if (link.startsWith('../../')) return `](${repository}${link.slice(6)})`;
      if (/^\.\.\/(?:notes|changes)\//.test(link)) return `](${repository}${link.slice(3)})`;
      if (link.startsWith('../')) return match;
      return `](${entry ? 'docs/' : ''}${link})`;
    })
  );
}
function entryStat(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function regular(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw Error('Refusing linked or non-file documentation: ' + file);
}
function checkDirectory(dir) {
  const stat = entryStat(dir);
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw Error('Refusing linked documentation directory: ' + dir);
  return true;
}
function inspectExisting(output, allowedFiles, allowedDirs, rel = '') {
  const current = rel ? path.join(output, rel) : output;
  if (!checkDirectory(current)) return;
  for (const name of fs.readdirSync(current)) {
    const childRel = rel ? `${rel}/${name}` : name;
    const childPath = path.join(output, childRel);
    const stat = fs.lstatSync(childPath);
    if (stat.isSymbolicLink()) throw Error('Refusing linked documentation output: ' + childPath);
    if (stat.isDirectory()) {
      if (!allowedDirs.has(childRel)) throw Error('Unknown generated documentation directory: ' + childRel);
      inspectExisting(output, allowedFiles, allowedDirs, childRel);
    } else if (!allowedFiles.has(childRel)) {
      throw Error('Unknown generated documentation file: ' + childRel);
    }
  }
}
function generate(root) {
  const plugin = path.join(root, 'plugin');
  const source = path.join(root, 'docs');
  const output = path.join(plugin, 'docs');
  for (const dir of [plugin, source, output]) checkDirectory(dir);
  const subdirs = new Set(docFiles.map((f) => path.posix.dirname(f)).filter((d) => d !== '.'));
  for (const sub of subdirs) {
    checkDirectory(path.join(source, sub));
    checkDirectory(path.join(output, sub));
  }
  const expected = new Map(
    docFiles.map((file) => {
      const input = path.join(source, file);
      regular(input);
      return [path.join(output, file), render(fs.readFileSync(input, 'utf8'))];
    })
  );
  expected.set(
    path.join(plugin, 'README.md'),
    render(fs.readFileSync(path.join(source, 'README.md'), 'utf8'), true)
  );
  // Preflight every output before writing anything. Never delete unknown/user files.
  inspectExisting(output, new Set(docFiles), subdirs);
  for (const target of expected.keys()) {
    if (!entryStat(target)) continue;
    regular(target);
    if (!fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').startsWith(marker))
      throw Error('Refusing hand-written documentation output: ' + target);
  }
  fs.mkdirSync(output, { recursive: true });
  for (const sub of subdirs) fs.mkdirSync(path.join(output, sub), { recursive: true });
  for (const [target, text] of expected) fs.writeFileSync(target, text, 'utf8');
}
module.exports = { docFiles, marker, render, generate };
if (require.main === module) generate(path.resolve(__dirname, '..'));
