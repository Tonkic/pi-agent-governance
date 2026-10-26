'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { startConsole } = require('../build/web/server');
const { Governance } = require('../build/plugin/core');
(async () => {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'web-browser-'));
  const screenshots = path.join(process.env.PI_SCREENSHOT_DIR || process.env.PI_SCRATCH_DIR || os.tmpdir(), 'http-console');
  await fs.mkdir(screenshots, { recursive: true });
  const g = new Governance(root);
  await g.run({ action: 'init' });
  await g.run({ action: 'start', id: 'web-ui', goal: 'Local browser project control', criteria: ['Real HTTP browser interactions'] });
  const app = await startConsole({ workspace: root });
  const browser = await chromium.launch({ headless: true, ...(process.env.PI_BROWSER ? { executablePath: process.env.PI_BROWSER } : {}) });
  let page;
  try {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
    page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const ready = async () => { await page.waitForFunction(() => document.querySelector('#board-section').getAttribute('aria-busy') === 'false' && !document.querySelector('#refresh').disabled); };
    await page.goto(app.url); await ready();
    assert.ok(!page.url().includes(app.url.split('#')[1]), 'Token removed from address bar');
    await page.locator('#local-console-info').waitFor();
    for (const id of ['analysis-start', 'architecture-analyze', 'documentation-start', 'operations-open', 'design-start']) assert.equal(await page.locator('#' + id).isVisible(), false, id);
    assert.deepEqual(errors, []);
    await page.locator('a[href="#board-section"]').click();
    for (const id of ['project-open', 'board-new', 'item-menu', 'workitem-form', 'progress-form', 'design-begin', 'design-review', 'nav-behaviors', 'behaviors-section'])
      assert.equal(await page.locator('#' + id).count(), 0, id);
    assert.equal(await page.locator('.workspace-nav a').count(), 4);
    let p = await g.run({ action: 'project_snapshot' });
    await g.run({ action: 'board_create', id: 'external', title: 'MCP external update', description: '<img src=x onerror=alert(1)> 这是文本', expectedRevision: p.revision });
    await page.locator('#refresh').click(); await ready();
    await page.locator('[data-workitem="external"]').click();
    assert.match(await page.locator('#item-description').textContent(), /<img src=x/);
    assert.equal(await page.locator('#item-description img').count(), 0);
    assert.equal(await page.locator('#item-sheet input, #item-sheet textarea').count(), 0);
    await page.locator('#item-close').click();
    p = await g.run({ action: 'project_snapshot' });
    await g.run({ action: 'board_update', id: 'external', title: 'New external title', expectedRevision: p.revision });
    await g.run({ action: 'progress', current: 'Updated in the original AI client', next: ['Read in workbench'], blocked: [] });
    await page.locator('#refresh').click(); await ready();
    assert.equal(await page.locator('[data-workitem="external"] h4').textContent(), 'New external title');
    assert.equal(await page.locator('#summary-current').textContent(), 'Updated in the original AI client');
    let design = await g.run({ action: 'architecture_design_snapshot' });
    await g.run({ action: 'architecture_design_begin', expectedRevision: design.revision, reason: 'Explicit host design draft' });
    design = await g.run({ action: 'architecture_design_snapshot' });
    await g.run({ action: 'architecture_design_save', expectedRevision: design.revision, expectedDraft: design.draft.draftId, proposal: { title: 'Client-saved design', document: 'Intent only, not implementation or test evidence.', nodes: [{ id: 'console', title: 'Console', description: 'Readonly project view', files: [] }], edges: [] } });
    await page.locator('a[href="#architecture"]').click();
    await page.locator('#refresh').click(); await ready(); await page.locator('#show-design').click();
    assert.match(await page.locator('#design-document').textContent(), /Intent only/);
    assert.equal((await g.run({ action: 'architecture_design_snapshot' })).baseline, null);
    const before = await fs.readFile(path.join(root, 'STATE.json'), 'utf8');
    const denied = await page.evaluate(async () => {
      const results = [];
      for (const channel of ['governance.mutate', 'governance.workitem', 'governance.operation', 'models.list']) {
        try { await window.pluginBridge.invoke(channel, { confirmed: true, action: 'create', args: { action: 'init' } }); results.push(false); }
        catch { results.push(true); }
      }
      return results;
    });
    assert.deepEqual(denied, [true, true, true, true]);
    assert.equal(await fs.readFile(path.join(root, 'STATE.json'), 'utf8'), before);
    for (const width of [390, 768, 1280]) for (const mode of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: mode });
      await page.locator('a[href="#board-section"]').click();
      await page.waitForFunction(expected => document.documentElement.dataset.base === expected, mode);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(screenshots, `console-zh-${width}-${mode}.png`) });
    }
    await page.reload(); await ready(); assert.equal(await page.locator('[data-workitem]').count(), 1, 'Tab session survives reload');
    const english = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
    const en = await english.newPage(); await en.goto(app.url);
    await en.waitForFunction(() => document.querySelector('#board-section').getAttribute('aria-busy') === 'false');
    assert.match(await en.locator('#local-console-info').textContent(), /Local project console/);
    await en.screenshot({ path: path.join(screenshots, 'console-en-desktop.png') });
    await english.close();
    const disconnected = await browser.newContext({ locale: 'en-US' }); const lost = await disconnected.newPage(); await lost.goto(app.origin + '/panel/');
    await lost.waitForFunction(() => document.querySelector('#notice').classList.contains('error'));
    assert.match(await lost.locator('#notice').textContent(), /private URL/); await disconnected.close();
    assert.deepEqual(errors, []);
    await require('./reference-ui-browser.cjs')({ browser, screenshots });
    await require('./documents-browser.cjs')({ browser, screenshots });
    await require('./reader-typography-browser.cjs')({ browser, screenshots });
    await require('./unified-shell-browser.cjs')({ browser, screenshots });
    await require('./behaviors-page-browser.cjs')({ browser, screenshots });
    await require('./git-history-browser.cjs')({ browser, screenshots });
    await require('./context-help-browser.cjs')({ browser, screenshots });
    console.log(`PASS real local HTTP console: readonly UI/bridge, external updates, draft reading, token/session reload, disconnected state, bilingual responsive/themes; 7 screenshots: ${screenshots}`);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(screenshots, 'failure.png') }).catch(() => {});
    throw error;
  } finally { await browser.close(); await app.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
