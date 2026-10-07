'use strict';
// Optional real-browser / real-core bridge test, NOT an installed-host test.
// NODE_PATH must resolve Playwright; PI_BROWSER points to a Chromium executable.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { Governance } = require('../plugin/runtime/core');
const { panelInvoke } = require('../plugin/runtime/panel');
(async () => {
  const base = process.env.PI_SCRATCH_DIR || os.tmpdir();
  const roots = await Promise.all([1, 2].map(() => fs.mkdtemp(path.join(base, 'board-browser-'))));
  let root = roots[0];
  const g = new Governance(root);
  await g.run({ action: 'init' });
  await g.run({ action: 'start', id: 'overall', goal: 'Browser fixture', criteria: ['Interactions pass'] });
  await new Governance(roots[1]).run({ action: 'init' });
  const stateBefore = await fs.readFile(path.join(root, 'STATE.json'), 'utf8');
  const snapshot = () => g.run({ action: 'project_snapshot' });
  const mutate = async args => g.run({ ...args, expectedRevision: (await snapshot()).revision });
  const browser = await chromium.launch({ headless: true, ...(process.env.PI_BROWSER ? { executablePath: process.env.PI_BROWSER } : {}) });
  const output = path.join(base, 'project-board-screenshots');
  await fs.mkdir(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let holdGit = false, releaseGit, releaseAppearance, holdAppearance = true;
    await page.exposeFunction('hostInvoke', async (channel, payload) => {
      if (channel === 'app.getAppearance') return holdAppearance ? new Promise(resolve => { releaseAppearance = () => { holdAppearance = false; resolve({ base: 'light' }); }; }) : { base: 'light' };
      if (channel === 'app.getLocale') return 'zh-CN';
      if (channel === 'governance.git' && holdGit) await new Promise(resolve => { releaseGit = resolve; });
      try { return { ok: true, result: await panelInvoke(root, channel, payload) }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    await page.addInitScript(() => { window.pluginBridge = { invoke: (...args) => window.hostInvoke(...args), on: (event, handler) => { if (event === 'appearance:changed') window.addEventListener('test-appearance', e => handler(e.detail)); } }; });
    const settled = () => page.waitForFunction(() => !document.querySelector('#refresh').disabled);
    const confirm = async () => { await page.getByRole('button', { name: '确认写入', exact: true }).click(); await settled(); };
    const refresh = async () => { await page.locator('#refresh').click(); await settled(); };
    const card = id => page.locator(`[data-workitem="${id}"]`);
    const views = ['architecture', 'board-section', 'task-section', 'git-section'];
    const navigate = async (target, owner = page) => { await owner.locator(`.workspace-nav a[href="#${target}"]`).click(); await owner.waitForFunction(id => !document.getElementById(id).hidden, target); };
    await page.goto(pathToFileURL(path.resolve('plugin/renderer/index.html')).href); await settled();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.base === 'dark');
    releaseAppearance();
    await page.waitForFunction(() => document.documentElement.dataset.base === 'light');
    await page.emulateMedia({ colorScheme: 'light' });
    // Real host preload injects its 46px native drag band via an inline Shadow DOM style.
    // CSP must permit those styles without permitting inline scripts.
    const chromeStyle = await page.evaluate(() => {
      const host = document.createElement('pi-plugin-panel-chrome');
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = '.drag-region { position: fixed; height: 46px; -webkit-app-region: drag; } .control { -webkit-app-region: no-drag; }';
      const drag = document.createElement('div'); drag.className = 'drag-region';
      const button = document.createElement('button'); button.className = 'control';
      shadow.append(style, drag, button); document.documentElement.append(host);
      const result = { region: getComputedStyle(drag).getPropertyValue('-webkit-app-region'), position: getComputedStyle(drag).position, height: getComputedStyle(drag).height, button: getComputedStyle(button).getPropertyValue('-webkit-app-region') };
      host.remove(); return result;
    });
    assert.deepEqual(chromeStyle, { region: 'drag', position: 'fixed', height: '46px', button: 'no-drag' }, 'Host chrome styles must survive the panel CSP');
    assert.match(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'), /script-src 'self';/);
    assert.match(await page.locator('#graph-empty').textContent(), /尚无项目架构/);
    for (const view of views) {
      await navigate(view);
      for (const other of views) assert.equal(await page.locator(`#${other}`).isVisible(), other === view);
      assert.equal(await page.locator('.workspace-nav a[aria-current="page"]').count(), 1);
    }
    await page.goBack(); await page.waitForFunction(() => !document.getElementById('task-section').hidden);
    await page.goForward(); await page.waitForFunction(() => !document.getElementById('git-section').hidden);
    await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' });
    const sendAppearance = value => page.evaluate(v => window.dispatchEvent(new CustomEvent('test-appearance', { detail: v })), value);
    const rootColor = name => page.locator('html').evaluate((el, key) => el.style.getPropertyValue(key), name);
    assert.equal(await page.locator('html').getAttribute('data-palette'), 'pebrel');
    await page.locator('#palette-toggle').click();
    assert.equal(await page.locator('html').getAttribute('data-palette'), 'host');
    await sendAppearance({ base: 'dark', pluginTheme: { id: 'custom', base: 'dark', css: ':root[data-theme="light"] { --ds-accent: red; } :root[data-theme="dark"] { --brand: #82b89a; --ds-accent: var(--brand); --ds-bg-primary: #15251c; --ds-text-primary: #f2faf5; } body { display: none; }' } });
    assert.equal(await rootColor('--accent'), '#82b89a');
    assert.equal(await rootColor('--bg'), '#15251c');
    assert.equal(await page.locator('#refresh').isVisible(), true, 'Theme selectors must never change layout');
    await sendAppearance({ base: 'dark', pluginTheme: { id: 'cascade', base: 'dark', css: ':root[data-theme="dark"] { --ds-accent: green; --ds-bg-primary: #112233; } :root { --ds-accent: red; --ds-bg-primary: #223344 !important; }' } });
    assert.equal(await rootColor('--accent'), 'green', 'Matching attribute selector wins over later root');
    assert.equal(await rootColor('--bg'), '#223344', 'Important root declaration wins');
    const expandingCss = ':root { --ds-accent: var(--v0); ' + Array.from({ length: 7 }, (_, i) => `--v${i}: ${`var(--v${i + 1}) `.repeat(30)};`).join(' ') + ' --v7: red; }';
    await sendAppearance({ base: 'dark', pluginTheme: { id: 'bounded', base: 'dark', css: expandingCss } });
    assert.equal(await rootColor('--accent'), '', 'Expanding aliases fall back instead of blocking the renderer');
    await sendAppearance({ base: 'dark', pluginTheme: { id: 'unsafe', base: 'dark', css: ':root { --ds-bg-primary: url(https://example.invalid/track); --loop: var(--loop); --ds-accent: var(--loop); --ds-text-muted: var(--missing, #aabbcc); }' } });
    assert.equal(await rootColor('--bg'), '');
    assert.equal(await rootColor('--accent'), '');
    assert.equal(await rootColor('--muted'), '#aabbcc');
    await sendAppearance({ base: 'light', pluginTheme: null });
    assert.equal(await rootColor('--muted'), '', 'Returning to built-in removes contributed colors');
    await page.emulateMedia({ colorScheme: 'dark' });
    await sendAppearance({ base: 'system' });
    assert.equal(await page.locator('html').getAttribute('data-base'), 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.base === 'light');
    await sendAppearance({ base: 'light' });
    assert.equal(await page.locator('.workspace-nav').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference', contrast: 'no-preference' });
    await page.locator('#palette-toggle').click();
    assert.equal(await page.locator('html').getAttribute('data-palette'), 'pebrel');
    assert.equal(await page.evaluate(() => localStorage.getItem('governance-palette')), 'pebrel');
    await navigate('board-section');
    for (const id of ['first', 'second']) {
      await page.locator('#workitem-id').fill(id); await page.locator('#workitem-title').fill(id);
      await page.locator('#workitem-save').click();
      if (id === 'first') {
        await page.getByRole('button', { name: '取消', exact: true }).click(); await settled();
        assert.equal((await snapshot()).board.items.length, 0);
        assert.equal(await page.locator('#workitem-id').inputValue(), id);
        await page.locator('#workitem-save').click();
      }
      await confirm(); assert.equal(await card(id).count(), 1);
    }
    // Dropping on self must not prompt or reorder.
    await card('first').dragTo(card('first'));
    assert.equal(await page.locator('#confirm-dialog').evaluate(el => el.open), false);
    assert.equal((await snapshot()).board.items[0].id, 'first');
    // Switching edit targets must preserve drafts when cancellation is chosen.
    await card('first').getByRole('button', { name: 'first：编辑', exact: true }).click();
    await page.locator('#workitem-title').fill('draft first');
    await page.locator('#palette-toggle').click();
    await page.locator('#palette-toggle').click();
    assert.equal(await page.locator('#workitem-title').inputValue(), 'draft first');
    await sendAppearance({ base: 'dark' });
    assert.equal(await page.locator('#workitem-title').inputValue(), 'draft first', 'Theme changes preserve unsaved user content');
    await sendAppearance({ base: 'light' });
    await card('second').getByRole('button', { name: 'second：编辑', exact: true }).click();
    assert.match(await page.locator('#confirm-description').textContent(), /丢弃当前未保存/);
    await page.getByRole('button', { name: '取消', exact: true }).click(); await settled();
    assert.equal(await page.locator('#workitem-title').inputValue(), 'draft first');
    assert.equal(await page.locator('#workitem-id').inputValue(), 'first');
    // Saving progress must explicitly disclose loss of the other form's draft.
    await navigate('task-section');
    await page.getByRole('button', { name: '保存进度', exact: true }).click();
    assert.match(await page.locator('#confirm-description').textContent(), /丢弃未提交的工作项草稿/);
    await page.getByRole('button', { name: '取消', exact: true }).click(); await settled();
    assert.equal(await page.locator('#workitem-title').inputValue(), 'draft first');
    await navigate('board-section');
    await page.locator('#workitem-cancel').click();
    await navigate('task-section');
    await page.locator('#edit-current').fill('progress draft');
    await navigate('board-section');
    await card('first').getByRole('button', { name: 'first：移至进行中', exact: true }).click();
    assert.match(await page.locator('#confirm-description').textContent(), /丢弃未提交的总体进度草稿/);
    await page.getByRole('button', { name: '取消', exact: true }).click(); await settled();
    assert.equal(await page.locator('#edit-current').inputValue(), 'progress draft');
    await refresh(); await refresh();
    await card('second').getByRole('button', { name: 'second：上移', exact: true }).focus();
    await page.keyboard.press('Enter'); await confirm();
    assert.equal((await snapshot()).board.items[0].id, 'second');
    await card('first').dragTo(page.locator('.board-column[data-stage="doing"]')); await confirm();
    assert.equal((await snapshot()).board.items.find(i => i.id === 'first').stage, 'doing');
    await page.reload(); await settled();
    assert.equal(await page.locator('[data-stage="doing"] [data-workitem="first"]').count(), 1);
    await card('first').getByRole('button', { name: 'first：编辑', exact: true }).click();
    await page.locator('#workitem-blocker').fill('Needs review'); await page.locator('#workitem-save').click(); await confirm();
    await card('first').getByRole('button', { name: 'first：移至完成', exact: true }).click(); await confirm();
    assert.match(await page.locator('#notice').textContent(), /blocker/);
    assert.equal((await snapshot()).board.items.find(i => i.id === 'first').stage, 'doing');
    await card('first').getByRole('button', { name: 'first：编辑', exact: true }).click();
    await page.locator('#workitem-blocker').fill(''); await page.locator('#workitem-save').click(); await confirm();
    await card('first').getByRole('button', { name: 'first：移至完成', exact: true }).click(); await confirm();
    assert.equal((await snapshot()).board.items.find(i => i.id === 'first').stage, 'done');
    assert.equal(await fs.readFile(path.join(root, 'STATE.json'), 'utf8'), stateBefore);
    // Unsaved refresh requires two clicks, and clears edit mode as well as fields.
    await card('second').getByRole('button', { name: 'second：编辑', exact: true }).click();
    await page.locator('#workitem-title').fill('unsaved'); await refresh();
    assert.equal(await page.locator('#workitem-title').inputValue(), 'unsaved'); await refresh();
    assert.equal(await page.locator('#workitem-title').inputValue(), '');
    assert.equal(await page.locator('#workitem-id').evaluate(el => el.readOnly), false);
    // Stale write must retain persisted placement.
    await mutate({ action: 'board_update', id: 'second', title: 'External' });
    await card('second').getByRole('button', { name: 'second：移至进行中', exact: true }).click(); await confirm();
    assert.match(await page.locator('#notice').textContent(), /stale/);
    assert.equal((await snapshot()).board.items.find(i => i.id === 'second').stage, 'todo'); await refresh();
    // Inspected fixture sources provide a genuine graph via the backend API.
    await fs.writeFile(path.join(root, 'app.ts'), "import { value } from './store';\nconsole.log(value);\n");
    await fs.writeFile(path.join(root, 'store.ts'), 'export const value = 1;\n');
    const sources = await g.run({ action: 'architecture_sources', files: ['app.ts', 'store.ts'] });
    await mutate({ action: 'architecture_set', graph: { title: 'Fixture architecture', source: 'Inspected app.ts import and store.ts export; fixture only', nodes: [{ id: 'app', title: 'Application', description: 'Imports store value', files: ['app.ts'] }, { id: 'store', title: 'Store', description: 'Exports value', files: ['store.ts'] }], edges: [{ from: 'app', to: 'store', label: 'imports' }], fingerprints: sources.fingerprints } });
    await refresh(); assert.equal(await page.locator('.architecture-node').count(), 2);
    await navigate('architecture');
    assert.equal(await page.locator('.architecture-node code').count(), 0);
    assert.equal(await page.locator('#graph-source').isVisible(), false);
    await page.locator('.graph-provenance > summary').first().focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#graph-source').isVisible(), true);
    await page.keyboard.press('Enter');
    const positions = await page.locator('.architecture-node').evaluateAll(nodes => nodes.map(n => parseFloat(n.style.top)));
    assert.ok(positions[0] < positions[1]);
    await page.locator('[data-module="app"]').click(); await page.locator('[data-trace="downstream"]').click();
    assert.match(await page.locator('#graph-summary').textContent(), /1 个节点/);
    await page.locator('#module-relations button').click(); assert.equal(await page.locator('#module-title').textContent(), 'Store');
    assert.equal(await page.locator('#module-path').isVisible(), false);
    await page.locator('.module-detail summary').click();
    assert.match(await page.locator('#module-path').innerText(), /store.ts/);
    const transform = () => page.locator('#graph-stage').evaluate(el => el.style.transform);
    const original = await transform(); await page.locator('#graph-in').click(); assert.notEqual(await transform(), original);
    await page.locator('#graph-viewport').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('0');
    await page.locator('[data-trace="all"]').click();
    // A pending Git overview must not postpone independent project content.
    holdGit = true;
    try {
      await page.locator('#refresh').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-workitem]').length === 2 && document.querySelectorAll('.architecture-node').length === 2, null, { timeout: 2000 });
      assert.equal(await page.locator('#refresh').isDisabled(), true, 'Keep writes locked until the whole refresh settles');
      assert.equal(await page.locator('#workitem-save').isDisabled(), true);
      assert.equal(await page.locator('[data-workitem] button:enabled').count(), 0, 'New card controls must remain locked');
      await page.waitForFunction(() => document.querySelector('#git-summary').textContent.includes('正在读取'));
    } finally { holdGit = false; releaseGit?.(); }
    await settled();
    for (const width of [390, 768, 1280]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(theme => { document.documentElement.dataset.base = theme; }, theme);
      for (const view of views) {
        await navigate(view);
        await page.waitForTimeout(80);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow ${view}/${width}/${theme}`);
        await page.screenshot({ path: path.join(output, `${view}-${width}-${theme}.png`), fullPage: true });
      }
    }
    await navigate('architecture');
    await fs.appendFile(path.join(root, 'app.ts'), '// changed\n'); await refresh();
    assert.match(await page.locator('#graph-source').textContent(), /源码已变化：app.ts/);
    assert.equal(await page.locator('#graph-warning').isVisible(), true);
    assert.match(await page.locator('#graph-warning').innerText(), /app.ts/);
    await page.locator('#show-workflow').click(); assert.equal(await page.locator('.architecture-node').count(), 4);
    assert.equal(await page.locator('[data-module="working"]').getAttribute('aria-pressed'), 'true');
    await g.run({ action: 'progress', current: 'Blocked', next: [], blocked: ['Need approval'] }); await refresh();
    assert.match(await page.locator('#module-description').textContent(), /Need approval/);
    // Changing actual bridge workspace after reading must not apply old confirmation.
    root = roots[1];
    await navigate('board-section');
    await card('second').getByRole('button', { name: 'External：移至进行中', exact: true }).click(); await confirm();
    assert.match(await page.locator('#notice').textContent(), /stale|switched/);
    assert.equal((await new Governance(root).run({ action: 'project_snapshot' })).board.items.length, 0);
    await refresh(); await navigate('architecture'); await page.locator('#show-architecture').click();
    assert.equal(await page.locator('.architecture-node').count(), 0); assert.equal(await page.locator('[data-workitem]').count(), 0);
    await fs.mkdir(path.join(root, '.governance'), { recursive: true });
    await fs.writeFile(path.join(root, '.governance/architecture.json'), '{bad'); await refresh();
    assert.match(await page.locator('#graph-empty').textContent(), /架构读取失败/);
    assert.deepEqual(errors, []);
    // English host locale wins over the browser locale; user-owned text stays verbatim.
    root = roots[0];
    const english = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 1000 } });
    english.on('pageerror', e => errors.push(e.message));
    await english.exposeFunction('hostInvoke', async (channel, payload) => {
      if (channel === 'app.getLocale') return 'en-US';
      if (channel === 'app.getAppearance') return { base: 'light' };
      try { return { ok: true, result: await panelInvoke(root, channel, payload) }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    await english.addInitScript(() => { window.pluginBridge = { invoke: (...args) => window.hostInvoke(...args), on: () => {} }; });
    await english.goto(pathToFileURL(path.resolve('plugin/renderer/index.html')).href);
    await english.waitForFunction(() => !document.querySelector('#refresh').disabled);
    assert.equal(await english.locator('html').getAttribute('lang'), 'en');
    assert.equal(await english.locator('#show-workflow').textContent(), 'Task workflow');
    await navigate('board-section', english);
    await english.locator('#workitem-id').fill('english');
    const originalText = '<b>工作项 {0}</b> & user data';
    await english.locator('#workitem-title').fill(originalText);
    await english.locator('#workitem-save').click();
    assert.match(await english.locator('#confirm-description').textContent(), /does not verify or close/);
    await english.getByRole('button', { name: 'Cancel', exact: true }).click();
    await english.waitForFunction(() => !document.querySelector('#refresh').disabled);
    assert.equal(await english.locator('#workitem-title').inputValue(), originalText);
    await english.locator('#workitem-save').click();
    await english.getByRole('button', { name: 'Confirm write', exact: true }).click();
    await english.waitForFunction(() => !document.querySelector('#refresh').disabled);
    assert.equal(await english.locator('[data-workitem="english"] h4').textContent(), originalText);
    assert.equal(await english.locator('[data-workitem="english"] h4 b').count(), 0);
    assert.equal((await snapshot()).board.items.find(item => item.id === 'english').title, originalText);
    for (const width of [390, 768, 1280]) for (const theme of ['light', 'dark']) {
      await english.setViewportSize({ width, height: 1000 });
      await english.evaluate(theme => { document.documentElement.dataset.base = theme; }, theme);
      for (const view of views) {
        await navigate(view, english);
        assert.ok(await english.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `English overflow ${view}/${width}/${theme}`);
        await english.screenshot({ path: path.join(output, `en-${view}-${width}-${theme}.png`), fullPage: true });
      }
    }
    await english.close(); assert.deepEqual(errors, []);
    console.log(`PASS four views, draft/history navigation, host chrome and safety guards; 48 screenshots: ${output}`);
  } finally {
    await browser.close();
    await Promise.all(roots.map(root => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
