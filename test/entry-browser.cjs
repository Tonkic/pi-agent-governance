'use strict';
// Real entry DOM + compiled PI adapter + owned HTTP server. Host launcher/native view placement is simulated.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { fixture } = require('./pi-fixture.cjs');
(async () => {
  const cleanups = [], f = await fixture({ after: fn => cleanups.push(fn) });
  const output = path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'entry-screenshots');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PI_BROWSER ? { executablePath: process.env.PI_BROWSER } : {}) });
  const errors = [], calls = []; let holdStatus = false, releaseStatus, statusEntered;
  const ready = page => page.waitForFunction(() => document.querySelector('#open')?.disabled === false);
  const event = (page, name, value = {}) => page.evaluate(({ name, value }) => window.dispatchEvent(new CustomEvent('entry-test-event', { detail: { name, value } })), { name, value });
  try {
    let shots = 0, reference;
    for (const locale of ['zh-CN', 'en-US']) for (const theme of ['light', 'dark']) for (const placement of ['panel', 'view']) {
      const context = await browser.newContext({ locale, colorScheme: theme, viewport: { width: placement === 'panel' ? 480 : 320, height: 540 }, reducedMotion: 'reduce' });
      await context.exposeBinding('entryInvoke', async (_source, channel, payload) => {
        if (channel === 'app.getAppearance') return { base: theme };
        calls.push({ channel, payload }); const result = await f.adapter.onPanelInvoke(channel, payload);
        if (holdStatus && payload.action === 'status') { statusEntered?.(); await new Promise(resolve => { releaseStatus = resolve; }); }
        return result;
      });
      await context.addInitScript(({ placement }) => {
        const handlers = new Map();
        window.pluginBridge = { invoke: (channel, payload) => window.entryInvoke(channel, payload), on: (name, fn) => handlers.set(name, fn) };
        window.addEventListener('entry-test-event', e => handlers.get(e.detail.name)?.(e.detail.value));
        document.documentElement?.style.setProperty('--pi-plugin-titlebar-height', placement === 'panel' ? '46px' : '0px');
        document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('--pi-plugin-titlebar-height', placement === 'panel' ? '46px' : '0px'));
      }, { placement });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve('plugin/entry/index.html')).href); await ready(page);
      assert.equal(f.opened.length, 0, 'Every initial load remains status-only');
      assert.equal(await page.locator('button').count(), 2);
      assert.equal(await page.locator('#project').textContent(), f.b);
      assert.equal(await page.locator('input,iframe,[data-workitem]').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
      await page.locator('#open').focus(); await page.keyboard.press('Tab');
      assert.equal(await page.locator('#refresh').evaluate(el => el === document.activeElement), true);
      await page.screenshot({ path: path.join(output, `${locale}-${theme}-${placement}.png`), fullPage: false }); shots++;
      if (locale === 'zh-CN' && theme === 'light' && placement === 'view') reference = page;
      else await context.close();
    }
    const page = reference;
    await event(page, 'view:open');
    assert.equal(await page.locator('#open').isDisabled(), true); assert.equal(f.opened.length, 0);
    await page.locator('#refresh').click(); await ready(page);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    assert.equal(await page.locator('#open').isDisabled(), true); assert.equal(f.opened.length, 0);
    await page.locator('#refresh').click(); await ready(page);
    const before = calls.filter(c => c.payload.action === 'open').length;
    await page.evaluate(() => { document.getElementById('open').click(); document.getElementById('open').click(); });
    await ready(page);
    assert.equal(calls.filter(c => c.payload.action === 'open').length, before + 1, 'Busy blocks duplicate clicks');
    assert.equal(f.opened.length, 1); const origin = new URL(f.opened[0]).origin;
    assert.equal((await fetch(origin + '/panel/')).status, 200);
    assert.doesNotMatch(await page.locator('body').textContent(), /#[a-f0-9]{64}|127\.0\.0\.1/);
    await page.locator('#open').focus(); await page.keyboard.press('Enter'); await ready(page);
    assert.equal(f.opened.length, 2); assert.equal(f.opened[0], f.opened[1]);
    f.pi.workspace.get = async () => ({ path: f.a }); await f.events.get('workspace:changed')();
    await page.locator('#open').click();
    await page.waitForFunction(() => !document.querySelector('#refresh').disabled && document.querySelector('#open').disabled);
    assert.equal(f.opened.length, 2, 'Stale visible entry cannot open another project');
    const entered = new Promise(resolve => { statusEntered = resolve; }); holdStatus = true;
    await page.locator('#refresh').click(); await entered;
    await event(page, 'workspace:changed'); holdStatus = false; releaseStatus();
    await page.waitForTimeout(40);
    assert.equal(await page.locator('#open').isDisabled(), true); assert.equal(await page.locator('#project').textContent(), '—');
    await page.locator('#refresh').click(); await ready(page);
    f.pi.shell.openExternal = async url => { throw Error('private failure:' + url); };
    await page.locator('#open').click();
    await page.waitForFunction(() => !document.querySelector('#refresh').disabled && document.querySelector('#open').disabled);
    assert.doesNotMatch(await page.locator('body').textContent(), /private failure|#[a-f0-9]{64}/);
    f.pi.workspace.get = async () => null;
    await page.locator('#refresh').click();
    await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
    assert.equal(await page.locator('#open').isDisabled(), true);
    const missing = await browser.newPage(); missing.on('pageerror', e => errors.push(e.message));
    await missing.goto(pathToFileURL(path.resolve('plugin/entry/index.html')).href);
    await missing.waitForFunction(() => !document.querySelector('#refresh').disabled);
    assert.equal(await missing.locator('#open').isDisabled(), true);
    assert.deepEqual(errors, []);
    assert.ok(calls.every(c => c.channel === 'governance.entry' && ['status', 'open'].includes(c.payload.action)));
    console.log(`PASS lightweight entry: shared panel/view HTML, ${shots} bilingual/theme/placement screenshots, no auto-open, keyboard, explicit version-bound opens, duplicate/restore/stale/late/error guards; real HTTP with stub system opener.`);
  } finally { await browser.close(); for (const fn of cleanups.reverse()) await fn(); }
})().catch(error => { console.error('Entry browser regression failed: ' + error.name + '. Private request data omitted.'); process.exitCode = 1; });
