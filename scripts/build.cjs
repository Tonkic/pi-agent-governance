'use strict';
// Only fixed compiler-owned output directories are removed. No package/data cleanup.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const build = path.join(root, 'build');
const runtime = path.join(root, 'plugin/runtime');
for (const dir of [build, runtime]) {
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw Error('Refusing linked output directory');
}
fs.rmSync(build, { recursive: true, force: true });
const tsc = path.resolve(path.dirname(require.resolve('typescript/package.json')), require('typescript/package.json').bin.tsc);
for (const config of ['tsconfig.json', 'plugin/renderer/tsconfig.json']) {
  execFileSync(process.execPath, [tsc, '--project', config], { cwd: root, stdio: 'inherit' });
}
execFileSync(process.execPath, [path.join(build, 'scripts/build-manifest.js')], { cwd: root, stdio: 'inherit' });
fs.rmSync(runtime, { recursive: true, force: true });
fs.cpSync(path.join(build, 'plugin'), runtime, { recursive: true });
// Test fixtures use the compiled tree; installed HTML uses plugin/runtime scripts.
fs.cpSync(runtime, path.join(build, 'plugin/runtime'), { recursive: true });
for (const file of ['renderer/index.html', 'renderer/panel.css', 'renderer/views.css', 'manifest.json']) {
  fs.copyFileSync(path.join(root, 'plugin', file), path.join(build, 'plugin', file));
}
console.log('Built plugin/runtime; tooling and tests are in build/');
