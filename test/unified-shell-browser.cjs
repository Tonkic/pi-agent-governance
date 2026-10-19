'use strict';
// Real HTTP five-page shell. Demo content is not repository evidence.
module.exports = async ({ browser, screenshots }) => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const { Governance } = require('../build/plugin/core'), { startConsole } = require('../build/web/server');
  const root = await fs.realpath(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'shell083-fixture-')));
  const output = path.join(screenshots, 'unified-shell'); await fs.mkdir(output, { recursive: true });
  const pages = ['board-section', 'architecture', 'git-section', 'documents-section', 'behaviors-section'];
  const article = '# A shared workspace / 统一工作台\n\nDemo document · 示例材料\n\n' + 'The shared shell leaves room to read. 默认图标栏，移入展开时不挤压正文。'.repeat(8) + '\n\n## Safe text\n\n![image](https://remote.invalid/image.png)\n[link](javascript:window.shellXss=1)\n<img src="https://remote.invalid/pixel" onerror="window.shellXss=2">\n\n```txt\n' + 'long-code-'.repeat(100) + '\n```\n';
  const contexts = [], errors = [], external = []; let app, shots = 0;
  const ready = p => p.waitForFunction(() => document.querySelector('#board-section').getAttribute('aria-busy') === 'false' && !document.querySelector('#refresh').disabled);
  const listed = p => p.waitForFunction(() => document.querySelector('#documents-section').getAttribute('aria-busy') === 'false' && !document.querySelector('#documents-refresh').disabled);
  const reveal = async (p, expanded) => {
    await p.evaluate(() => document.activeElement?.blur());
    await p.mouse.move(p.viewportSize().width - 2, 1);
    if (expanded) await p.locator('.workspace-nav').hover({ position: { x: 20, y: 20 } });
    if (p.viewportSize().width > 900) await p.waitForFunction(w => document.querySelector('.workspace-nav').getBoundingClientRect().width === w, expanded ? 212 : 64);
  };
  const geometry = p => p.evaluate(() => {
    const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 100) / 100); };
    return { nav: box('.workspace-nav'), header: box('.topbar'), title: box('#page-title'), padding: getComputedStyle(document.querySelector('.app-shell')).paddingLeft, main: document.querySelector('.topbar').clientWidth };
  });
  const shot = async (p, name) => { await p.screenshot({ path: path.join(output, `shell083-${name}.png`) }); shots++; };
  try {
    await new Governance(root).run({ action: 'init' }); await fs.mkdir(path.join(root, 'docs')); await fs.writeFile(path.join(root, 'docs', 'shell-demo.md'), article);
    const before = await fs.readFile(path.join(root, 'STATE.json')); app = await startConsole({ workspace: root });
    for (const language of ['zh-CN', 'en-US']) {
      const context = await browser.newContext({ locale: language, viewport: { width: 1672, height: 1000 }, reducedMotion: 'reduce' }); contexts.push(context);
      const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('request', r => { if (!r.url().startsWith(app.origin)) external.push(r.url()); });
      await p.goto(app.url); await ready(p); await reveal(p, false);
      assert.equal(await p.locator('#sidebar-toggle').count(), 0, 'No manual disclosure button');
      assert.equal((await geometry(p)).nav[2], 64, 'Fresh desktop defaults to icon rail');
      await p.locator('#palette-toggle').click(); await p.locator('#palette-toggle').click();
      const storage = await p.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)]);
      await p.locator('a[href="#documents-section"]').click(); await listed(p);
      await p.locator('[data-document="docs/shell-demo.md"]').click(); await p.waitForFunction(() => document.querySelector('#documents-body h1'));
      for (const width of [320, 390, 768, 1280, 1672]) for (const theme of ['light', 'dark']) {
        await p.setViewportSize({ width, height: 1000 }); await p.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await p.waitForFunction(value => document.documentElement.dataset.base === value, theme);
        const measures = {};
        for (const expanded of width > 900 ? [false, true] : [false]) {
          let baseline;
          for (const page of pages) {
            const link = p.locator(`.workspace-nav a[href="#${page}"]`); await link.click();
            await p.waitForFunction(value => document.documentElement.dataset.view === value, page); await p.evaluate(() => scrollTo(0, 0)); await reveal(p, expanded);
            assert.equal(await p.locator(`#${page}`).isVisible(), true); assert.equal(await link.getAttribute('aria-current'), 'page');
            assert.equal(await p.locator('#page-title').textContent(), await link.getAttribute('aria-label'));
            assert.equal(await p.locator('.topbar').isVisible(), true); assert.equal(await p.locator('.workspace-nav').isVisible(), true);
            if (width <= 390) assert.equal(await p.locator('.topbar').evaluate(n => getComputedStyle(n).minHeight), '64px');
            assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${language}/${width}/${theme}/${page}: no overflow`);
            const box = await geometry(p); if (!baseline) baseline = box; else { assert.deepEqual(box.nav, baseline.nav); assert.deepEqual(box.header, baseline.header); assert.deepEqual(box.title.slice(0, 2), baseline.title.slice(0, 2)); assert.equal(box.padding, baseline.padding); }
            if (width > 900) assert.equal(box.nav[2], expanded ? 212 : 64);
            else assert.equal(box.nav[0], parseFloat(box.padding), 'Narrow navigation stays above full-width content');
            for (const item of await p.locator('.workspace-nav > a').all()) { const label = await item.getAttribute('aria-label'); assert.ok(label && label.length > 1); assert.equal(await item.getAttribute('title'), label); assert.equal(await item.locator('[data-i18n]').isVisible(), width <= 900 || expanded); }
            if (page === 'documents-section') {
              await listed(p); await p.waitForFunction(() => { const open = document.querySelector('#documents-section').clientWidth > 1050; return document.querySelector('.reader-library').open === open && document.querySelector('.reader-contents').open === open; });
              const metrics = await p.locator('#documents-body').evaluate(n => { const r = n.getBoundingClientRect(), s = getComputedStyle(n); return { top: r.top, width: r.width, size: s.fontSize, line: s.lineHeight, first: n.querySelector('p').getBoundingClientRect().bottom }; });
              assert.equal(metrics.size, '18px'); assert.equal(metrics.line, '32.4px'); assert.ok(metrics.width <= 720 && metrics.width >= (width <= 390 ? 240 : width <= 768 ? 500 : 540)); assert.ok(metrics.top < 450 && metrics.first < 700, `First screen: ${JSON.stringify(metrics)}`);
              assert.equal(await p.locator('#documents-section h2').count(), 1); assert.equal(await p.locator('#action-panel .reader-toolbar').isVisible(), true); assert.equal(await p.locator('#local-console-info').isVisible(), true); assert.equal(await p.locator('#local-console-info details').evaluate(n => n.open), false);
              assert.equal(await p.locator('#documents-body a, #documents-body img, #documents-body script').count(), 0); assert.equal(await p.evaluate(() => window.shellXss), undefined);
              await shot(p, `${language}-${width}-${theme}-${expanded ? 'hover' : 'rail'}-documents`);
            } else if (width === 1672) await shot(p, `${language}-${width}-${theme}-${expanded ? 'hover' : 'rail'}-${page}`);
          }
          measures[String(expanded)] = baseline;
        }
        if (width > 900) { assert.equal(measures.false.main, measures.true.main, 'Overlay never reflows main content'); assert.deepEqual(measures.false.header, measures.true.header); assert.equal(measures.false.padding, measures.true.padding); }
      }
      await p.setViewportSize({ width: 1280, height: 1000 }); await reveal(p, false);
      await p.locator('a[href="#architecture"]').focus(); await p.keyboard.press('Tab');
      assert.equal(await p.evaluate(() => document.activeElement.hash), '#board-section');
      await p.waitForFunction(() => document.querySelector('.workspace-nav').getBoundingClientRect().width === 212);
      assert.equal(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), true);
      await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); assert.equal(await p.evaluate(() => document.activeElement.id), 'nav-behaviors'); await p.keyboard.press('Enter');
      await p.waitForFunction(() => document.documentElement.dataset.view === 'behaviors-section' && !document.querySelector('#behavior-refresh').disabled);
      assert.equal(await p.locator('dialog#behavior-docs-dialog').count(), 0); await p.keyboard.press('Escape'); assert.equal(await p.locator('#behaviors-section').isVisible(), true, 'Primary page is not a dismissible modal');
      await p.locator('a[href="#documents-section"]').click(); await listed(p);
      await p.locator('#documents-focus').click(); assert.equal(await p.locator('.reader-library summary').isVisible(), false); assert.equal(await p.locator('.workspace-nav').isVisible(), true); assert.equal(await p.locator('.topbar').isVisible(), true); await p.locator('#documents-focus').click();
      await p.locator('#local-console-info summary').focus(); await p.keyboard.press('Enter'); assert.equal(await p.locator('#local-console-info details').evaluate(n => n.open), true); await p.keyboard.press('Enter');
      let release, entered; const held = new Promise(resolve => { entered = resolve; });
      await p.route('**/api/invoke', async route => { if (route.request().postDataJSON()?.channel === 'governance.snapshot') { const response = await route.fetch(); entered(); await new Promise(resolve => { release = resolve; }); return route.fulfill({ response }); } return route.continue(); });
      await p.locator('#refresh').evaluate(n => n.click()); await held;
      try { await reveal(p, true); await reveal(p, false); assert.equal(await p.locator('#refresh').isDisabled(), true, 'Navigation disclosure never weakens write locks'); } finally { release(); }
      await ready(p); await p.unroute('**/api/invoke'); await listed(p); await reveal(p, false);
      await context.setOffline(true); await p.waitForFunction(() => document.querySelector('#documents-refresh').disabled); assert.match(await p.locator('#documents-status').textContent(), /Offline|离线/); assert.match(await p.locator('#documents-body').textContent(), /A shared workspace/);
      await reveal(p, true); await reveal(p, false); await context.setOffline(false); await listed(p);
      await p.locator('#palette-toggle').click(); await reveal(p, false); assert.equal((await geometry(p)).nav[2], 64); await p.locator('#palette-toggle').click();
      await p.setViewportSize({ width: 320, height: 1000 }); assert.equal(await p.locator('#nav-behaviors').isVisible(), true); await p.setViewportSize({ width: 1672, height: 1000 }); await reveal(p, false); assert.equal((await geometry(p)).nav[2], 64);
      await p.locator('a[href="#board-section"]').click(); await p.waitForFunction(() => document.documentElement.dataset.view === 'board-section'); await reveal(p, false);
      assert.deepEqual(await p.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)]), storage, 'No shell storage writes');
      await p.reload(); await ready(p); await reveal(p, false); assert.equal((await geometry(p)).nav[2], 64);
    }
    const touch = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true }); contexts.push(touch);
    const p = await touch.newPage(); await p.goto(app.url); await ready(p);
    for (const id of pages) { await p.locator(`a[href="#${id}"]`).tap(); await p.waitForFunction(id => !document.getElementById(id).hidden, id); assert.equal(await p.locator(`a[href="#${id}"] [data-i18n]`).isVisible(), true); }
    assert.equal(await p.locator('#sidebar-toggle').count(), 0); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(await fs.readFile(path.join(root, 'STATE.json')), before);
    console.log(`PASS unified shell: five primary pages, default64px rail/hover overlay/no content shift, keyboard and touch navigation, locks/offline/refresh/theme/resize/no persistence, safe18px reader; ${shots} screenshots: ${output}`);
  } finally { for (const context of contexts) await context.close(); await app?.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); }
};
