'use strict';
const fs = require('node:fs');
const path = require('node:path');
const docFiles = [
  'README.md',
  'governance.md',
  'git.md',
  'project.md',
  'documentation.md',
  'architecture.md',
  'development.md',
  'publishing.md',
  'releasing.md',
  'ui-sources.md'
];
const marker = '<!-- Generated from docs/ by scripts/build-docs.cjs. Do not edit. -->\n';
const repository = 'https://github.com/Tonkic/pi-agent-governance/blob/main/';
function render(text, entry = false) {
  return (
    marker +
    text.replace(/\r\n/g, '\n').replace(/\]\(([^)]+)\)/g, (match, link) => {
      if (/^(?:https?:|#)/.test(link)) return match;
      if (link.startsWith('../')) return `](${repository}${link.slice(3)})`;
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
function generate(root) {
  const plugin = path.join(root, 'plugin');
  const source = path.join(root, 'docs');
  const output = path.join(plugin, 'docs');
  for (const dir of [plugin, source, output]) {
    const stat = entryStat(dir);
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw Error('Refusing linked documentation directory: ' + dir);
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
  if (fs.existsSync(output)) {
    for (const file of fs.readdirSync(output)) {
      if (!docFiles.includes(file)) throw Error('Unknown generated documentation file: ' + file);
    }
  }
  for (const target of expected.keys()) {
    if (!entryStat(target)) continue;
    regular(target);
    if (!fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').startsWith(marker))
      throw Error('Refusing hand-written documentation output: ' + target);
  }
  fs.mkdirSync(output, { recursive: true });
  for (const [target, text] of expected) fs.writeFileSync(target, text, 'utf8');
}
module.exports = { docFiles, marker, render, generate };
if (require.main === module) generate(path.resolve(__dirname, '..'));
