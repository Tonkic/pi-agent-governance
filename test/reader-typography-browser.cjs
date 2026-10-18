'use strict';
// Real HTTP, explicitly labelled fixture documents. No remote resources or timing sleeps.
module.exports = async ({ browser, screenshots }) => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const { Governance } = require('../build/plugin/core'), { startConsole } = require('../build/web/server');
  const root = await fs.realpath(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'reader080-fixture-')));
  const output = path.join(screenshots, 'reader080-ui'); await fs.mkdir(output, { recursive: true });
  const english = 'Typography should help the reader follow a thought without noticing the interface. A quiet system font, a comfortable measure and a clear paragraph rhythm make technical material easier to revisit. ';
  const chinese = '字体就像空气，阅读不应被界面打断。正文需要舒适的行宽、自然的段落与清晰的结构。代码只是解释思路的一部分，不应该抢走文章的主角位置。';
  const fixture = '# Reading, without the noise / 安静地阅读\n\nDemo document · 排版测试材料\n\n' + english.repeat(3) + '\n\n' + chinese.repeat(3) + '\n\n## Natural flow / 自然流动\n\n中文软换行\n应该自然拼接。\n\nEnglish soft wrapping\nuses one space.\n\nA hard break  \nstays a line break.\n\n*Emphasis* and _another emphasis_, **strong**, __also strong__, ~~removed~~, `inline_code`.\n\n## Structure / 结构\n\n- Parent list\n  - Child item\n    1. Nested ordered item\n  - Another child\n- [x] Completed task\n- [ ] Read-only task\n\n> A continuous quotation\n> flows as one paragraph.\n\n## Table / 表格\n\n| Option | Meaning | Value | Note |\n| --- | :--- | ---: | --- |\n| **Measure** | Comfortable reading | 70ch | Demo only |\n| Long token | ' + 'table-token-'.repeat(30) + ' | 18px | No clipping |\n\n## Code / 代码\n\n```ts\nconst preserve = "  spaces and line breaks";\n  const longToken = "' + 'code-token-'.repeat(80) + '";\n```\n\n' + 'long-token-'.repeat(100) + '\n\n## Literal resources / 资源原样显示\n\n![**image**](https://remote.invalid/a.png)\n[**link**](javascript:window.reader080Xss=1)\n<svg onload="window.reader080Xss=2"></svg>\nhttps://remote.invalid/file_with_underscores\n\n## Finish / 结尾\n\n' + english + chinese;
  let app, shots = 0; const contexts = [], errors = [], external = [];
  const ready = p => p.waitForFunction(() => document.querySelector('#board-section').getAttribute('aria-busy') === 'false' && !document.querySelector('#refresh').disabled);
  const listed = p => p.waitForFunction(() => document.querySelector('#documents-section').getAttribute('aria-busy') === 'false' && !document.querySelector('#documents-refresh').disabled);
  const openLibrary = async p => { if (!await p.locator('.reader-library').evaluate(n => n.open)) await p.locator('.reader-library summary').click(); };
  const read = async (p, file) => { await openLibrary(p); await p.locator(`[data-document="${file}"]`).click(); await p.waitForFunction(() => document.querySelector('#documents-body').getAttribute('aria-busy') === 'false' && document.querySelector('#documents-body').textContent.length > 0); };
  const shot = async (p, name, fullPage = false) => { await p.screenshot({ path: path.join(output, `reader080-ui-${name}.png`), fullPage }); shots++; };
  try {
    await new Governance(root).run({ action: 'init' }); await fs.mkdir(path.join(root, 'docs'));
    await fs.writeFile(path.join(root, 'docs', 'typography-demo.md'), fixture);
    await fs.writeFile(path.join(root, 'docs', 'other-demo.md'), '# Another demo\n\nA separate selection.');
    await fs.writeFile(path.join(root, 'docs', 'budget-demo.md'), '# Budget demo\n\n' + '|x|y|\n|---|---|\n' + '|*one*|~~two~~|\n'.repeat(1000));
    await fs.writeFile(path.join(root, 'docs', 'headings-demo.md'), '# Heading\n\n'.repeat(201));
    await fs.writeFile(path.join(root, 'docs', 'literal-demo.md'), '# Literal demo\n\n' + '['.repeat(60000) + '\n\n' + '_'.repeat(60000));
    const before = await fs.readFile(path.join(root, 'STATE.json')); app = await startConsole({ workspace: root });
    for (const language of ['zh-CN', 'en-US']) {
      const context = await browser.newContext({ locale: language, viewport: { width: 1672, height: 1000 }, reducedMotion: 'reduce' }); contexts.push(context);
      const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('request', r => { if (!r.url().startsWith(app.origin)) external.push(r.url()); });
      await p.goto(app.url); await ready(p); await p.locator('.workspace-nav a[href="#documents-section"]').click(); await listed(p);
      await read(p, 'docs/typography-demo.md');
      assert.equal(await p.evaluate(() => document.activeElement.id), 'documents-body', 'Selection moves focus to the loaded article');
      assert.equal(await p.locator('#documents-body table').count(), 1); assert.equal(await p.locator('#documents-body th').count(), 4);
      assert.equal(await p.locator('#documents-body em').count(), 2); assert.equal(await p.locator('#documents-body strong').count(), 3); assert.equal(await p.locator('#documents-body del').count(), 1);
      assert.equal(await p.locator('#documents-body ul ul ol li').count(), 1); assert.equal(await p.locator('.reader-task-mark[role="img"]').count(), 2);
      assert.equal(await p.locator('#documents-body input').count(), 0, 'Task states are read-only icons, not fake controls');
      assert.equal(await p.locator('#documents-body blockquote').count(), 1); assert.equal(await p.locator('#documents-body blockquote').textContent(), 'A continuous quotation flows as one paragraph.');
      assert.ok((await p.locator('#documents-body').textContent()).includes('中文软换行应该自然拼接。'));
      assert.ok((await p.locator('#documents-body').textContent()).includes('English soft wrapping uses one space.'));
      assert.equal(await p.locator('#documents-body br').count(), 1);
      assert.ok((await p.locator('#documents-body pre code').textContent()).startsWith('const preserve = "  spaces and line breaks";\n  const longToken'));
      assert.equal(await p.locator('#documents-body a, #documents-body img, #documents-body svg, #documents-body script, #documents-body iframe').count(), 0);
      assert.ok((await p.locator('#documents-body').textContent()).includes('![**image**](https://remote.invalid/a.png)'));
      assert.ok((await p.locator('#documents-body').textContent()).includes('[**link**](javascript:window.reader080Xss=1)'));
      for (const width of [320, 390, 768, 1280, 1672]) for (const theme of ['light', 'dark']) {
        await p.setViewportSize({ width, height: 1000 }); await p.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await p.waitForFunction(value => document.documentElement.dataset.base === value, theme);
        await p.evaluate(() => scrollTo(0, 0));
        const metrics = await p.locator('#documents-body').evaluate(n => { const s = getComputedStyle(n), r = n.getBoundingClientRect(); return { font: s.fontFamily, size: s.fontSize, leading: s.lineHeight, align: s.textAlign, width: r.width, top: r.top, firstParagraph: n.querySelector('p').getBoundingClientRect().bottom, whiteSpace: getComputedStyle(n.querySelector('p')).whiteSpace, animation: s.animationName }; });
        assert.match(metrics.font, /Segoe UI/); assert.match(metrics.font, /Microsoft YaHei/); assert.equal(metrics.size, '18px'); assert.equal(metrics.leading, '32.4px'); assert.equal(metrics.align, 'left'); assert.equal(metrics.whiteSpace, 'normal'); assert.equal(metrics.animation, 'none');
        assert.ok(metrics.top < 450 && metrics.firstParagraph < 700, `${language}/${width}: real article visible on first screen`);
        assert.ok(metrics.width <= 720 && metrics.width >= (width <= 390 ? 240 : width <= 768 ? 500 : 540), `${width}: bounded real prose width ${metrics.width}`);
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${language}/${width}/${theme}: no whole-page overflow`);
        assert.equal(await p.locator('#local-console-info').isVisible(), false); assert.equal(await p.locator('#action-panel').isVisible(), false); assert.equal(await p.locator('.topbar').isVisible(), false);
        if (width <= 900) { assert.equal(await p.locator('.reader-library').evaluate(n => n.open), false); assert.equal(await p.locator('.reader-contents').evaluate(n => n.open), false); }
        assert.equal(await p.locator('#documents-body pre').evaluate(n => n.scrollWidth > n.clientWidth && getComputedStyle(n).overflowX === 'auto'), true);
        await shot(p, `${language}-${width}-${theme}`);
      }
      await shot(p, `${language}-rich-document`, true);
      await p.setViewportSize({ width: 390, height: 1000 });
      await p.waitForFunction(() => !document.querySelector('.reader-library').open && !document.querySelector('.reader-contents').open);
      await p.locator('.reader-library summary').focus(); await p.keyboard.press('Enter');
      assert.equal(await p.locator('.reader-library').evaluate(n => n.open), true);
      await p.keyboard.press('Tab'); assert.equal(await p.evaluate(() => document.activeElement.id), 'documents-search');
      assert.equal(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), true);
      await p.locator('#documents-search').fill('other-demo'); await p.keyboard.press('Tab'); await p.keyboard.press('Enter');
      await p.waitForFunction(() => document.querySelector('#documents-body h1')?.textContent === 'Another demo');
      assert.equal(await p.locator('.reader-library').evaluate(n => n.open), false); assert.equal(await p.evaluate(() => document.activeElement.id), 'documents-body');
      await openLibrary(p); await p.locator('#documents-search').fill(''); await read(p, 'docs/typography-demo.md');
      await p.locator('.reader-contents summary').focus(); await p.keyboard.press('Enter'); await p.locator('#documents-toc button').last().focus(); await p.keyboard.press('Enter');
      assert.equal(await p.evaluate(() => document.activeElement.textContent), 'Finish / 结尾'); assert.equal(await p.locator('.reader-contents').evaluate(n => n.open), false);
      await p.locator('.reader-table').focus(); await p.keyboard.press('ArrowRight');
      await p.waitForFunction(() => document.querySelector('.reader-table').scrollLeft > 0);
      assert.equal(await p.locator('.reader-table').evaluate(n => getComputedStyle(n).outlineStyle !== 'none'), true);
      await shot(p, `${language}-table-keyboard`);
      await p.locator('#documents-body pre').focus(); await p.keyboard.press('ArrowRight');
      await p.waitForFunction(() => document.querySelector('#documents-body pre').scrollLeft > 0);
      for (let i = 0; i < 2; i++) await p.locator('#documents-larger').click(); assert.equal(await p.locator('#documents-larger').isDisabled(), true); assert.equal(await p.locator('#documents-body').evaluate(n => getComputedStyle(n).fontSize), '20px');
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      for (let i = 0; i < 4; i++) await p.locator('#documents-smaller').click(); assert.equal(await p.locator('#documents-smaller').isDisabled(), true);
      for (let i = 0; i < 2; i++) await p.locator('#documents-larger').click();
      await p.locator('#documents-focus').click(); assert.equal(await p.locator('.reader-library summary').isVisible(), false); assert.equal(await p.locator('#documents-focus').getAttribute('aria-pressed'), 'true');
      await p.evaluate(() => scrollTo(0, 0)); await shot(p, `${language}-focus`);
      await p.locator('#documents-focus').click(); assert.equal(await p.locator('.reader-library summary').isVisible(), true);
      await context.setOffline(true); await p.waitForFunction(() => document.querySelector('#documents-refresh').disabled);
      assert.match(await p.locator('#documents-status').textContent(), /Offline|离线/); assert.match(await p.locator('#documents-body').textContent(), /Reading, without the noise/);
      await shot(p, `${language}-offline`); await context.setOffline(false); await listed(p);
      await read(p, 'docs/budget-demo.md'); assert.equal(await p.locator('#documents-body pre').count(), 1, 'Global node budget falls back to literal text');
      await read(p, 'docs/headings-demo.md'); assert.equal(await p.locator('#documents-toc button').count(), 200, 'Heading cap stays at 200');
      await read(p, 'docs/literal-demo.md'); assert.ok((await p.locator('#documents-body').textContent()).includes('['.repeat(60000)), 'Adversarial unclosed markers remain literal');
      await p.locator('.reader-back').click(); await ready(p); assert.equal(await p.locator('#local-console-info').isVisible(), true); assert.equal(await p.locator('#action-panel').isVisible(), true); assert.equal(await p.locator('.topbar').isVisible(), true);
      assert.equal(await p.evaluate(() => document.activeElement.hash), '#board-section', 'Return focuses workbench navigation');
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(await fs.readFile(path.join(root, 'STATE.json')), before);
    console.log(`PASS reader typography: real HTTP safe rich text/node budget, system font/measure/first screen, native disclosure/keyboard/focus/size/offline/return; ${shots} screenshots: ${output}`);
  } finally { for (const context of contexts) await context.close(); await app?.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); }
};
