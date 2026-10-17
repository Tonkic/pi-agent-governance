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
    if (await p.locator('#project-dialog').evaluate(el => el.open)) await p.locator('#project-close').click();
    for (const width of [390, 768, 1280]) for (const theme of ['light', 'dark']) {
      await p.setViewportSize({ width, height: 1000 });
      await p.evaluate(theme => { document.documentElement.dataset.base = theme; }, theme);
      for (const view of ['board-section', 'architecture', 'git-section']) {
        await navigate(p, view); await p.waitForTimeout(80);
        assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${lang}/${view}/${width}/${theme}`);
        await p.screenshot({ path: path.join(output, `${lang}-${view}-${width}-${theme}.png`), fullPage: true }); shots++;
      }
      await navigate(p, 'architecture'); await p.locator('#architecture-analyze').click(); await chooseNew(p);
      await p.waitForFunction(() => !document.querySelector('#launch-model').disabled);
      await p.locator('#launch-model').selectOption('fixture/reasoning'); await p.locator('#launch-thinking').selectOption('high');
      assert.ok(await p.locator('#launch-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), 'Launch settings must not overflow');
      const launchShot = await p.screenshot({ path: path.join(output, `${lang}-launch-${width}-${theme}.png`), fullPage: false });
      assert.equal(launchShot.readUInt32BE(20), 1000, 'Launch evidence uses the viewport height'); shots++;
      await p.locator('#launch-cancel').click(); await navigate(p, 'board-section');
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
  await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' }); await card(page, first).click({ button: 'right' });
  assert.equal(await page.locator('#item-menu').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await page.locator('#item-menu').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
  await page.keyboard.press('Escape');
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
  const english = await makePage('en-US'); await english.locator('#board-new').click();
  const enId = await english.locator('#workitem-id').inputValue();
  const literal = '<b>工作项 {0}</b> & user data';
  await english.locator('#workitem-title').fill(literal); await english.locator('#workitem-save').click(); await confirm(english, false);
  assert.equal(await english.locator('#workitem-title').inputValue(), literal);
  await english.locator('#workitem-save').click(); await confirm(english);
  assert.equal(await card(english, enId).locator('h4 b').count(), 0);
  return english;
};
