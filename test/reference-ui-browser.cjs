'use strict';
// Real HTTP, real temporary project; all test records are explicitly demo data.
module.exports = async ({ browser, screenshots }) => {
  const assert = require('node:assert/strict');
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const { Governance } = require('../build/plugin/core');
  const { startConsole } = require('../build/web/server');
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'reference-ui-demo-workspace-'));
  const output = path.join(screenshots, 'reference-ui'); await fs.mkdir(output, { recursive: true });
  const g = new Governance(root);
  await g.run({ action: 'init' });
  await g.run({ action: 'start', id: 'reference-demo', goal: 'Demo data for browser verification only', criteria: ['Real snapshot counts'] });
  const app = await startConsole({ workspace: root });
  const contexts = [];
  let page, shots = 0;
  const ready = async p => p.waitForFunction(() => document.querySelector('#board-section').getAttribute('aria-busy') === 'false' && !document.querySelector('#refresh').disabled);
  const refresh = async p => { await p.locator('#refresh').click(); await ready(p); };
  const summary = p => Promise.all(['summary-total', 'summary-doing', 'summary-done', 'summary-impact', 'summary-todo', 'summary-percent'].map(id => p.locator('#' + id).textContent()));
  const mutate = async args => g.run({ ...args, expectedRevision: (await g.run({ action: 'project_snapshot' })).revision });
  try {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1672, height: 1100 } }); contexts.push(context);
    page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    let snapshotRequests = 0;
    page.on('request', request => {
      if (request.url().endsWith('/api/invoke') && ['governance.snapshot', 'governance.project', 'governance.git'].includes(request.postDataJSON()?.channel)) snapshotRequests++;
    });
    await page.goto(app.url); await ready(page);
    assert.deepEqual(await summary(page), ['0', '0', '0', '0', '0', '0%']);
    assert.match(await page.locator('#summary-availability').textContent(), /暂无工作项/);
    assert.equal(await page.locator('#summary-workspace-path').textContent(), root);
    assert.equal(await page.locator('#summary-workspace-name').textContent(), path.basename(root));
    assert.equal(await page.locator('#summary-task').textContent(), 'reference-demo');
    assert.match(await page.locator('#welcome-title').textContent(), /基于Agent的工程化项目治理工作台/);
    for (let i = 0; i < 9; i++) {
      await mutate({ action: 'board_create', id: `demo-${i}`, title: `Demo data · 演示工作项 ${i} ${i === 0 ? 'Long title reflows safely without covering adjacent cards '.repeat(2) : ''}`, description: 'Demo data / 演示数据 — no fictional production activity.', architectureImpact: i < 4 ? 'affects' : 'none' });
      if (i < 7) await mutate({ action: 'board_move', id: `demo-${i}`, stage: 'doing', position: 0 });
      if (i < 6) await mutate({ action: 'board_move', id: `demo-${i}`, stage: 'done', position: 0 });
    }
    await refresh(page);
    assert.deepEqual(await summary(page), ['9', '1', '6', '4', '2', '67%']);
    assert.equal(await page.locator('.board-column[data-stage="done"] [data-workitem]').count(), 5);
    assert.match(await page.locator('#summary-ring').getAttribute('aria-label'), /67%.*6 \/ 9/);
    assert.match(await page.locator('#summary-state').textContent(), /进行中|工作中/);
    const requests = snapshotRequests;
    await page.locator('#board-search').fill('no-matching-demo');
    assert.equal(await page.locator('#board-empty').isVisible(), true);
    assert.deepEqual(await summary(page), ['9', '1', '6', '4', '2', '67%']);
    await page.locator('#search-clear').click();
    assert.equal(snapshotRequests, requests, 'Search and summary reuse the loaded snapshots');
    await page.locator('#nav-behaviors').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#behavior-docs-dialog').isVisible(), true);
    await page.locator('#behavior-docs-close').click();
    // Existing safe project-view controls perform real navigation, never a Git command.
    await page.locator('[data-project-view="architecture"]').click();
    await page.locator('#architecture').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#architecture').isVisible(), true);
    assert.equal(await page.locator('.welcome-banner').isVisible(), false);
    await page.locator('.workspace-nav a[href="#board-section"]').click();
    await page.locator('[data-project-view="git-section"]').click();
    await page.locator('#git-section').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#git-section').isVisible(), true);
    await page.locator('.workspace-nav a[href="#board-section"]').click();
    for (const locale of ['zh-CN', 'en-US']) {
      let p = page;
      if (locale === 'en-US') {
        const en = await browser.newContext({ locale, viewport: { width: 1672, height: 1100 } }); contexts.push(en);
        p = await en.newPage(); await p.goto(app.url); await ready(p);
        assert.match(await p.locator('#welcome-title').textContent(), /engineering workspace/);
      }
      for (const width of [320, 390, 768, 1280, 1672]) for (const theme of ['light', 'dark']) {
        await p.setViewportSize({ width, height: 1100 }); await p.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await p.waitForFunction(expected => document.documentElement.dataset.base === expected, theme);
        assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${locale}/${width}/${theme}: no whole-page overflow`);
        assert.deepEqual(await summary(p), ['9', '1', '6', '4', '2', '67%']);
        const columns = await p.locator('#board-columns').boundingBox(), overview = await p.locator('.project-overview').boundingBox();
        if (width === 1672) {
          assert.ok(overview.x >= columns.x + columns.width, 'Overview stays to the right of the board');
          assert.equal(Math.round(overview.width), 260);
        } else assert.ok(overview.y >= columns.y + columns.height - 1, 'Overview stacks, never squeezes the board');
        assert.equal(await p.locator('.completion-ring').evaluate(el => getComputedStyle(el).animationName), 'none');
        await p.locator('#board-search').focus(); await p.keyboard.press('Tab');
        assert.ok(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), 'Keyboard focus is visible');
        await p.evaluate(() => scrollTo(0, 0));
        await p.screenshot({ path: path.join(output, `${locale}-${width}-${theme}.png`), fullPage: true }); shots++;
      }
    }
    await page.setViewportSize({ width: 1672, height: 1100 });
    await mutate({ action: 'board_move', id: 'demo-7', stage: 'doing', position: 0 });
    await mutate({ action: 'board_move', id: 'demo-7', stage: 'done', position: 0 });
    await refresh(page);
    assert.deepEqual(await summary(page), ['9', '1', '7', '4', '1', '78%']);
    await context.setOffline(true);
    await page.waitForFunction(() => document.querySelector('#board-new').disabled);
    assert.match(await page.locator('#summary-availability').textContent(), /离线/);
    assert.deepEqual(await summary(page), ['9', '1', '7', '4', '1', '78%']);
    await context.setOffline(false); await ready(page);
    await page.route('**/api/invoke', route => route.request().postDataJSON()?.channel === 'governance.project' ? route.fulfill({ json: { ok: false, error: 'Demo project read failure' } }) : route.continue());
    await refresh(page);
    assert.deepEqual(await summary(page), ['—', '—', '—', '—', '—', '—']);
    assert.match(await page.locator('#summary-availability').textContent(), /不可用/);
    assert.deepEqual(errors, []);
    console.log(`PASS reference UI real HTTP: empty/9-item/full-history counts, search independence, external transitions, offline/error, safe actions, keyboard/reduced motion, 320/390/768/1280/1672 bilingual light/dark; ${shots} screenshots: ${output}`);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    for (const context of contexts) await context.close();
    await app.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
};
