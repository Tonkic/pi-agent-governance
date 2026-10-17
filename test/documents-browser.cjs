'use strict';
module.exports = async ({ browser, screenshots }) => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const { Governance } = require('../build/plugin/core'), { startConsole } = require('../build/web/server');
  const root = await fs.realpath(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'reader-browser-')));
  const output = path.join(screenshots, 'documents'); await fs.mkdir(output, { recursive: true });
  const g = new Governance(root); let app, page, shots = 0; const contexts = [], errors = [], requests = [];
  const ready = p => p.waitForFunction(() => document.querySelector('#board-section').getAttribute('aria-busy') === 'false' && !document.querySelector('#refresh').disabled);
  const listed = p => p.waitForFunction(() => !document.querySelector('#documents-section').hidden && document.querySelector('#documents-section').getAttribute('aria-busy') === 'false' && !document.querySelector('#documents-refresh').disabled);
  const read = async (p, file) => { await p.locator('[data-document]').filter({ hasText: file }).click(); await p.waitForFunction(() => document.querySelector('#documents-body').getAttribute('aria-busy') === 'false'); };
  try {
    await g.run({ action: 'init' }); await fs.mkdir(path.join(root, 'docs'), { recursive: true }); await fs.mkdir(path.join(root, 'notes'), { recursive: true });
    await fs.writeFile(path.join(root, 'docs', 'guide.md'), '# Project guide / 项目指南\n\nWelcome to the **read-only** project library.\n\n## Getting started / 开始使用\n\n- Read project instructions\n- Refresh after external changes\n\n> Source is never executed.\n\n## Example / 示例\n\n```html\n<img src="https://remote.invalid/code.png" onerror="window.readerXss=1">\n```\n\n<img src="https://remote.invalid/pixel.png" onerror="window.readerXss=1">\n<script>window.readerXss=2</script>\n![remote](https://remote.invalid/image.png)\n[unsafe](javascript:window.readerXss=3)\n[local](../README.md)\n\n' + 'Reading text with readable line spacing. 中文内容与代码段。\n\n'.repeat(12) + '## Last section / 最后章节\n\nEnd of the source document.\n');
    await fs.writeFile(path.join(root, 'docs', 'second.md'), '# Second document\n\nDifferent content.\n');
    await fs.writeFile(path.join(root, 'notes', '中文记录.md'), '记录标题\n===\n\n只读知识记录。\n');
    const before = await fs.readFile(path.join(root, 'STATE.json'));
    app = await startConsole({ workspace: root });
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1672, height: 1100 }, reducedMotion: 'reduce' }); contexts.push(context);
    page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push({ url: r.url(), data: r.url().endsWith('/api/invoke') ? r.postDataJSON() : null }));
    await page.goto(app.url); await ready(page);
    assert.equal(requests.filter(r => r.data?.channel === 'governance.documents').length, 0, 'No document scan until navigation');
    await page.locator('.workspace-nav a[href="#documents-section"]').focus(); await page.keyboard.press('Enter'); await listed(page);
    assert.equal(await page.locator('#page-title').textContent(), '项目文档');
    assert.equal(await page.locator('#board-section').isVisible(), false);
    assert.equal(requests.filter(r => r.data?.channel === 'governance.documents' && r.data.payload.action === 'read').length, 0, 'No prefetch of document bodies');
    const scanCount = requests.length;
    await page.locator('#documents-search').fill('GUIDE'); assert.equal(await page.locator('[data-document]').count(), 1); assert.equal(requests.length, scanCount);
    await read(page, 'docs/guide.md');
    assert.equal(await page.locator('#documents-body h1').textContent(), 'Project guide / 项目指南'); assert.equal(await page.locator('#documents-body ul li').count(), 2);
    assert.equal(await page.locator('#documents-body strong').textContent(), 'read-only');
    assert.equal(await page.locator('#documents-body img, #documents-body script, #documents-body iframe, #documents-body a, #documents-body style').count(), 0);
    assert.match(await page.locator('#documents-body pre').textContent(), /<img src=/);
    assert.equal(await page.evaluate(() => window.readerXss), undefined);
    assert.equal(requests.some(r => /remote\.invalid|javascript:/.test(r.url)), false, 'No document-owned requests');
    assert.equal(await page.locator('#documents-toc button').count(), 4);
    await page.locator('#documents-toc button').last().focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Last section / 最后章节');
    await page.locator('#documents-search').fill('does-not-exist'); assert.equal(await page.locator('[data-document]').count(), 0); assert.match(await page.locator('#documents-files').textContent(), /没有匹配/);
    assert.match(await page.locator('#documents-body').textContent(), /Project guide/);
    await page.locator('#documents-search').fill('');
    for (const language of ['zh-CN', 'en-US']) {
      let p = page;
      if (language === 'en-US') { const en = await browser.newContext({ locale: language, viewport: { width: 1672, height: 1100 } }); contexts.push(en); p = await en.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto(app.url); await ready(p); await p.locator('a[href="#documents-section"]').click(); await listed(p); await read(p, 'docs/guide.md'); assert.equal(await p.locator('#page-title').textContent(), 'Project documents'); }
      for (const width of [390, 768, 1672]) for (const theme of ['light', 'dark']) {
        await p.setViewportSize({ width, height: 1100 }); await p.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await p.waitForFunction(value => document.documentElement.dataset.base === value, theme);
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${language}/${width}/${theme}: no whole-page overflow`);
        await p.locator('#documents-search').focus(); assert.ok(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'));
        await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: path.join(output, `${language}-${width}-${theme}.png`), fullPage: true }); shots++;
      }
    }
    await context.setOffline(true); await page.waitForFunction(() => document.querySelector('#documents-refresh').disabled);
    assert.match(await page.locator('#documents-status').textContent(), /离线/); assert.match(await page.locator('#documents-body').textContent(), /Project guide/);
    await page.locator('#documents-search').fill('中文'); assert.equal(await page.locator('[data-document]').count(), 1);
    await context.setOffline(false); await ready(page); await page.locator('#documents-search').fill(''); await listed(page);
    await read(page, '中文记录.md'); assert.equal(await page.locator('#documents-body h1').textContent(), '记录标题');
    // Hold one real response, select another file, then release the older response.
    let release, entered; const held = new Promise(resolve => { entered = resolve; });
    await page.route('**/api/invoke', async route => {
      const data = route.request().postDataJSON();
      if (data.channel === 'governance.documents' && data.payload.action === 'read' && data.payload.path === 'docs/guide.md') { const response = await route.fetch(); entered(); await new Promise(resolve => { release = resolve; }); await route.fulfill({ response }); }
      else await route.continue();
    });
    await page.locator('[data-document="docs/guide.md"]').click(); await held;
    await read(page, 'docs/second.md'); release();
    await page.waitForResponse(response => response.url().endsWith('/api/invoke') && response.request().postDataJSON()?.payload?.path === 'docs/guide.md');
    assert.equal(await page.locator('#documents-path').textContent(), 'docs/second.md'); assert.match(await page.locator('#documents-body').textContent(), /Second document/);
    await page.unroute('**/api/invoke');
    // Deleted file and failed list produce explicit errors, not retained wrong-body data or retry loops.
    await fs.unlink(path.join(root, 'docs', 'second.md')); await read(page, 'docs/second.md'); assert.match(await page.locator('#documents-status').textContent(), /读取失败/); assert.equal(await page.locator('#documents-body').textContent(), '');
    let listFailures = 0;
    await page.route('**/api/invoke', route => { if (route.request().postDataJSON()?.channel === 'governance.documents') { listFailures++; return route.fulfill({ json: { ok: false, error: 'fixture error' } }); } return route.continue(); });
    await page.locator('#documents-refresh').click(); await listed(page); assert.match(await page.locator('#documents-count').textContent(), /读取失败/);
    await page.evaluate(() => { window.dispatchEvent(new Event('documents-controls')); window.dispatchEvent(new Event('documents-context')); }); assert.equal(listFailures, 1, 'No automatic retries after a failed list');
    await page.unroute('**/api/invoke'); await page.locator('#documents-refresh').click(); await listed(page);
    // Validate truncation and bounded plain-text rendering through real UI with explicit fixtures.
    await fs.writeFile(path.join(root, 'docs', 'many-lines.md'), 'literal\n'.repeat(4001)); await page.locator('#documents-refresh').click(); await listed(page); await read(page, 'many-lines.md');
    assert.match(await page.locator('#documents-body').textContent(), /纯文本/); assert.equal(await page.locator('#documents-body pre').count(), 1);
    await page.route('**/api/invoke', async route => { const data = route.request().postDataJSON(); if (data.channel === 'governance.documents' && data.payload.action === 'list') { const response = await route.fetch(), json = await response.json(); json.result.truncated = true; return route.fulfill({ json }); } return route.continue(); });
    await page.locator('#documents-refresh').click(); await listed(page); assert.match(await page.locator('#documents-count').textContent(), /最多 500/); await page.unroute('**/api/invoke');
    // A same-project global refresh temporarily clears snapshot; pending ownership must still settle.
    for (const action of ['list', 'read']) {
      if (action === 'read') { await page.locator('#documents-refresh').click(); await listed(page); }
      let releaseDocument, releaseSnapshot, enteredDocument, enteredSnapshot;
      const documentHeld = new Promise(resolve => { enteredDocument = resolve; }), snapshotHeld = new Promise(resolve => { enteredSnapshot = resolve; });
      await page.route('**/api/invoke', async route => {
        const input = route.request().postDataJSON();
        if (input.channel === 'governance.documents' && input.payload.action === action) { const response = await route.fetch(); enteredDocument(); await new Promise(resolve => { releaseDocument = resolve; }); return route.fulfill({ response }); }
        if (input.channel === 'governance.snapshot') { const response = await route.fetch(); enteredSnapshot(); await new Promise(resolve => { releaseSnapshot = resolve; }); return route.fulfill({ response }); }
        return route.continue();
      });
      if (action === 'list') await page.locator('#documents-refresh').click(); else await page.locator('[data-document="docs/guide.md"]').click();
      await documentHeld; await page.locator('#refresh').click(); await snapshotHeld;
      const responseDone = page.waitForResponse(response => response.url().endsWith('/api/invoke') && response.request().postDataJSON()?.channel === 'governance.documents');
      releaseDocument(); await responseDone;
      try { await page.waitForFunction(action => document.querySelector(action === 'list' ? '#documents-section' : '#documents-body').getAttribute('aria-busy') === 'false', action, { timeout: 3000 }); }
      finally { releaseSnapshot(); }
      await ready(page); assert.equal(await page.locator('#documents-refresh').isDisabled(), false); await page.unroute('**/api/invoke');
    }
    const longPath = 'docs/' + ('a'.repeat(210) + '/').repeat(5) + 'page.md';
    await page.route('**/api/invoke', async route => { const input = route.request().postDataJSON(); if (input.channel === 'governance.documents' && input.payload.action === 'list') { const response = await route.fetch(), json = await response.json(); json.result.files.push({ path: longPath, bytes: 1 }); return route.fulfill({ json }); } return route.continue(); });
    await page.locator('#documents-refresh').click(); await listed(page); assert.equal(await page.locator('[data-document]').evaluateAll((nodes, expected) => nodes.some(node => node.dataset.document === expected), longPath), true); assert.ok(await page.locator('[data-document="README.md"]').count()); await page.unroute('**/api/invoke');
    await page.locator('#documents-refresh').click(); await listed(page);
    // Compile-time lifecycle integration: simulate the same project-epoch switch event, not a new filesystem route.
    let releaseOld, oldEntered; const oldHeld = new Promise(resolve => { oldEntered = resolve; });
    await page.route('**/api/invoke', async route => { if (route.request().postDataJSON()?.channel === 'governance.documents') { const response = await route.fetch(); oldEntered(); await new Promise(resolve => { releaseOld = resolve; }); return route.fulfill({ response }); } return route.continue(); });
    await page.locator('[data-document="docs/guide.md"]').click(); await oldHeld;
    await page.evaluate(() => { workspaceEpoch++; snapshot = null; window.dispatchEvent(new Event('documents-reset')); });
    const oldDone = page.waitForResponse(response => response.url().endsWith('/api/invoke') && response.request().postDataJSON()?.channel === 'governance.documents'); releaseOld(); await oldDone; await page.unroute('**/api/invoke');
    assert.equal(await page.locator('#documents-body').textContent(), ''); assert.equal(await page.locator('[data-document]').count(), 0); assert.equal(await page.locator('#documents-refresh').isDisabled(), true);
    assert.deepEqual(await fs.readFile(path.join(root, 'STATE.json')), before, 'Reading never rewrites project state'); assert.deepEqual(errors, []);
    console.log(`PASS document reader: real HTTP/search/body/TOC, literal HTML and resource rejection, keyboard/offline/errors/late selection/project reset/limits, ${shots} bilingual responsive/theme screenshots`);
  } finally { for (const context of contexts) await context.close(); await app?.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); }
};
