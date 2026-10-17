'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { BrowserWorkbench } = require('../build/plugin/workbench');
const { Governance } = require('../build/plugin/core');
(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'managed-browser-')));
  const screenshots = path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'managed-console-screenshots');
  await fs.mkdir(screenshots, { recursive: true });
  const g = new Governance(root); await g.run({ action: 'init' });
  const browser = await chromium.launch({ headless: true, ...(process.env.PI_BROWSER ? { executablePath: process.env.PI_BROWSER } : {}) });
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
  const leases = [], errors = [];
  context.on('request', request => { if (request.url().endsWith('/api/invoke') && request.method() === 'POST') { const data = request.postDataJSON(); if (data.channel === 'governance.lease') leases.push(data.payload); } });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const pages = [];
  const manager = new BrowserWorkbench({ assetRoot: path.resolve('plugin'), webAssetsRoot: path.resolve('web'),
    lease: { startupGraceMs: 30000, heartbeatMs: 250, ttlMs: 10000, emptyGraceMs: 750 },
    openExternal: async privateUrl => { const page = await context.newPage(); pages.push(page); await page.goto(privateUrl); await page.waitForFunction(() => document.querySelector('#board-section')?.getAttribute('aria-busy') === 'false' && document.querySelector('#refresh')?.disabled === false); assert.equal(new URL(page.url()).hash, ''); }
  });
  try {
    const first = await manager.open(root);
    assert.doesNotMatch(JSON.stringify(first), /#[a-f0-9]{64}|"url"/);
    assert.match(await pages[0].locator('#local-console-info').textContent(), /所有宿主共用此浏览器工作台/);
    for (const id of ['analysis-start', 'architecture-analyze', 'documentation-start', 'operations-open', 'design-start']) assert.equal(await pages[0].locator('#' + id).isVisible(), false);
    await pages[0].screenshot({ path: path.join(screenshots, 'managed-first.png') });
    const second = await manager.open(root); assert.equal(second.origin, first.origin);
    assert.equal(pages.length, 2);
    await pages[0].reload();
    await pages[0].waitForFunction(() => document.querySelector('#refresh')?.disabled === false);
    assert.equal(new URL(pages[0].url()).hash, '');
    await pages[0].screenshot({ path: path.join(screenshots, 'managed-refreshed.png') });
    assert.ok(new Set(leases.filter(p => p.event === 'join').map(p => p.id)).size >= 3, 'Two tabs and refresh use independent activation leases');
    await pages[0].close({ runBeforeUnload: false });
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal((await fetch(first.origin + '/panel/')).status, 200, 'Remaining tab retains its own service lease');
    assert.equal(manager.status().open, true);
    await pages[1].close({ runBeforeUnload: false });
    const deadline = Date.now() + 5000;
    while (manager.status().open && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(manager.status().open, false, 'Last actual pagehide causes service reclamation');
    await assert.rejects(fetch(first.origin + '/panel/'));
    assert.deepEqual(errors, []);
    console.log('PASS managed real browser: same workbench, no host controls, token removal, repeat tabs, reload, remaining-page lease and last-page service reclamation; 2 screenshots: ' + screenshots);
  } finally { await manager.dispose(); await browser.close(); await fs.rm(root, { recursive: true, force: true }); }
})().catch(() => { console.error('Managed browser regression failed; inspect assertions locally. Private URLs omitted.'); process.exitCode = 1; });
