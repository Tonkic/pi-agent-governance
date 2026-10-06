'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
test('compiled JavaScript is separated and runtime exactly matches compiler output', () => {
  const sources = ['main', 'core', 'git', 'panel', 'project', 'tool'];
  const renderer = ['i18n', 'graph-model', 'graph', 'panel'];
  for (const file of [...sources.map(f => `${f}.js`), ...renderer.map(f => `renderer/${f}.js`)]) {
    assert.equal(fs.existsSync(path.join(root, 'plugin', file)), false, `No adjacent output: ${file}`);
    assert.deepEqual(fs.readFileSync(path.join(root, 'plugin/runtime', file)), fs.readFileSync(path.join(root, 'build/plugin', file)));
  }
  for (const file of ['scripts/build-manifest.js', 'scripts/governance.js', 'test/panel.test.js']) assert.equal(fs.existsSync(path.join(root, file)), false);
  const manifest = require('../plugin/manifest.json');
  assert.equal(manifest.main, 'runtime/main.js');
  assert.equal(typeof require(path.join(root, 'plugin', manifest.main)).onLoad, 'function');
  const html = fs.readFileSync(path.join(root, 'plugin', manifest.ui.panel), 'utf8');
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) assert.ok(fs.existsSync(path.resolve(root, 'plugin/renderer', src)), src);
});
test('compiled CLI runs from the repository without adjacent JS dependencies', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['build/scripts/governance.js'], { cwd: root, input: '{"action":"status"}', encoding: 'utf8' }));
  assert.equal(result.task, 'project-board-release');
});
test('reader documentation links resolve to real repository files', () => {
  for (const file of ['docs/README.md', 'docs/architecture.md', 'docs/development.md']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, link] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (!/^https?:/.test(link)) assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), link.split('#')[0])), `${file}: ${link}`);
    }
  }
});
