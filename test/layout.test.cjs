'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
test('compiled JavaScript is separated and runtime exactly matches compiler output', () => {
  const sources = ['main', 'core', 'git', 'panel', 'project', 'tool', 'operations'];
  const renderer = ['i18n', 'graph-model', 'graph', 'panel'];
  for (const file of [
    ...sources.map((f) => `${f}.js`),
    ...renderer.map((f) => `renderer/${f}.js`)
  ]) {
    assert.equal(
      fs.existsSync(path.join(root, 'plugin', file)),
      false,
      `No adjacent output: ${file}`
    );
    assert.deepEqual(
      fs.readFileSync(path.join(root, 'plugin/runtime', file)),
      fs.readFileSync(path.join(root, 'build/plugin', file))
    );
  }
  for (const file of ['scripts/build-manifest.js', 'scripts/governance.js', 'test/panel.test.js'])
    assert.equal(fs.existsSync(path.join(root, file)), false);
  const manifest = require('../plugin/manifest.json');
  assert.equal(manifest.main, 'runtime/main.js');
  assert.equal(typeof require(path.join(root, 'plugin', manifest.main)).onLoad, 'function');
  const html = fs.readFileSync(path.join(root, 'plugin', manifest.ui.panel), 'utf8');
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g))
    assert.ok(fs.existsSync(path.resolve(root, 'plugin/renderer', src)), src);
});
test('compiled CLI runs from the repository without adjacent JS dependencies', () => {
  const result = JSON.parse(
    execFileSync(process.execPath, ['build/scripts/governance.js'], {
      cwd: root,
      input: '{"action":"status"}',
      encoding: 'utf8'
    })
  );
  assert.equal(
    result.task,
    JSON.parse(fs.readFileSync(path.join(root, 'STATE.json'), 'utf8')).task
  );
});
test('reader documentation links resolve to real repository files', () => {
  const { docFiles } = require('../scripts/build-docs.cjs');
  for (const file of [
    'README.md',
    'AGENTS.md',
    'notes/README.md',
    ...docFiles.map((f) => `docs/${f}`),
    'plugin/README.md',
    ...docFiles.map((f) => `plugin/docs/${f}`)
  ]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, link] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(link)) continue;
      const [relative, anchor] = link.split('#');
      const target = path.resolve(root, path.dirname(file), relative || path.basename(file));
      assert.ok(fs.existsSync(target), `${file}: ${link}`);
      if (anchor) {
        const headings = [...fs.readFileSync(target, 'utf8').matchAll(/^#+ (.+)$/gm)].map(
          ([, title]) =>
            title
              .toLowerCase()
              .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
              .replace(/\s/g, '-')
        );
        assert.ok(headings.includes(decodeURIComponent(anchor)), `${file}: missing anchor ${link}`);
      }
    }
  }
});
test('package documentation is generated from canonical concise docs and includes the license', () => {
  const { docFiles, render, marker } = require('../scripts/build-docs.cjs');
  for (const file of docFiles) {
    const text = fs.readFileSync(path.join(root, 'docs', file), 'utf8');
    assert.ok(text.trimEnd().split('\n').length <= 100, `Split a growing topic: ${file}`);
    assert.equal(fs.readFileSync(path.join(root, 'plugin/docs', file), 'utf8'), render(text));
  }
  assert.equal(
    fs.readFileSync(path.join(root, 'plugin/README.md'), 'utf8'),
    render(fs.readFileSync(path.join(root, 'docs/README.md'), 'utf8'), true)
  );
  assert.match(
    fs.readFileSync(path.join(root, 'plugin/docs/ui-sources.md'), 'utf8'),
    /MIT License/
  );
  const publisher = require('../scripts/plugin-center.cjs');
  for (const file of docFiles) assert.ok(publisher.files.includes(`docs/${file}`));
  assert.ok(fs.readFileSync(path.join(root, 'plugin/README.md'), 'utf8').startsWith(marker));
  for (const old of ['GIT.md', 'PROJECT.md', 'PUBLISHING.md', 'UI-SOURCES.md'])
    assert.equal(fs.existsSync(path.join(root, 'plugin', old)), false);
  assert.equal(fs.existsSync(path.join(root, 'scripts/RELEASING.md')), false);
});
test('documentation generation preflights user files and linked outputs before writing', (t) => {
  const { generate, docFiles } = require('../scripts/build-docs.cjs');
  const temp = fs.mkdtempSync(
    path.join(process.env.PI_SCRATCH_DIR || require('node:os').tmpdir(), 'docs-generation-')
  );
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temp, 'plugin'));
  fs.cpSync(path.join(root, 'docs'), path.join(temp, 'docs'), { recursive: true });
  generate(temp);
  const readme = path.join(temp, 'plugin/README.md');
  const before = fs.readFileSync(readme);
  for (const file of [
    readme,
    ...docFiles.flatMap((f) => [path.join(temp, 'docs', f), path.join(temp, 'plugin/docs', f)])
  ])
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
  generate(temp);
  assert.deepEqual(
    fs.readFileSync(readme),
    before,
    'CRLF checkout must regenerate deterministically'
  );
  const userFile = path.join(temp, 'plugin/docs/user.md');
  fs.writeFileSync(userFile, 'User content');
  assert.throws(() => generate(temp), /Unknown/);
  assert.deepEqual(fs.readFileSync(readme), before);
  fs.unlinkSync(userFile);
  const output = path.join(temp, 'plugin/docs', docFiles[1]);
  fs.writeFileSync(output, 'Hand-written');
  assert.throws(() => generate(temp), /hand-written/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'Hand-written');
  assert.deepEqual(fs.readFileSync(readme), before);
  fs.rmSync(path.join(temp, 'plugin/docs'), { recursive: true });
  fs.symlinkSync(path.join(temp, 'docs'), path.join(temp, 'plugin/docs'), 'junction');
  assert.throws(() => generate(temp), /linked/);
  assert.deepEqual(fs.readFileSync(readme), before);
});
test('documentation generation rejects dangling output links without creating their targets', (t) => {
  const { generate } = require('../scripts/build-docs.cjs');
  const temp = fs.mkdtempSync(
    path.join(process.env.PI_SCRATCH_DIR || require('node:os').tmpdir(), 'docs-dangling-')
  );
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temp, 'plugin'));
  fs.cpSync(path.join(root, 'docs'), path.join(temp, 'docs'), { recursive: true });
  const target = path.join(temp, 'unrelated');
  fs.symlinkSync(target, path.join(temp, 'plugin/docs'), 'junction');
  assert.throws(() => generate(temp), /linked/);
  assert.equal(fs.existsSync(target), false);
  fs.unlinkSync(path.join(temp, 'plugin/docs'));
  try {
    fs.symlinkSync(path.join(temp, 'unrelated.md'), path.join(temp, 'plugin/README.md'), 'file');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.diagnostic('File symlink requires OS privilege; dangling junction checked');
      return;
    }
    throw error;
  }
  assert.throws(() => generate(temp), /linked/);
  assert.equal(fs.existsSync(path.join(temp, 'unrelated.md')), false);
});
