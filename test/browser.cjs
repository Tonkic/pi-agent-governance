'use strict';
// Real Chromium + temporary governance projects and simulated host events, not installed-host acceptance.
const { chromium } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Governance } = require('../plugin/runtime/core');
const { panelInvoke } = require('../plugin/runtime/panel');
const { itemFingerprint } = require('../plugin/runtime/project');
const { architectureAscii } = require('../plugin/runtime/design');
const behaviorReport = require('./behavior-reporter.cjs').reporter();
(async () => {
  const base = process.env.PI_SCRATCH_DIR || os.tmpdir();
  const roots = await Promise.all([1, 2, 3, 4].map(async () => require('node:fs').realpathSync.native(await fs.mkdtemp(path.join(base, 'readonly-browser-')))));
  let root = roots[0], hold = null, release = null, failProject = false, failSnapshot = false;
  const calls = [], boardWrites = [];
  for (const dir of roots.slice(0, 2)) await new Governance(dir).run({ action: 'init' });
  const g = new Governance(root);
  await g.run({ action: 'start', id: 'overall', goal: 'Readonly workbench fixture', criteria: ['Read isolation', 'No browser writes'] });
  const snapshot = () => g.run({ action: 'project_snapshot' });
  const mutate = async args => g.run({ ...args, expectedRevision: (await snapshot()).revision });
  const stateBefore = await fs.readFile(path.join(root, 'STATE.json'), 'utf8');
  const browser = await chromium.launch({ headless: true, ...(process.env.PI_BROWSER ? { executablePath: process.env.PI_BROWSER } : {}) });
  const output = process.env.PI_SCREENSHOT_DIR || path.join(base, 'readonly-workbench-shots');
  await fs.mkdir(output, { recursive: true });
  const errors = []; let shots = 0;
  const url = pathToFileURL(path.resolve('plugin/renderer/index.html')).href;
  const settled = p => p.waitForFunction(() => !document.querySelector('#refresh').disabled);
  const refresh = async p => { await p.locator('#refresh').click(); await settled(p); };
  const navigate = async (p, id) => { await p.locator(`.workspace-nav a[href="#${id}"]`).click(); await p.waitForFunction(id => !document.getElementById(id).hidden, id); };
  const card = (p, id) => p.locator(`[data-workitem="${id}"]`);
  const close = async p => { await p.locator('#item-close').click(); await p.waitForFunction(() => !document.querySelector('#item-sheet').open); };
  const capture = async (p, name) => { await p.screenshot({ path: path.join(output, `state-${name}.png`), fullPage: true }); shots++; };
  const sendAppearance = (p, value) => p.evaluate(value => window.dispatchEvent(new CustomEvent('test-appearance', { detail: value })), value);
  const rootColor = (p, name) => p.locator('html').evaluate((el, key) => el.style.getPropertyValue(key), name);
  async function makePage(locale = 'zh-CN') {
    const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    p.on('pageerror', e => errors.push(e.message));
    await p.exposeFunction('hostInvoke', async (channel, payload) => {
      const requestRoot = root;
      calls.push({ channel, payload, root: requestRoot });
      if (channel === 'app.getLocale') return locale;
      if (channel === 'app.getAppearance') return { base: 'light' };
      if (channel === 'governance.workitem') boardWrites.push(payload);
      try {
        if ((failProject && channel === 'governance.project') || (failSnapshot && channel === 'governance.snapshot')) throw Error('Fixture read failure');
        const result = await panelInvoke(requestRoot, channel, payload);
        if (hold?.root === requestRoot && hold.channel === channel) await new Promise(resolve => { release = resolve; });
        return { ok: true, result };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    await p.addInitScript(() => {
      window.pluginBridge = { invoke: (...args) => window.hostInvoke(...args), on: (event, fn) => {
        if (event === 'appearance:changed') window.addEventListener('test-appearance', e => fn(e.detail));
        if (event === 'workspace:changed') window.addEventListener('test-workspace', e => fn(e.detail));
      } };
    });
    await p.goto(url); await settled(p); return p;
  }
  async function waitHeld(p) {
    for (let i = 0; !release && i < 500; i++) await p.waitForTimeout(10);
    assert.equal(typeof release, 'function', 'Delayed read reached bridge');
  }
  try {
    const page = await makePage();
    const switchWorkspace = async target => { root = target; await page.evaluate(path => window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } })), root); await settled(page); };
    await switchWorkspace(roots[1]); assert.equal(await page.locator('#workspace').textContent(), roots[1]);
    await switchWorkspace(roots[0]); assert.equal(await page.locator('#summary-task').textContent(), 'overall');
    behaviorReport.passed('workspace-switch');
    await switchWorkspace(roots[2]);
    assert.equal(await page.locator('#status').textContent(), '未初始化');
    assert.equal(await page.locator('#initialize-workspace, #project-open, form').count(), 0);
    assert.deepEqual(await fs.readdir(roots[2]), []);
    await capture(page, 'uninitialized-readonly'); await switchWorkspace(roots[0]);
    behaviorReport.passed('readonly-uninitialized');
    hold = { root: roots[0], channel: 'governance.snapshot' }; release = null;
    await page.locator('#refresh').click(); await waitHeld(page); await switchWorkspace(roots[1]);
    hold = null; release(); await page.waitForTimeout(60);
    assert.equal(await page.locator('#workspace').textContent(), roots[1]);
    assert.equal(await page.locator('#summary-task').textContent(), await page.evaluate(() => t('noTask')));
    await switchWorkspace(roots[0]); behaviorReport.passed('delayed-snapshot');
    assert.equal(await page.locator('.workspace-nav a').count(), 4);
    assert.deepEqual(await page.locator('.board-column').evaluateAll(rows => rows.map(el => el.dataset.stage)), ['todo', 'doing', 'done']);
    assert.equal(await page.locator('#project-tools, #project-dialog, #board-new, #item-menu, #workitem-form, #workspace-drafts, #launch-dialog, #operations-dialog, #behaviors-section').count(), 0);
    const first = 'first', second = 'second';
    await mutate({ action: 'board_create', id: first, title: 'Review workspace navigation', description: 'Check search, object details and keyboard return.', criteria: ['Keyboard return verified'], architectureImpact: 'affects' });
    await mutate({ action: 'board_create', id: second, title: 'Polish architecture canvas', architectureImpact: 'none' });
    await refresh(page);
    const boardRaw = await fs.readFile(path.join(root, '.governance/board.json'), 'utf8');
    const countBefore = calls.length;
    await card(page, first).click({ button: 'right' }); await card(page, first).focus(); await page.keyboard.press('Shift+F10');
    await card(page, first).dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, clientX: 200, clientY: 200 });
    await page.waitForTimeout(550); await card(page, first).dispatchEvent('pointerup', { pointerType: 'touch' });
    await card(page, first).dragTo(page.locator('[data-stage="doing"]'));
    assert.equal(await card(page, first).getAttribute('draggable'), 'false');
    assert.equal(await page.locator('#item-menu, #confirm-dialog').count(), 0);
    assert.equal(calls.length, countBefore, 'Context/keyboard/touch/drag cannot invoke project actions');
    assert.equal(await fs.readFile(path.join(root, '.governance/board.json'), 'utf8'), boardRaw);
    const denied = await page.evaluate(async () => {
      const results = [];
      for (const [channel, payload] of [['governance.mutate', { args: { action: 'init' }, confirmed: true }], ['governance.workitem', { args: { action: 'create' }, confirmed: true }], ['governance.design', { action: 'confirm', confirmed: true }], ['governance.operation', { action: 'launch' }], ['models.list', {}]]) {
        try { await invoke(channel, payload); results.push(false); } catch { results.push(true); }
      }
      return results;
    });
    assert.deepEqual(denied, [true, true, true, true, true]); assert.equal(calls.length, countBefore);
    behaviorReport.passed('readonly-write-denial');
    for (const [width, columns] of [[1280, 3], [1000, 2], [680, 2], [600, 1]]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.locator('#board-columns').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), columns);
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    const geometry = () => page.locator('.board-column').evaluateAll(rows => rows.map(el => { const r = el.getBoundingClientRect(); return [Math.round(r.x + scrollX), Math.round(r.y + scrollY), Math.round(r.width)]; }));
    const beforeDetails = await geometry();
    await card(page, first).click(); assert.deepEqual(await geometry(), beforeDetails);
    assert.equal(await page.locator('#item-sheet').evaluate(el => el.matches(':modal')), true);
    await page.locator('#item-close').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.locator('#item-sheet').evaluate(el => el.contains(document.activeElement)), true);
    assert.equal(await page.locator('#item-sheet input, #item-sheet textarea, #item-edit').count(), 0);
    await page.locator('#item-next').click(); assert.equal(await page.locator('#item-record-id').textContent(), second);
    await page.locator('#item-previous').click(); await page.keyboard.press('Escape');
    assert.equal(await card(page, first).evaluate(el => el === document.activeElement), true); assert.deepEqual(await geometry(), beforeDetails);
    await card(page, first).click(); await switchWorkspace(roots[1]);
    assert.equal(await page.locator('#item-sheet').evaluate(el => el.open), false);
    assert.equal(await page.locator('#workitem-form, #workspace-drafts').count(), 0);
    await switchWorkspace(roots[0]); behaviorReport.passed('readonly-detail-isolation');
    hold = { root: roots[0], channel: 'governance.project' }; release = null;
    await page.locator('#refresh').click(); await waitHeld(page); await switchWorkspace(roots[1]);
    await page.locator('#board-search').focus(); const noticeBefore = await page.locator('#notice').textContent();
    hold = null; release(); await page.waitForTimeout(80);
    assert.equal(await page.locator('#notice').textContent(), noticeBefore);
    assert.equal(await page.locator('#board-search').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('[data-workitem]').count(), 0);
    await switchWorkspace(roots[0]); behaviorReport.passed('delayed-project-read');
    await mutate({ action: 'board_update', id: second, title: 'External architecture canvas' }); await refresh(page);
    assert.equal(await card(page, second).locator('h4').textContent(), 'External architecture canvas');
    behaviorReport.passed('external-update-reading');
    await page.keyboard.press('/'); assert.equal(await page.locator('#board-search').evaluate(el => el === document.activeElement), true);
    await page.locator('#board-search').fill('canvas'); assert.equal(await page.locator('[data-workitem]').count(), 1);
    await page.locator('#board-search').fill('no-such-object'); assert.equal(await page.locator('#board-empty').isVisible(), true); await capture(page, 'no-results');
    await page.locator('#search-clear').click();
    await page.context().setOffline(true); await page.waitForFunction(() => document.querySelector('#refresh').disabled);
    await card(page, first).click(); await close(page); await capture(page, 'offline');
    const offlineCalls = calls.length; await page.context().setOffline(false); await page.waitForTimeout(80); assert.equal(calls.length, offlineCalls, 'No automatic replay');
    await refresh(page);
    for (const key of ['project', 'snapshot']) {
      if (key === 'project') failProject = true; else failSnapshot = true;
      await refresh(page); assert.match(await page.locator('#notice.error').textContent(), /Fixture read failure/);
      failProject = failSnapshot = false; await refresh(page);
    }
    await require('./history-themes-browser.cjs').palette({ assert, page, sendAppearance, rootColor });
    await fs.writeFile(path.join(root, 'app.ts'), "import { value } from './store';\n"); await fs.writeFile(path.join(root, 'store.ts'), 'export const value = 1;\n');
    const sources = await g.run({ action: 'architecture_sources', files: ['app.ts', 'store.ts'] });
    await mutate({ action: 'architecture_set', graph: { title: 'Workspace dependencies', source: 'Inspected fixture imports', nodes: [{ id: 'app', title: 'Application', description: 'Imports store', files: ['app.ts'] }, { id: 'store', title: 'Store', description: 'Exports value', files: ['store.ts'] }], edges: [{ from: 'app', to: 'store', label: 'imports' }], fingerprints: sources.fingerprints } });
    await refresh(page); await navigate(page, 'architecture'); assert.equal(await page.locator('.architecture-node').count(), 2);
    await page.locator('[data-module="app"]').click(); await page.locator('#module-relations button').click(); assert.equal(await page.locator('#module-title').textContent(), 'Store');
    await page.locator('#graph-viewport').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('0');
    await page.locator('#show-workflow').click(); assert.equal(await page.locator('.architecture-node').count(), 4); assert.equal(await page.locator('#graph-check-state').textContent(), '');
    await page.locator('#module-jump').click(); await page.waitForFunction(() => !document.querySelector('#board-section').hidden);
    await navigate(page, 'architecture'); await page.locator('#show-architecture').click(); await fs.appendFile(path.join(root, 'app.ts'), '// change\n'); await refresh(page);
    assert.equal(await page.locator('#graph-warning').isVisible(), false); await page.locator('#architecture-check').click(); await settled(page); assert.equal(await page.locator('#graph-warning').isVisible(), true);
    const checked = await page.locator('#graph-check-state').textContent(); await page.locator('#show-workflow').click(); assert.equal(await page.locator('#graph-check-state').textContent(), ''); await page.locator('#show-architecture').click(); assert.equal(await page.locator('#graph-check-state').textContent(), checked);
    await navigate(page, 'board-section');
    await require('./legacy-history-browser.cjs')({ page, first, snapshot, card, close, capture, mutate, root, g, itemFingerprint, randomUUID, refresh });
    const english = await require('./history-themes-browser.cjs').seedWorkbench({ mutate, refresh, page, makePage, assert, card });
    shots += await require('./history-themes-browser.cjs').workbench({ assert, page, english, refresh, navigate, card, first, close, path, output, browser, url, sendAppearance });
    const designSnapshot = () => g.run({ action: 'architecture_design_snapshot' });
    const begin = async reason => g.run({ action: 'architecture_design_begin', reason, expectedRevision: (await designSnapshot()).revision });
    const save = async proposal => { const s = await designSnapshot(); await g.run({ action: 'architecture_design_save', proposal, expectedDraft: s.draft.draftId, expectedRevision: s.revision }); };
    await begin('Explicit host fixture draft');
    const proposal = { title: '本地项目治理设计', document: 'Intent only <img src=x onerror="window.designInjected=true">', nodes: [{ id: 'intent', title: '项目意图', description: 'Approved scope', files: [] }, { id: 'canvas', title: '可视化画板', description: 'Readonly design', files: [] }], edges: [{ from: 'canvas', to: 'intent', label: 'stale JSON' }] };
    proposal.document += '\n\n<!-- governance:architecture-ascii:start -->\n```text\n' + architectureAscii({ ...proposal, edges: [{ from: 'intent', to: 'canvas', label: '展示职责' }] }) + '\n```\n<!-- governance:architecture-ascii:end -->';
    await save(proposal); await refresh(page); await navigate(page, 'architecture'); await page.locator('#show-design').click();
    assert.equal((await designSnapshot()).baseline, null); assert.equal(await page.locator('#design-review, #design-begin, #design-confirm-dialog').count(), 0);
    assert.match(await page.locator('#design-document').textContent(), /<img/); assert.equal(await page.locator('#design-document img').count(), 0); assert.equal(await page.evaluate(() => window.designInjected), undefined);
    behaviorReport.passed('design-readonly-draft');
    assert.deepEqual(await page.locator('.graph-edge').evaluateAll(rows => rows.map(el => [el.dataset.from, el.dataset.to, el.querySelector('text').textContent])), [['intent', 'canvas', '展示职责']]);
    assert.equal(await page.locator('.graph-edge path').getAttribute('marker-end'), 'url(#edge-arrow)');
    const savedAscii = (await designSnapshot()).draft.ascii;
    await page.locator('#design-ascii-section > summary').click(); assert.equal(await page.locator('#design-ascii').textContent(), savedAscii);
    assert.equal(await page.locator('#design-ascii').evaluate(el => getComputedStyle(el).whiteSpace), 'pre');
    await page.locator('#show-workflow').click(); assert.equal(await page.locator('#design-ascii-section').isVisible(), false); await page.locator('#show-design').click(); assert.equal(await page.locator('#design-ascii').textContent(), savedAscii);
    // Seed historical confirmation through the original low-level seam, never through browser/Agent APIs.
    const s = await designSnapshot(); await panelInvoke(roots[0], 'governance.design', { action: 'confirm', revision: s.revision, expectedProposal: s.draft.proposalFingerprint, reviewer: 'Historical fixture', conclusion: 'Fixture only; not user review', confirmed: true });
    const baseline = (await designSnapshot()).baseline;
    await begin('Explicit host revision'); await save({ title: 'Revision fixture', document: 'Revision intent only', nodes: [...proposal.nodes, { id: 'evidence', title: '证据', description: 'Actual results only', files: [] }], edges: [{ from: 'canvas', to: 'evidence', label: 'shows' }] });
    await refresh(page); assert.equal(await page.locator('#design-version').inputValue(), 'baseline'); assert.equal(await page.locator('.architecture-node').count(), 2);
    await page.locator('#design-version').selectOption('draft'); assert.equal(await page.locator('.architecture-node').count(), 3); assert.match(await page.locator('#design-diff').textContent(), /evidence/);
    const designRaw = await fs.readFile(path.join(root, '.governance/architecture-design.json'), 'utf8');
    await mutate({ action: 'board_update', id: second, title: 'Ordinary external update' }); await refresh(page);
    assert.equal(await fs.readFile(path.join(root, '.governance/architecture-design.json'), 'utf8'), designRaw); assert.deepEqual((await designSnapshot()).baseline, baseline);
    behaviorReport.passed('design-stable-reading');
    for (const width of [390, 768, 1280]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 1000 }); await sendAppearance(page, { base: theme }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await capture(page, `design-${width}-${theme}`);
    }
    behaviorReport.passed('design-ascii-view');
    await page.setViewportSize({ width: 1280, height: 1000 }); hold = { root: roots[0], channel: 'governance.design' }; release = null;
    await page.locator('#refresh').click(); await waitHeld(page); await switchWorkspace(roots[1]); hold = null; release(); await page.waitForTimeout(80);
    assert.equal(await page.locator('.architecture-node').count(), 0); assert.equal(await page.locator('#design-ascii-section').isVisible(), false); assert.equal((await page.locator('#design-ascii').textContent()).includes('[canvas]'), false);
    assert.deepEqual((await designSnapshot()).baseline, baseline); await switchWorkspace(roots[0]); behaviorReport.passed('design-workspace-isolation');
    root = roots[3];
    const historyPage = await require('./history-workflow-browser.cjs')({ root, Governance, fs, path, itemFingerprint, boardWrites, makePage, settled, assert, card, sendAppearance, capture });
    root = roots[1]; await historyPage.evaluate(path => window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } })), root); await settled(historyPage);
    assert.equal(await historyPage.locator('#completed-history-dialog').evaluate(el => el.open), false); assert.equal(await historyPage.locator('#completed-history-search').inputValue(), ''); assert.equal(await historyPage.locator('#completed-history-body tr').count(), 0);
    root = roots[3]; await historyPage.evaluate(path => window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } })), root); await settled(historyPage);
    hold = { root: roots[3], channel: 'governance.snapshot' }; release = null; await historyPage.locator('#refresh').click(); await waitHeld(historyPage);
    root = roots[1]; await historyPage.evaluate(path => window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } })), root); await settled(historyPage); hold = null; release(); await historyPage.waitForTimeout(80);
    await historyPage.locator('#completed-history-open').click(); assert.equal((await historyPage.locator('#completed-history-body').textContent()).includes('Completed fixture'), false);
    assert.equal(boardWrites.length, 0); assert.equal(calls.some(c => /governance\.(?:mutate|workitem|operation|behaviors)|models\.|sessions\./.test(c.channel)), false);
    assert.equal(await fs.readFile(path.join(roots[0], 'STATE.json'), 'utf8'), stateBefore);
    assert.deepEqual(errors, []); behaviorReport.finish(true);
    console.log(`PASS readonly workbench: write denial, four pages, external updates, modal/search/history, offline/errors, source graph, ASCII/draft/baseline reading, workspace late-response guards, palette/CSP/themes; ${shots} screenshots: ${output}`);
  } finally { await browser.close(); await Promise.all(roots.map(dir => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))); }
})().catch(error => { behaviorReport.finish(false); console.error(error); process.exitCode = 1; });
