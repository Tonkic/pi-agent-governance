'use strict';
module.exports = async ({ browser, screenshots }) => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const { Governance } = require('../build/plugin/core'), { startConsole } = require('../build/web/server');
  const root = await fs.realpath(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'reader-links-')));
  const g = new Governance(root); let app; const contexts = [], errors = [], requests = [];
  const ready = p => p.waitForFunction(() => !document.querySelector('#refresh').disabled);
  const loaded = (p, file) => p.waitForFunction(file => document.querySelector('#documents-path').textContent === file && document.querySelector('#documents-body').getAttribute('aria-busy') === 'false', file);
  const output = path.join(screenshots, 'document-links'); await fs.mkdir(output, { recursive: true });
  try {
    await g.run({ action: 'init' });
    const bad = ['https://remote.invalid/doc.md', '//remote.invalid/doc.md', 'javascript:window.linkXss=1', 'data:text/html,evil', 'file:///C:/secret.md', '/docs/development.md', '../../docs/development.md', 'docs/%252e%252e/secret.md', 'docs/%2e%2e/%2e%2e/secret.md', 'docs/secret.md?query=1', 'docs/%ZZ.md', 'docs/%00.md', 'docs/%5csecret.md', 'docs/missing.md', 'plugin/main.ts', '.secrets/private.md'];
    await g.write('README.md', '# Project\n\n[开发](docs/development.md#检查命令)\n[Encoded](docs/%E4%B8%AD%E6%96%87.md#%E6%A0%87%E9%A2%98)\n[Local](#project)\n' + bad.map((href, i) => `[bad-${i}](${href})`).join('\n') + '\n![image](docs/development.md)\n`[code](docs/development.md)`\n');
    await g.write('docs/development.md', '# Development\n\n[Home](../README.md)\n[Sibling](./中文.md#标题)\n[Jump](#检查命令)\n[Duplicate](#检查命令-1)\n[Missing heading](#not-found)\n\n## 检查命令\n\nRun checks.\n\n## 检查命令\n\nSecond heading.\n');
    await g.write('docs/中文.md', '# 中文\n\n## 标题\n\nChinese target.\n\n[Home](../README.md)\n');
    const before = await fs.readFile(path.join(root, 'STATE.json')); app = await startConsole({ workspace: root });
    for (const locale of ['zh-CN', 'en-US']) {
      const context = await browser.newContext({ locale, viewport: { width: 1280, height: 1000 } }); contexts.push(context);
      const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('request', r => requests.push({ url: r.url(), data: r.url().endsWith('/api/invoke') ? r.postDataJSON() : null }));
      await p.goto(app.url); await ready(p); await p.locator('a[href="#documents-section"]').click();
      await p.locator('[data-document="README.md"]').click(); await loaded(p, 'README.md');
      assert.equal(await p.locator('#documents-body a.reader-link').count(), 3, 'Allowed Markdown links become internal navigation only');
      assert.equal(await p.locator('#documents-body img, #documents-body script, #documents-body a:not(.reader-link)').count(), 0);
      for (let i = 0; i < bad.length; i++) assert.match(await p.locator('#documents-body').textContent(), new RegExp(`bad-${i}\\]\\(`), 'Rejected link remains literal');
      const initialReads = requests.filter(r => r.data?.channel === 'governance.documents' && r.data.payload.action === 'read').length;
      await p.getByRole('link', { name: 'Local', exact: true }).click(); assert.equal(await p.evaluate(() => document.activeElement.tagName), 'H1');
      assert.equal(requests.filter(r => r.data?.channel === 'governance.documents' && r.data.payload.action === 'read').length, initialReads, 'Same-page anchor does not reread');
      await p.getByRole('link', { name: '开发', exact: true }).focus(); await p.keyboard.press('Enter'); await loaded(p, 'docs/development.md');
      assert.equal(await p.evaluate(() => document.activeElement.textContent), '检查命令'); assert.equal(await p.evaluate(() => location.hash), '#documents-section');
      await p.getByRole('link', { name: 'Duplicate', exact: true }).click(); assert.equal(await p.evaluate(() => document.activeElement.nextElementSibling.textContent), 'Second heading.');
      await p.getByRole('link', { name: 'Missing heading', exact: true }).click(); assert.match(await p.locator('#documents-status').textContent(), /not found|未找到/);
      await p.getByRole('link', { name: 'Sibling', exact: true }).click(); await loaded(p, 'docs/中文.md'); assert.equal(await p.evaluate(() => document.activeElement.textContent), '标题');
      await p.getByRole('link', { name: 'Home', exact: true }).click(); await loaded(p, 'README.md');
      await p.getByRole('link', { name: 'Encoded', exact: true }).click(); await loaded(p, 'docs/中文.md'); assert.equal(await p.evaluate(() => document.activeElement.textContent), '标题');
      await p.getByRole('link', { name: 'Home', exact: true }).click(); await loaded(p, 'README.md');
      await context.setOffline(true); await p.waitForFunction(() => document.querySelector('#documents-refresh').disabled);
      const offlineReads = requests.length; await p.getByRole('link', { name: '开发', exact: true }).click(); assert.equal(await p.locator('#documents-path').textContent(), 'README.md'); assert.equal(requests.length, offlineReads);
      await p.getByRole('link', { name: 'Local', exact: true }).click(); assert.equal(await p.evaluate(() => document.activeElement.tagName), 'H1');
      await context.setOffline(false); await p.waitForFunction(() => !document.querySelector('#documents-refresh').disabled);
      // Newer selection owns the reader; a held linked response cannot replace it.
      let release, enter, finish; const held = new Promise(r => { enter = r; }), done = new Promise(r => { finish = r; });
      await p.route('**/api/invoke', async route => {
        const request = route.request().postDataJSON();
        if (request.channel === 'governance.documents' && request.payload.path === 'docs/development.md') { const response = await route.fetch(); enter(); await new Promise(r => { release = r; }); try { await route.fulfill({ response }); } finally { finish(); } }
        else await route.continue();
      });
      await p.getByRole('link', { name: '开发', exact: true }).click(); await held;
      try { await p.locator('[data-document="docs/中文.md"]').click(); await loaded(p, 'docs/中文.md'); } finally { release(); await done; }
      await p.unroute('**/api/invoke'); await loaded(p, 'docs/中文.md'); assert.match(await p.locator('#documents-body').textContent(), /Chinese target/);
      for (const [width, theme] of [[390, 'light'], [1280, 'dark']]) { await p.setViewportSize({ width, height: 1000 }); await p.emulateMedia({ colorScheme: theme }); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await p.screenshot({ path: path.join(output, `${locale}-${width}-${theme}.png`) }); }
    }
    assert.deepEqual(errors, []); assert.equal(requests.some(r => !r.url.startsWith(app.origin)), false); assert.equal(requests.some(r => r.data?.channel === 'governance.documents' && r.data.payload.action === 'read' && !['README.md', 'docs/development.md', 'docs/中文.md'].includes(r.data.payload.path)), false);
    assert.deepEqual(await fs.readFile(path.join(root, 'STATE.json')), before);
    console.log('PASS internal document links: relative/encoded Markdown, heading/duplicate slugs, keyboard, rejected URLs/paths stay literal, offline/no resources/late response ownership; 4 screenshots');
  } finally { for (const context of contexts) await context.close(); await app?.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); }
};
