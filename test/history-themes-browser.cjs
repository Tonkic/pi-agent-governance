'use strict';
// Independent visual checks; WS/AD behavior guards stay in browser.cjs.
module.exports = async ({ assert, historyPage, sendAppearance, capture }) => {
  for (const width of [390, 768, 1280]) for (const theme of ['light', 'dark']) {
    await historyPage.setViewportSize({ width, height: 1000 });
    await sendAppearance(historyPage, { base: theme });
    const bounds = await historyPage.locator('#completed-history-dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0);
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - width / 2) < 2, 'History modal is centered');
    assert.equal(await historyPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width === 390) assert.equal(await historyPage.locator('.completed-table-scroll').evaluate(el => el.scrollWidth > el.clientWidth), true);
    await capture(historyPage, `completed-history-${width}-${theme}`);
  }
};
// Extracted unchanged assertions from browser.cjs to keep the behavior read budget bounded.
// This helper still runs serially in the same full browser suite, with the same real fixtures.
module.exports.workbench = async ({ assert, page, english, refresh, navigate, chooseNew, card, first, close, path, output, browser, url, sendAppearance }) => {
  let shots = 0;
  for (const [p, lang] of [[page, 'zh'], [english, 'en']]) {
    await refresh(p);
    for (const width of [390, 768, 1280]) for (const theme of ['light', 'dark']) {
      await p.setViewportSize({ width, height: 1000 });
      await p.evaluate(theme => { document.documentElement.dataset.base = theme; }, theme);
      for (const view of ['board-section', 'architecture', 'git-section']) {
        await navigate(p, view); await p.waitForTimeout(80);
        assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${lang}/${view}/${width}/${theme}`);
        await p.screenshot({ path: path.join(output, `${lang}-${view}-${width}-${theme}.png`), fullPage: true }); shots++;
      }
      assert.equal(await p.locator('#launch-dialog, #architecture-analyze, #project-open').count(), 0);
      await navigate(p, 'board-section');
      const geometry = () => p.locator('.board-column').evaluateAll(rows => rows.map(el => {
        const r = el.getBoundingClientRect(); return { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), width: Math.round(r.width) };
      }));
      const before = await geometry();
      assert.equal(before.length, 3, `${lang}/${width}/${theme}: exactly three stages`);
      assert.equal(await p.locator('#board-columns').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), width > 1100 ? 3 : width > 650 ? 2 : 1);
      assert.equal(await p.getByRole('button', { name: /^(人工验收|Agent 验收|Human review|Agent review)$/ }).count(), 0);
      await card(p, first).click();
      assert.deepEqual(await geometry(), before, `${lang}/${width}/${theme}: modal preserves board layout`);
      assert.ok(await p.locator('#item-sheet').evaluate(el => {
        const r = el.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2 && el.scrollWidth <= el.clientWidth;
      }), 'Details are centered without horizontal overflow');
      const modalShot = await p.screenshot({ path: path.join(output, `${lang}-modal-${width}-${theme}.png`), fullPage: false });
      assert.equal(modalShot.readUInt32BE(20), 1000, 'Modal evidence uses the viewport height'); shots++;
      await close(p); assert.deepEqual(await geometry(), before, 'Closing modal preserves geometry');
      assert.equal(await p.locator('.board-column').evaluateAll(rows => rows.every(el => getComputedStyle(el).borderLeftWidth !== '0px')), true, 'Every stage has a visible column boundary');
    }
    await p.setViewportSize({ width: 1280, height: 1000 }); await navigate(p, 'board-section'); await card(p, first).click();
    await p.screenshot({ path: path.join(output, `${lang}-details-1280.png`), fullPage: false }); shots++; await close(p);
  }
  await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' }); await card(page, first).click();
  assert.equal(await page.locator('#item-sheet').evaluate(el => getComputedStyle(el).animationName), 'none');
  await close(page);
  // Delayed host appearance wins over system fallback, but not a newer host event.
  for (const newerHostEvent of [false, true]) {
    const race = await browser.newPage(); let resolveAppearance;
    await race.exposeFunction('appearanceFixture', () => new Promise(resolve => { resolveAppearance = resolve; }));
    await race.addInitScript(() => {
      window.pluginBridge = {
        invoke: channel => channel === 'app.getAppearance' ? window.appearanceFixture() : Promise.resolve(channel === 'app.getLocale' ? 'en' : { ok: false, error: 'Preview fixture' }),
        on: (event, fn) => { if (event === 'appearance:changed') window.addEventListener('test-appearance', e => fn(e.detail)); }
      };
    });
    await race.goto(url); await race.waitForFunction(() => document.querySelector('#refresh').disabled === false);
    await race.emulateMedia({ colorScheme: 'dark' });
    if (newerHostEvent) await sendAppearance(race, { base: 'dark' });
    resolveAppearance({ base: 'light' });
    await race.waitForFunction(expected => document.documentElement.dataset.base === expected, newerHostEvent ? 'dark' : 'light'); await race.close();
  }
  return shots;
};
module.exports.seedWorkbench = async ({ mutate, refresh, page, makePage, confirm, assert, card }) => {
  // Bounded demo records exist only in the browser test's temporary project.
  for (const item of [
    { id: 'fixture-a', title: 'Check release packaging', description: 'Keep the manifest and generated runtime aligned.' },
    { id: 'fixture-b', title: 'Inspect keyboard navigation', description: 'Focus should return to the selected object.' },
    { id: 'fixture-c', title: 'Review native window behavior', description: 'Confirm controls remain clickable.' }
  ]) await mutate({ action: 'board_create', ...item });
  await mutate({ action: 'board_move', id: 'fixture-b', stage: 'doing', position: 0 });
  await mutate({ action: 'board_update', id: 'fixture-b', title: 'Inspect keyboard navigation', description: 'Focus should return to the selected object.', blocker: 'Waiting for review' });
  await mutate({ action: 'board_move', id: 'fixture-c', stage: 'doing', position: 0 });
  await mutate({ action: 'board_move', id: 'fixture-c', stage: 'done', position: 0 });
  await refresh(page);
  const literal = '<b>工作项 {0}</b> & user data', enId = 'literal-english';
  await mutate({ action: 'board_create', id: enId, title: literal });
  const english = await makePage('en-US');
  assert.equal(await card(english, enId).locator('h4').textContent(), literal);
  assert.equal(await card(english, enId).locator('h4 b').count(), 0);
  return english;
};
// Independent appearance/CSP assertions, still executed serially before board creation.
module.exports.palette = async ({ assert, page, sendAppearance, rootColor }) => {
    // Host-injected drag chrome styles must still survive CSP; inline scripts remain blocked.
    const chrome = await page.evaluate(() => {
      const host = document.createElement('pi-plugin-panel-chrome');
      const s = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent =
        '.drag{position:fixed;height:46px;-webkit-app-region:drag}.control{-webkit-app-region:no-drag}';
      const d = document.createElement('div');
      d.className = 'drag';
      const b = document.createElement('button');
      b.className = 'control';
      s.append(style, d, b);
      document.documentElement.append(host);
      const r = {
        region: getComputedStyle(d).getPropertyValue('-webkit-app-region'),
        height: getComputedStyle(d).height,
        button: getComputedStyle(b).getPropertyValue('-webkit-app-region')
      };
      host.remove();
      return r;
    });
    assert.deepEqual(chrome, { region: 'drag', height: '46px', button: 'no-drag' });
    assert.match(
      await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'),
      /script-src 'self';/
    );
    // Host palette remains opt-in, only color values are applied.
    await page.locator('#palette-toggle').click();
    await sendAppearance(page, {
      base: 'dark',
      pluginTheme: {
        id: 'fixture',
        base: 'dark',
        css: ':root[data-theme="dark"]{--brand:#82b89a;--ds-accent:var(--brand);--ds-bg-primary:#15251c}:root{--ds-accent:red}body{display:none}'
      }
    });
    assert.equal(await rootColor(page, '--accent'), '#82b89a');
    assert.equal(await rootColor(page, '--bg'), '#15251c');
    assert.equal(await page.locator('#board-search').isVisible(), true);
    await sendAppearance(page, {
      base: 'dark',
      pluginTheme: {
        id: 'important',
        base: 'dark',
        css: ':root[data-theme="dark"]{--ds-accent:green}:root{--ds-accent:red!important}'
      }
    });
    assert.equal(await rootColor(page, '--accent'), 'red');
    const huge =
      ':root{--ds-accent:var(--v0);' +
      Array.from({ length: 7 }, (_, i) => `--v${i}:${`var(--v${i + 1}) `.repeat(30)};`).join('') +
      '--v7:red}';
    await sendAppearance(page, {
      base: 'dark',
      pluginTheme: { id: 'budget', base: 'dark', css: huge }
    });
    assert.equal(await rootColor(page, '--accent'), '');
    await sendAppearance(page, {
      base: 'dark',
      pluginTheme: {
        id: 'invalid',
        base: 'dark',
        css: ':root{--ds-bg-primary:url(https://example.invalid);--loop:var(--loop);--ds-accent:var(--loop);--ds-text-muted:var(--missing,#aabbcc)}'
      }
    });
    assert.equal(await rootColor(page, '--bg'), '');
    assert.equal(await rootColor(page, '--accent'), '');
    assert.equal(await rootColor(page, '--muted'), '#aabbcc');
    await sendAppearance(page, { base: 'light' });
    assert.equal(await rootColor(page, '--muted'), '');
    await page.locator('#palette-toggle').click();
    assert.equal(await page.locator('html').getAttribute('data-palette'), 'pebrel');
};
