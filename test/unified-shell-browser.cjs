'use strict';
// One real HTTP workbench; fixture documents are explicitly labelled demo material.
module.exports = async ({ browser, screenshots }) => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const { Governance } = require('../build/plugin/core'), { startConsole } = require('../build/web/server');
  const root = await fs.realpath(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'shell081-fixture-')));
  const output = path.join(screenshots, 'unified-shell'); await fs.mkdir(output, { recursive: true });
  const pages = ['board-section', 'architecture', 'git-section', 'documents-section'];
  const article = '# A shared workspace / 统一工作台\n\nDemo document · 示例材料\n\n' + 'The shell stays familiar while the document has room to breathe. 阅读不需要切换到另一套界面，手动收起侧栏就能腾出空间。'.repeat(8) + '\n\n## Safe text\n\n![image](https://remote.invalid/image.png)\n[link](javascript:window.shellXss=1)\n<img src="https://remote.invalid/pixel" onerror="window.shellXss=2">\n\n```txt\n' + 'long-code-'.repeat(100) + '\n```\n';
  const contexts = [], errors = [], external = []; let app, shots = 0;
  const ready = p => p.waitForFunction(() => document.querySelector('#board-section').getAttribute('aria-busy') === 'false' && !document.querySelector('#refresh').disabled);
  const listed = p => p.waitForFunction(() => document.querySelector('#documents-section').getAttribute('aria-busy') === 'false' && !document.querySelector('#documents-refresh').disabled);
  const toggle = async (p, expanded) => { if (await p.locator('#sidebar-toggle').getAttribute('aria-expanded') !== String(expanded)) await p.locator('#sidebar-toggle').click(); assert.equal(await p.locator('#sidebar-toggle').getAttribute('aria-expanded'), String(expanded)); };
  const geometry = p => p.evaluate(() => {
    const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 100) / 100); };
    return { nav: box('.workspace-nav'), header: box('.topbar'), title: box('#page-title'), padding: getComputedStyle(document.querySelector('.app-shell')).paddingLeft, main: document.querySelector('.topbar').clientWidth };
  });
  const shot = async (p, name) => { await p.screenshot({ path: path.join(output, `shell081-ui-${name}.png`) }); shots++; };
  try {
    await new Governance(root).run({ action: 'init' }); await fs.mkdir(path.join(root, 'docs')); await fs.writeFile(path.join(root, 'docs', 'shell-demo.md'), article);
    const before = await fs.readFile(path.join(root, 'STATE.json')); app = await startConsole({ workspace: root });
    for (const language of ['zh-CN', 'en-US']) {
      const context = await browser.newContext({ locale: language, viewport: { width: 1672, height: 1000 }, reducedMotion: 'reduce' }); contexts.push(context);
      const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('request', r => { if (!r.url().startsWith(app.origin)) external.push(r.url()); });
      await p.goto(app.url); await ready(p);
      assert.equal(await p.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'true', 'Fresh page defaults to the original expanded shell');
      // Existing palette preference legitimately persists; establish it before measuring shell writes.
      await p.locator('#palette-toggle').click(); await p.locator('#palette-toggle').click();
      const storage = await p.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)]);
      await p.locator('.workspace-nav a[href="#documents-section"]').click(); await listed(p);
      await p.locator('[data-document="docs/shell-demo.md"]').click(); await p.waitForFunction(() => document.querySelector('#documents-body h1'));
      for (const width of [320, 390, 768, 1280, 1672]) for (const theme of ['light', 'dark']) {
        await p.setViewportSize({ width, height: 1000 }); await p.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await p.waitForFunction(value => document.documentElement.dataset.base === value, theme);
        const measures = {};
        for (const expanded of [true, false]) {
          await toggle(p, expanded); let baseline;
          for (const page of pages) {
            const link = p.locator(`.workspace-nav a[href="#${page}"]`); await link.click();
            await p.waitForFunction(value => document.documentElement.dataset.view === value, page); await p.evaluate(() => scrollTo(0, 0));
            assert.equal(await p.locator(`#${page}`).isVisible(), true); assert.equal(await link.getAttribute('aria-current'), 'page');
            assert.equal(await p.locator('#page-title').textContent(), await link.getAttribute('aria-label'), 'One page title uses the shared header');
            assert.equal(await p.locator('#sidebar-toggle').getAttribute('aria-expanded'), String(expanded), 'Navigation never changes the user choice');
            assert.equal(await p.locator('.topbar').isVisible(), true); assert.equal(await p.locator('.workspace-nav').isVisible(), true);
            assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${language}/${width}/${theme}/${page}: no whole-page overflow`);
            const box = await geometry(p); if (!baseline) baseline = box; else { assert.deepEqual(box.nav, baseline.nav, 'Navigation geometry is identical across all four pages'); assert.deepEqual(box.header, baseline.header, 'Header geometry is identical across all four pages'); assert.equal(box.title[0], baseline.title[0]); assert.equal(box.title[1], baseline.title[1]); assert.equal(box.padding, baseline.padding); }
            if (width > 900) assert.ok(expanded ? box.nav[2] >= 190 && box.nav[2] <= 212 : box.nav[2] === 64, 'Desktop original sidebar / 64px rail');
            else assert.equal(box.nav[0], parseFloat(box.padding), 'Phone navigation stays above the full-width content, not a left rail');
            for (const item of await p.locator('.workspace-nav > a, #nav-behaviors').all()) { const label = await item.getAttribute('aria-label'); assert.ok(label && label.length > 1); assert.equal(await item.getAttribute('title'), label); if (!expanded) assert.equal(await item.locator('[data-i18n]').isVisible(), false, 'Collapsed labels do not take layout space'); }
            if (page === 'documents-section') {
              await p.waitForFunction(() => { const open = document.querySelector('#documents-section').clientWidth > 1050; return document.querySelector('.reader-library').open === open && document.querySelector('.reader-contents').open === open; });
              const metrics = await p.locator('#documents-body').evaluate(n => { const r = n.getBoundingClientRect(), s = getComputedStyle(n); return { top: r.top, width: r.width, size: s.fontSize, line: s.lineHeight, first: n.querySelector('p').getBoundingClientRect().bottom }; });
              assert.equal(metrics.size, '18px'); assert.equal(metrics.line, '32.4px'); assert.ok(metrics.width <= 720 && metrics.width >= (width <= 390 ? 240 : width <= 768 ? 500 : 540)); assert.ok(metrics.top < 450 && metrics.first < 700, `Document still visible on first screen: ${JSON.stringify(metrics)}`);
              assert.equal(await p.locator('#documents-section h2').count(), 1, 'Only the actual source heading is an h2; no extra page-title layer');
              assert.equal(await p.locator('#action-panel .reader-toolbar').isVisible(), true); assert.equal(await p.locator('#local-console-info').isVisible(), true); assert.equal(await p.locator('#local-console-info details').evaluate(n => n.open), false);
              assert.equal(await p.locator('#documents-body a, #documents-body img, #documents-body script').count(), 0); assert.equal(await p.evaluate(() => window.shellXss), undefined);
              await shot(p, `${language}-${width}-${theme}-${expanded ? 'expanded' : 'collapsed'}-documents`);
            } else if (width === 1672) await shot(p, `${language}-${width}-${theme}-${expanded ? 'expanded' : 'collapsed'}-${page}`);
          }
          measures[String(expanded)] = baseline;
        }
        if (width > 900) { assert.ok(measures.false.main > measures.true.main + 100, 'Collapsed sidebar gives space back to every main view'); assert.equal(measures.false.header[1], measures.true.header[1]); }
        else assert.ok(measures.false.nav[3] < measures.true.nav[3], 'Collapsed phone navigation is a compact icon row');
      }
      await p.setViewportSize({ width: 1280, height: 1000 }); await toggle(p, true);
      await p.locator('#sidebar-toggle').focus(); await p.keyboard.press('Enter'); assert.equal(await p.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'false');
      assert.equal(await p.evaluate(() => document.activeElement.id), 'sidebar-toggle'); assert.equal(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), true);
      await p.keyboard.press('Escape'); assert.equal(await p.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'false', 'Nonmodal rail does not hijack Escape');
      await p.keyboard.press('Tab'); assert.equal(await p.evaluate(() => document.activeElement.hash), '#architecture'); await p.keyboard.press('Enter'); await p.waitForFunction(() => document.documentElement.dataset.view === 'architecture');
      await p.locator('.workspace-nav a[href="#documents-section"]').click(); await listed(p);
      await p.locator('#nav-behaviors').focus(); await p.keyboard.press('Enter'); await p.locator('#behavior-docs-dialog').waitFor({ state: 'visible' });
      await p.waitForFunction(() => !document.querySelector('#behavior-docs-close').disabled); await p.keyboard.press('Escape'); await p.locator('#behavior-docs-dialog').waitFor({ state: 'hidden' });
      assert.equal(await p.evaluate(() => document.activeElement.id), 'nav-behaviors', 'Rail action dialog restores its real trigger');
      await p.locator('#documents-focus').click(); assert.equal(await p.locator('.reader-library summary').isVisible(), false); assert.equal(await p.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'false'); assert.equal(await p.locator('.workspace-nav').isVisible(), true); assert.equal(await p.locator('.topbar').isVisible(), true); await p.locator('#documents-focus').click();
      await p.locator('#local-console-info summary').focus(); await p.keyboard.press('Enter'); assert.equal(await p.locator('#local-console-info details').evaluate(n => n.open), true); await p.keyboard.press('Enter');
      let release, entered; const held = new Promise(resolve => { entered = resolve; });
      await p.route('**/api/invoke', async route => { if (route.request().postDataJSON()?.channel === 'governance.snapshot') { const response = await route.fetch(); entered(); await new Promise(resolve => { release = resolve; }); return route.fulfill({ response }); } return route.continue(); });
      await p.locator('#refresh').evaluate(n => n.click()); await held;
      try { assert.equal(await p.locator('#sidebar-toggle').isDisabled(), false, 'Unrelated global write lock cannot disable shell disclosure'); await p.locator('#sidebar-toggle').click(); assert.equal(await p.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'true'); await p.locator('#sidebar-toggle').click(); }
      finally { release(); }
      await ready(p); await p.unroute('**/api/invoke'); assert.equal(await p.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'false', 'Refresh preserves manual state');
      await context.setOffline(true); await p.waitForFunction(() => document.querySelector('#documents-refresh').disabled); assert.match(await p.locator('#documents-status').textContent(), /Offline|离线/); assert.match(await p.locator('#documents-body').textContent(), /A shared workspace/);
      assert.equal(await p.locator('#sidebar-toggle').isDisabled(), false); await toggle(p, true); await toggle(p, false); await context.setOffline(false); await listed(p);
      await p.locator('#palette-toggle').click(); assert.equal(await p.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'false'); await p.locator('#palette-toggle').click();
      await p.setViewportSize({ width: 320, height: 1000 }); assert.equal(await p.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'false'); await p.setViewportSize({ width: 1672, height: 1000 }); assert.equal(await p.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'false');
      await p.locator('#sidebar-toggle').focus(); await p.keyboard.press('Space'); assert.equal(await p.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'true'); assert.equal(await p.evaluate(() => document.activeElement.id), 'sidebar-toggle');
      await toggle(p, false); await p.locator('.workspace-nav a[href="#board-section"]').focus(); await p.keyboard.press('Enter'); await p.waitForFunction(() => document.documentElement.dataset.view === 'board-section' && document.activeElement.hash === '#board-section');
      assert.deepEqual(await p.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)]), storage, 'Shell preference writes no browser storage');
      await p.reload(); await ready(p); assert.equal(await p.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'true', 'Reload defaults; no project/browser persistence');
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(await fs.readFile(path.join(root, 'STATE.json')), before, 'Shell and reading never write project state');
    console.log(`PASS unified shell: four-page geometry, original desktop sidebar/64px rail, full-width mobile rows, keyboard/focus/lock/refresh/offline/theme/resize/no-persistence and safe reader; ${shots} screenshots: ${output}`);
  } finally { for (const context of contexts) await context.close(); await app?.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); }
};
