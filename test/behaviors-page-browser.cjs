'use strict';
// Regression for removal of the duplicate behavior page; ordinary Docs remain readable.
module.exports = async ({ browser, screenshots }) => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const { Governance } = require('../build/plugin/core'), { startConsole } = require('../build/web/server');
  const root = require('node:fs').realpathSync.native(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'readonly-docs-')));
  const output = path.join(screenshots, 'docs-route'); await fs.mkdir(output, { recursive: true });
  const g = new Governance(root), contexts = [], errors = [], external = []; let app, shots = 0;
  const ready = p => p.waitForFunction(() => !document.querySelector('#refresh').disabled);
  const loaded = p => p.waitForFunction(() => document.documentElement.dataset.view === 'documents-section' && document.querySelector('[data-document="docs/behavior-demo.md"]') && !document.querySelector('#documents-refresh').disabled);
  try {
    await g.run({ action: 'init' });
    await g.write('docs/behavior-demo.md', '# Current functionality\n\nReadable specification / 可读功能说明。\n<img src="https://remote.invalid/pixel" onerror="window.behaviorXss=1">\n[external](https://remote.invalid/)\n');
    await g.write('notes/history.md', '# Optional history\n\nHistorical note only.');
    const before = await fs.readFile(path.join(root, 'STATE.json')); app = await startConsole({ workspace: root });
    for (const language of ['zh-CN', 'en-US']) {
      const context = await browser.newContext({ locale: language, viewport: { width: 1280, height: 1000 } }); contexts.push(context);
      const p = await context.newPage(); let reads = 0;
      p.on('pageerror', e => errors.push(e.message)); p.on('request', r => { if (!r.url().startsWith(app.origin)) external.push(r.url()); if (r.url().endsWith('/api/invoke') && r.postDataJSON()?.channel === 'governance.behaviors') reads++; });
      await p.goto(app.url); await ready(p);
      assert.equal(await p.locator('#nav-behaviors, #behaviors-section, #behavior-refresh, #behavior-docs-dialog').count(), 0);
      await p.evaluate(() => { location.hash = '#behaviors-section'; }); await loaded(p);
      assert.equal(new URL(p.url()).hash, '#documents-section');
      const library = p.locator('.reader-library'); if (!await library.evaluate(n => n.open)) await library.locator('summary').click();
      await p.locator('[data-document="docs/behavior-demo.md"]').click(); await p.waitForFunction(() => document.querySelector('#documents-body h1')?.textContent === 'Current functionality');
      assert.match(await p.locator('#documents-body').textContent(), /<img src=/); assert.equal(await p.locator('#documents-body img, #documents-body script, #documents-body a').count(), 0); assert.equal(await p.evaluate(() => window.behaviorXss), undefined);
      assert.equal(reads, 0, 'No duplicate behavior API reads');
      for (const width of [320, 390, 768, 1672]) for (const theme of ['light', 'dark']) {
        await p.setViewportSize({ width, height: 1000 }); await p.emulateMedia({ colorScheme: theme });
        assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await p.screenshot({ path: path.join(output, `${language}-${width}-${theme}.png`) }); shots++;
      }
      await p.locator('a[href="#board-section"]').click(); await p.goBack(); await loaded(p); await p.goForward(); await ready(p);
      await p.evaluate(() => { location.hash = '#behaviors-section'; }); await loaded(p); await p.reload(); await ready(p); await loaded(p);
      assert.equal(reads, 0);
      await p.evaluate(() => { history.replaceState(null, '', '#behaviors-section'); }); await p.reload(); await ready(p); await loaded(p);
      assert.equal(new URL(p.url()).hash, '#documents-section', 'Initial legacy route redirects too');
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(await fs.readFile(path.join(root, 'STATE.json')), before);
    console.log(`PASS removed behavior page: no duplicate navigation/API, initial/runtime legacy route, ordinary Docs/history retained, safe bilingual responsive reading; ${shots} screenshots`);
  } finally { for (const context of contexts) await context.close(); await app?.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); }
};
