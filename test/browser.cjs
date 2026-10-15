'use strict';
// Real Chromium + real governance backend, simulated plugin bridge. Not installed-host acceptance.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { Governance } = require('../plugin/runtime/core');
const { panelInvoke } = require('../plugin/runtime/panel');
const { operationInvoke } = require('../plugin/runtime/operations');
const { itemFingerprint } = require('../plugin/runtime/project');
const { randomUUID } = require('node:crypto');
const behaviorReport = require('./behavior-reporter.cjs').reporter();
const hostCalls = [];
const operationWrites = [];
let hostStreaming = true,
  sessionCounter = 0,
  failCreation = false;
const desktop = {
  listOperations: async () =>
    [
      'session/create',
      'agent/prompt',
      'agent/getStatus',
      'session/get',
      'session/open',
      'agent/abort'
    ].map((id) => ({ id })),
  invoke: async (request) => {
    hostCalls.push(request);
    if (request.operation === 'session/create')
      return failCreation ? {} : { id: `fixture-session-${++sessionCounter}` };
    if (request.operation === 'agent/getStatus') return { isStreaming: hostStreaming };
    if (request.operation === 'session/get')
      return {
        session: { id: request.args[0].id },
        messages: [
          { role: 'assistant', content: 'Fixture analysis output; not installed-host acceptance.' }
        ]
      };
    return { accepted: true };
  }
};
let modelListFailure = false,
  modelMissing = false,
  holdModels = false,
  releaseModels;
const modelRows = [
  {
    key: 'fixture/reasoning',
    providerId: 'fixture',
    providerName: 'Fixture Provider',
    modelId: 'reasoning',
    label: 'Reasoning fixture',
    supportsReasoning: true,
    thinkingLevels: ['low', 'high']
  },
  {
    key: 'fixture/plain',
    providerId: 'fixture',
    providerName: 'Fixture Provider',
    modelId: 'plain',
    label: 'Plain fixture',
    supportsReasoning: false,
    thinkingLevels: []
  }
];
const models = {
  list: async () => {
    if (holdModels)
      await new Promise((resolve) => {
        releaseModels = resolve;
      });
    if (modelListFailure) throw Error('Model list fixture unavailable');
    return modelMissing ? [] : modelRows;
  }
};
(async () => {
  const base = process.env.PI_SCRATCH_DIR || os.tmpdir();
  const roots = await Promise.all(
    [1, 2, 3, 4].map(() => fs.mkdtemp(path.join(base, 'workbench-browser-')))
  );
  let root = roots[0],
    holdGit = false,
    releaseGit,
    failProject = false,
    failSnapshot = false;
  let delayedSnapshotRoot = null, releaseSnapshot;
  let delayedGitRoot = null, releaseDelayedGit;
  let delayedBehaviorRoot = null, releaseBehavior;
  let delayedDesignRoot = null, releaseDesign;
  const boardWrites = [];
  const g = new Governance(root);
  for (const dir of roots.slice(0, 2)) await new Governance(dir).run({ action: 'init' });
  await g.run({
    action: 'start',
    id: 'overall',
    goal: 'Publish the next workspace release',
    criteria: ['UI checks pass', 'Sources stay traceable']
  });
  const stateBefore = await fs.readFile(path.join(root, 'STATE.json'), 'utf8');
  const snapshot = () => g.run({ action: 'project_snapshot' });
  const mutate = async (args) => g.run({ ...args, expectedRevision: (await snapshot()).revision });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PI_BROWSER ? { executablePath: process.env.PI_BROWSER } : {})
  });
  const output = path.join(base, 'modal-board-screenshots');
  await fs.mkdir(output, { recursive: true });
  const errors = [];
  let shots = 0;
  const url = pathToFileURL(path.resolve('plugin/renderer/index.html')).href;
  async function makePage(locale = 'zh-CN') {
    const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    p.on('pageerror', (e) => errors.push(e.message));
    await p.exposeFunction('hostInvoke', async (channel, payload) => {
      const requestRoot = root;
      if (channel === 'governance.workitem') boardWrites.push(payload);
      if (channel === 'governance.operation' && ['cancel', 'resolve'].includes(payload.action))
        operationWrites.push(payload);
      if (channel === 'app.getLocale') return locale;
      if (channel === 'app.getAppearance') return { base: 'light' };
      if (channel === 'governance.behaviors' && requestRoot === delayedBehaviorRoot) {
        const result = await panelInvoke(requestRoot, channel, payload);
        await new Promise(resolve => { releaseBehavior = resolve; });
        return { ok: true, result };
      }
      if (channel === 'governance.design' && payload.action === 'snapshot' && requestRoot === delayedDesignRoot) {
        const result = await panelInvoke(requestRoot, channel, payload);
        await new Promise(resolve => { releaseDesign = resolve; });
        return { ok: true, result };
      }
      if (channel === 'governance.snapshot' && requestRoot === delayedSnapshotRoot) {
        const result = await panelInvoke(requestRoot, channel, payload);
        await new Promise(resolve => { releaseSnapshot = resolve; });
        return { ok: true, result };
      }
      if (channel === 'governance.git' && requestRoot === delayedGitRoot) {
        let response;
        try { response = { ok: true, result: await panelInvoke(requestRoot, channel, payload) }; }
        catch (error) { response = { ok: false, error: error.message }; }
        await new Promise(resolve => { releaseDelayedGit = resolve; });
        return response;
      }
      if (channel === 'governance.git' && holdGit)
        await new Promise((resolve) => {
          releaseGit = resolve;
        });
      if (
        (failProject && channel === 'governance.project') ||
        (failSnapshot && channel === 'governance.snapshot')
      )
        return { ok: false, error: 'Fixture read failure' };
      try {
        return {
          ok: true,
          result:
            channel === 'governance.operation'
              ? await operationInvoke(requestRoot, payload, desktop, async () => root === requestRoot, models)
              : await panelInvoke(requestRoot, channel, payload)
        };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    await p.addInitScript(() => {
      window.pluginBridge = {
        invoke: (...args) => window.hostInvoke(...args),
        on: (event, fn) => {
          if (event === 'appearance:changed')
            window.addEventListener('test-appearance', (e) => fn(e.detail));
          if (event === 'workspace:changed')
            window.addEventListener('test-workspace', (e) => fn(e.detail));
        }
      };
    });
    await p.goto(url);
    await settled(p);
    return p;
  }
  const settled = (p) => p.waitForFunction(() => !document.querySelector('#refresh').disabled);
  const confirm = async (p, yes = true) => {
    if (
      (await p.locator('#launch-dialog').evaluate((el) => el.open)) &&
      !(await p.locator('#confirm-dialog').evaluate((el) => el.open))
    ) {
      await p.locator('#launch-start').click();
    }
    await p.locator(`#confirm-dialog button[value="${yes ? 'confirm' : 'cancel'}"]`).click();
    await settled(p);
    if (!yes && (await p.locator('#launch-dialog').evaluate((el) => el.open)))
      await p.locator('#launch-cancel').click();
  };
  const refresh = async (p) => {
    await p.locator('#refresh').click();
    await settled(p);
  };
  const navigate = async (p, id) => {
    await p.locator(`.workspace-nav a[href="#${id}"]`).click();
    await p.waitForFunction((id) => !document.getElementById(id).hidden, id);
  };
  const card = (p, id) => p.locator(`[data-workitem="${id}"]`);
  const menu = async (p, id, label) => {
    await card(p, id).click({ button: 'right' });
    await p.locator('#item-menu').getByRole('menuitem', { name: label, exact: true }).click();
  };
  const close = async (p) => {
    await p.locator('#item-close').click();
    if (await p.locator('#confirm-dialog').evaluate((el) => el.open)) await confirm(p);
    await p.waitForFunction(() => !document.querySelector('#item-sheet').open);
  };
  const capture = async (p, name) => {
    await p.screenshot({ path: path.join(output, `state-${name}.png`), fullPage: true });
    shots++;
  };
  const sendAppearance = (p, value) =>
    p.evaluate(
      (v) => window.dispatchEvent(new CustomEvent('test-appearance', { detail: v })),
      value
    );
  const rootColor = (p, name) =>
    p.locator('html').evaluate((el, key) => el.style.getPropertyValue(key), name);
  try {
    const page = await makePage();
    root = roots[1];
    await page.evaluate((path) => window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } })), root);
    await settled(page);
    assert.equal(await page.locator('#workspace').textContent(), root, 'Workspace event must switch the panel without Refresh');
    root = roots[0];
    await page.evaluate((path) => window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } })), root);
    await settled(page);
    behaviorReport.passed('workspace-switch');
    // Switching while a draft confirmation is open must not save or leak it.
    const switchWorkspace = async (target) => {
      root = target;
      await page.evaluate((path) => window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } })), root);
      await settled(page);
    };
    await page.locator('#board-new').click();
    await page.locator('#workitem-title').fill('A retained architecture draft');
    await page.locator('#workitem-impact').selectOption('affects');
    await page.locator('#workitem-save').click();
    await page.waitForFunction(() => document.querySelector('#confirm-dialog').open);
    await switchWorkspace(roots[1]);
    assert.equal(await page.locator('#item-sheet').evaluate(el => el.open), false);
    assert.equal(await page.locator('#confirm-dialog').evaluate(el => el.open), false);
    assert.equal((await snapshot()).board.items.length, 0);
    assert.equal((await new Governance(roots[1]).run({ action: 'project_snapshot' })).board.items.length, 0);
    await page.locator('#workspace-drafts').click();
    const retained = await page.locator('#workspace-drafts-text').inputValue();
    assert.ok(retained.includes(roots[0].replace(/\\/g, '\\\\')));
    assert.match(retained, /A retained architecture draft/);
    assert.match(retained, /affects/);
    await capture(page, 'workspace-drafts');
    await page.locator('#workspace-drafts-close').click();
    behaviorReport.passed('draft-isolation');
    await switchWorkspace(roots[2]);
    assert.equal(await page.locator('#initialize-workspace').isVisible(), true);
    assert.equal(await page.locator('#board-new').isDisabled(), true);
    assert.deepEqual(await fs.readdir(roots[2]), []);
    await page.locator('#initialize-workspace').click();
    await confirm(page, false);
    assert.deepEqual(await fs.readdir(roots[2]), []);
    await capture(page, 'new-workspace');
    await switchWorkspace(roots[0]);
    assert.equal(await page.locator('#initialize-workspace').isVisible(), false);
    behaviorReport.passed('explicit-initialization');
    // A delayed A snapshot cannot replace B or unlock B's unfinished load.
    delayedSnapshotRoot = roots[0];
    await page.locator('#refresh').click();
    const snapshotDeadline = Date.now() + 5000;
    while (!releaseSnapshot && Date.now() < snapshotDeadline) await page.waitForTimeout(10);
    assert.equal(typeof releaseSnapshot, 'function', 'Timed out after 5s waiting for delayed governance.snapshot to reach the host bridge');
    await switchWorkspace(roots[1]);
    delayedSnapshotRoot = null;
    releaseSnapshot();
    await page.waitForTimeout(40);
    assert.equal(await page.locator('#workspace').textContent(), roots[1]);
    assert.equal(await page.locator('#status').textContent(), '待命');
    await switchWorkspace(roots[0]);
    behaviorReport.passed('delayed-snapshot');
    // Readable docs and real backend status projection; this evidence is only a UI fixture.
    await page.locator('#behavior-docs-open').click();
    await settled(page);
    assert.match(await page.locator('#behavior-docs-status').textContent(), /未配置行为关联/);
    await page.locator('#behavior-docs-close').click();
    await g.write('docs/ui-behavior.md', '# 说明\n\n### UI-001 — 易读说明\n\n切换项目后，旧请求不更新新项目。\n<img src=x onerror=alert(1)>\n');
    await g.write('src/fixture.ts', 'export const value = 1;\n');
    await g.write('docs/behavior-bindings.json', JSON.stringify({ version: 1, behaviors: [{ id: 'UI-001', document: 'docs/ui-behavior.md', cases: ['ui-case'], files: ['src/fixture.ts'] }] }));
    await page.locator('#behavior-docs-open').click();
    await settled(page);
    assert.match(await page.locator('.behavior-prose').textContent(), /旧请求不更新新项目/);
    assert.equal(await page.locator('.behavior-prose img').count(), 0);
    assert.equal(await page.locator('.behavior-status').getAttribute('data-result'), 'unverified');
    await capture(page, 'behavior-docs-unverified');
    await page.locator('#behavior-docs-close').click();
    const { behaviorContract } = require('../plugin/runtime/behaviors');
    const { makeEvidence } = require('../scripts/check-behaviors.cjs');
    const contractFixture = await behaviorContract(g);
    await g.write('.governance/behavior-evidence.json', JSON.stringify(makeEvidence(contractFixture,
      { version: 1, runId: 'fixture', completed: true, cases: [{ id: 'ui-case', status: 'passed' }] }, 'fixture', true, root, 'a'.repeat(40), true)));
    await page.locator('#behavior-docs-open').click();
    await settled(page);
    assert.equal(await page.locator('.behavior-status').getAttribute('data-result'), 'passed');
    assert.equal(await page.locator('.behavior-document details').evaluate(el => el.open), false);
    await page.locator('.behavior-document summary').click();
    assert.match(await page.locator('.behavior-document details').textContent(), /工作树快照/);
    await capture(page, 'behavior-docs-fixture-evidence');
    await page.locator('#behavior-docs-close').click();
    await g.write('src/fixture.ts', 'export const value = 2;\n');
    await page.locator('#behavior-docs-open').click();
    await settled(page);
    assert.equal(await page.locator('.behavior-status').getAttribute('data-result'), 'stale');
    await page.locator('#behavior-docs-close').click();
    delayedBehaviorRoot = roots[0];
    await page.locator('#behavior-docs-open').click();
    for (let i = 0; !releaseBehavior && i < 100; i++) await page.waitForTimeout(10);
    assert.equal(typeof releaseBehavior, 'function');
    await switchWorkspace(roots[1]);
    delayedBehaviorRoot = null; releaseBehavior();
    await page.waitForTimeout(30);
    assert.equal(await page.locator('#behavior-docs-dialog').evaluate(el => el.open), false);
    await page.locator('#behavior-docs-open').click();
    await settled(page);
    assert.match(await page.locator('#behavior-docs-status').textContent(), /未配置行为关联/);
    assert.equal(await page.locator('.behavior-document').count(), 0);
    await page.locator('#behavior-docs-close').click();
    await switchWorkspace(roots[0]);
    // Default is object workbench, with no permanently visible item editor or KPI wall.
    assert.equal(await page.locator('#board-section').isVisible(), true);
    assert.equal(await page.locator('#workitem-form').isVisible(), false);
    assert.equal(await page.locator('.metrics').count(), 0);
    assert.equal(await page.locator('.workspace-nav a').count(), 3);
    assert.equal(await page.locator('#project-dialog').evaluate((el) => el.open), false);
    assert.equal(await page.locator('.board-column').count(), 3);
    assert.deepEqual(await page.locator('.board-column').evaluateAll(rows => rows.map(el => el.dataset.stage)), ['todo', 'doing', 'done']);
    // CSS cascade must keep three/two/one columns, including the old 700px breakpoint.
    for (const [width, columns] of [[1280, 3], [1000, 2], [680, 2], [600, 1]]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.locator('#board-columns').evaluate(el =>
        getComputedStyle(el).gridTemplateColumns.split(' ').length), columns);
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    assert.equal(await page.locator('#board-section #task-section').count(), 0);
    for (const id of ['architecture', 'git-section', 'board-section']) {
      await navigate(page, id);
      assert.equal(await page.locator('#action-panel').isVisible(), true);
      assert.equal(await page.locator('#board-new').isVisible(), id === 'board-section');
      assert.equal(await page.locator('#architecture-analyze').isVisible(), id === 'architecture');
      assert.equal(await page.locator('#show-workflow').isVisible(), id === 'architecture');
      assert.equal(await page.locator('#documentation-start').isVisible(), true);
      assert.equal(await page.locator('#action-panel #architecture-analyze').count(), 1);
      assert.equal(await page.locator('#architecture #architecture-analyze').count(), 0);
      for (const other of ['architecture', 'git-section', 'board-section'])
        assert.equal(await page.locator('#' + other).isVisible(), other === id);
    }
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('#git-section').hidden);
    await page.goForward();
    await page.waitForFunction(() => !document.querySelector('#board-section').hidden);
    // Model settings are explicit, isolated and cancelable before any host mutation.
    const beforeSettings = hostCalls.length;
    holdModels = true;
    await page.locator('#analysis-start').click();
    await page.waitForFunction(() => document.querySelector('#launch-dialog').open);
    assert.equal(await page.locator('#launch-start').isDisabled(), true);
    await page.locator('#launch-cancel').click();
    holdModels = false;
    releaseModels();
    await page.waitForTimeout(30);
    assert.equal(await page.locator('#launch-dialog').evaluate((el) => el.open), false);
    await page.locator('#analysis-start').click();
    await page.waitForFunction(() => !document.querySelector('#launch-model').disabled);
    await page.locator('#launch-model').selectOption('fixture/reasoning');
    await page.locator('#launch-thinking').selectOption('high');
    assert.deepEqual(
      await page.locator('#launch-thinking option').evaluateAll((rows) => rows.map((o) => o.value)),
      ['', 'low', 'high']
    );
    await capture(page, 'model-settings');
    await page.locator('#launch-start').focus();
    await page.keyboard.press('Enter');
    assert.match(await page.locator('#confirm-description').textContent(), /Reasoning fixture/);
    await page.locator('#confirm-dialog button[value="cancel"]').click();
    await settled(page);
    assert.equal(
      await page.locator('#launch-dialog').evaluate((el) => el.contains(document.activeElement)),
      true,
      'Cancel must return keyboard focus to launch settings'
    );
    assert.equal(await page.locator('#launch-model').inputValue(), 'fixture/reasoning');
    assert.equal(await page.locator('#launch-thinking').inputValue(), 'high');
    await page.locator('#launch-model').selectOption('fixture/plain');
    assert.equal(await page.locator('#launch-thinking').isDisabled(), true);
    assert.equal(await page.locator('#launch-thinking').inputValue(), '');
    await page.locator('#launch-cancel').click();
    assert.equal(hostCalls.length, beforeSettings);
    modelListFailure = true;
    await page.locator('#analysis-start').click();
    await page.waitForFunction(() => !document.querySelector('#launch-start').disabled);
    assert.match(
      await page.locator('#launch-status').textContent(),
      /Model list fixture unavailable/
    );
    assert.equal(await page.locator('#launch-model option').count(), 1);
    await page.locator('#launch-cancel').click();
    modelListFailure = false;
    await page.locator('#analysis-start').click();
    await page.waitForFunction(() => !document.querySelector('#launch-model').disabled);
    await page.locator('#launch-model').selectOption('fixture/reasoning');
    modelMissing = true;
    await page.locator('#launch-start').click();
    await confirm(page);
    assert.match(await page.locator('#launch-status').textContent(), /no longer available/);
    assert.equal(hostCalls.length, beforeSettings);
    await page.locator('#launch-cancel').click();
    modelMissing = false;
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
    assert.equal(await page.locator('#board-new').isVisible(), true);
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
    // Creation opens a sheet; generated ID is not part of the user's form.
    async function create(title) {
      await page.locator('#board-new').click();
      await page.waitForFunction(() => document.querySelector('#item-sheet').open);
      const id = await page.locator('#workitem-id').inputValue();
      assert.match(id, /^item-[a-f0-9]{8}$/);
      assert.equal(await page.locator('#workitem-id').isVisible(), false);
      await page.locator('#workitem-title').fill(title);
      return id;
    }
    const first = await create('Review workspace navigation');
    await page.locator('#workitem-criteria').fill('Keyboard return verified');
    await page.locator('#workitem-impact').selectOption('affects');
    await capture(page, 'new-item');
    await page
      .locator('#workitem-description')
      .fill('Check search, object details and keyboard return.');
    await page.locator('#workitem-save').click();
    await confirm(page, false);
    assert.equal((await snapshot()).board.items.length, 0);
    assert.equal(await page.locator('#workitem-title').inputValue(), 'Review workspace navigation');
    await page.locator('#workitem-save').click();
    await confirm(page);
    assert.equal(await card(page, first).count(), 1);
    assert.equal((await snapshot()).board.items.find(i => i.id === first).architectureImpact, 'affects');
    assert.match(await card(page, first).locator('.architecture-tag').textContent(), /影响架构/);
    const second = await create('Polish architecture canvas');
    await page.locator('#workitem-impact').selectOption('none');
    await page.locator('#workitem-save').click();
    await confirm(page);
    await card(page, first).dragTo(card(page, first));
    assert.equal(await page.locator('#confirm-dialog').evaluate((el) => el.open), false);
    // Details return, generated Agent guidance, literal user data.
    if (await page.locator('#item-sheet').evaluate((el) => el.open)) await close(page);
    const boardGeometry = async () =>
      page.locator('.board-column').evaluateAll((rows) =>
        rows.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            x: Math.round(r.x + scrollX),
            y: Math.round(r.y + scrollY),
            width: Math.round(r.width)
          };
        })
      );
    const beforeDetails = await boardGeometry();
    assert.equal(
      new Set(beforeDetails.map((r) => r.y)).size,
      1,
      'Desktop board starts as one row of three columns'
    );
    assert.equal(beforeDetails.length, 3);
    assert.ok(Math.max(...beforeDetails.map(r => r.width)) - Math.min(...beforeDetails.map(r => r.width)) <= 1, 'Wide columns are equal width');
    await card(page, first).click();
    const openedGeometry = await boardGeometry();
    assert.deepEqual(
      openedGeometry,
      beforeDetails,
      'Opening item details must not resize or reflow the three-column board'
    );
    assert.equal(
      await page.locator('#item-sheet').evaluate((el) => el.matches(':modal')),
      true,
      'Item details are a real modal dialog'
    );
    await page.locator('#item-close').focus();
    await page.keyboard.press('Tab');
    assert.equal(
      await page.locator('#item-sheet').evaluate((el) => el.contains(document.activeElement)),
      true,
      'Tab focus remains inside details'
    );
    assert.equal(await page.locator('#workitem-form').isVisible(), false);
    assert.match(await page.locator('#item-description').textContent(), /keyboard return/);
    await page.locator('#item-guide').click();
    assert.match(await page.locator('#agent-brief').inputValue(), new RegExp(first));
    assert.match(await page.locator('#agent-brief').inputValue(), /governance/);
    assert.match(await page.locator('#agent-brief').inputValue(), /分层文档/);
    assert.match(await page.locator('#agent-brief').inputValue(), /运行相关检查/);
    assert.match(await page.locator('#agent-brief').inputValue(), /架构设计可选/);
    await close(page);
    assert.equal(await card(page, first).evaluate((el) => el === document.activeElement), true);
    // Menu keys and focus recovery.
    await card(page, first).focus();
    await page.keyboard.press('Shift+F10');
    assert.equal(await page.locator('#item-menu').isVisible(), true);
    await capture(page, 'menu');
    await page.keyboard.press('End');
    await page.keyboard.press('Escape');
    assert.equal(await card(page, first).evaluate((el) => el === document.activeElement), true);
    await card(page, first).focus();
    await page.keyboard.press('Shift+F10');
    await page
      .locator('#item-menu')
      .getByRole('menuitem', { name: '移至正在进行', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await confirm(page, false);
    assert.equal(
      await card(page, first).evaluate((el) => el === document.activeElement),
      true,
      'Canceled keyboard move restores card focus'
    );
    await menu(page, first, '编辑');
    await page.locator('#workitem-title').fill('draft first');
    assert.equal(await page.locator('#item-previous').isDisabled(), true);
    await page.locator('#item-next').click();
    await confirm(page, false);
    assert.equal(await page.locator('#workitem-title').inputValue(), 'draft first');
    assert.equal(
      await page.locator('#item-sheet').evaluate((el) => el.contains(document.activeElement)),
      true,
      'Canceled switching returns focus to details'
    );
    await page.keyboard.press('Escape');
    await confirm(page, false);
    assert.equal(await page.locator('#item-sheet').evaluate((el) => el.open), true);
    await sendAppearance(page, { base: 'dark' });
    await sendAppearance(page, { base: 'light' });
    assert.equal(await page.locator('#workitem-title').inputValue(), 'draft first');
    await page.locator('#item-next').click();
    await confirm(page);
    assert.equal(await page.locator('#item-record-id').textContent(), second);
    assert.equal(await page.locator('#item-next').isDisabled(), true);
    await page.locator('#item-previous').click();
    assert.equal(await page.locator('#item-record-id').textContent(), first);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#item-sheet').open);
    assert.equal(await card(page, first).evaluate((el) => el === document.activeElement), true);
    assert.deepEqual(
      await boardGeometry(),
      beforeDetails,
      'Closing details preserves board geometry'
    );
    // Project drafts remain independent; the background is inert while item details are open.
    await page.locator('#project-open').click();
    await page.locator('#edit-current').fill('progress draft');
    await page.locator('#project-close').click();
    await menu(page, first, '移至正在进行');
    assert.match(await page.locator('#confirm-description').textContent(), /总体进度草稿/);
    await confirm(page, false);
    assert.equal(await page.locator('#edit-current').inputValue(), 'progress draft');
    await refresh(page);
    await refresh(page);
    await menu(page, second, '上移');
    await confirm(page);
    assert.equal((await snapshot()).board.items[0].id, second);
    await card(page, first).dragTo(page.locator('.board-column[data-stage="doing"]'));
    await confirm(page);
    assert.equal((await snapshot()).board.items.find((i) => i.id === first).stage, 'doing');
    await page.reload();
    await settled(page);
    assert.equal(await page.locator(`[data-stage="doing"] [data-workitem="${first}"]`).count(), 1);
    await menu(page, first, '编辑');
    await page.locator('#workitem-blocker').fill('Needs approval');
    await page.locator('#workitem-save').click();
    await confirm(page);
    await menu(page, first, '移至已完成');
    await confirm(page);
    assert.match(await page.locator('#notice').textContent(), /blocker/);
    assert.equal((await snapshot()).board.items.find((i) => i.id === first).stage, 'doing');
    await menu(page, first, '编辑');
    await page.locator('#workitem-blocker').fill('');
    await page.locator('#workitem-save').click();
    await confirm(page);
    await menu(page, first, '移至已完成');
    await confirm(page);
    assert.equal((await snapshot()).board.items.find((i) => i.id === first).stage, 'done');
    assert.equal(await fs.readFile(path.join(root, 'STATE.json'), 'utf8'), stateBefore);
    // The browser checks above actually ran before done; no additional review form or Agent task.
    assert.equal((await snapshot()).board.items.find(i => i.id === first).acceptance ?? null, null);
    assert.equal(await page.locator('#accept-dialog, #accept-form, #item-human-review, #item-agent-review, .card-review-actions').count(), 0);
    assert.equal(await page.getByRole('button', { name: /^(人工验收|Agent 验收)$/ }).count(), 0);
    const callsBeforeDone = hostCalls.length;
    await card(page, first).click({ button: 'right' });
    assert.doesNotMatch(await page.locator('#item-menu').textContent(), /验收/);
    await page.keyboard.press('Escape');
    await card(page, first).click();
    assert.match(await page.locator('#item-checks h3').textContent(), /检查条件/);
    assert.equal(await page.locator('#item-history').isVisible(), false);
    await close(page);
    await menu(page, first, '移至正在进行');
    await confirm(page);
    assert.equal((await snapshot()).board.items.find(i => i.id === first).stage, 'doing');
    await menu(page, first, '移至已完成');
    await confirm(page);
    assert.equal((await snapshot()).board.items.find(i => i.id === first).stage, 'done');
    assert.equal(hostCalls.length, callsBeforeDone, 'Done/reopen does not launch an Agent');
    await capture(page, 'direct-done');

    // Seed an explicitly historical fixture on disk; read it through the actual backend.
    // This is old-format compatibility data, not current-run test evidence or a live review action.
    const legacyId = 'legacy-accepted';
    await mutate({ action: 'board_create', id: legacyId, title: 'Historical completed work', criteria: ['Historical fixture check'] });
    const legacyBoardPath = path.join(root, '.governance/board.json');
    const legacyBoard = JSON.parse(await fs.readFile(legacyBoardPath, 'utf8'));
    const legacyItem = legacyBoard.items.find(i => i.id === legacyId);
    legacyItem.stage = 'accepted';
    legacyItem.acceptance = { method: 'human', passed: true, valid: true,
      itemFingerprint: itemFingerprint(legacyItem), at: '2020-01-01T00:00:00.000Z',
      reviewer: 'Legacy fixture reviewer', conclusion: 'Archived fixture conclusion',
      evidence: 'Historical fixture only; not evidence for this test run' };
    await g.write('.governance/board.json', JSON.stringify(legacyBoard, null, 2) + '\n');
    const legacyRaw = await fs.readFile(legacyBoardPath, 'utf8');
    const legacyRevision = (await snapshot()).revision;
    await refresh(page);
    assert.equal(await page.locator(`[data-stage="done"] [data-workitem="${legacyId}"]`).count(), 1);
    assert.equal(await page.locator('[data-stage="accepted"]').count(), 0);
    assert.match(await card(page, legacyId).locator('.item-meta').textContent(), /已完成/);
    await card(page, legacyId).click();
    assert.match(await page.locator('#item-sheet-meta').textContent(), /已完成/);
    assert.equal(await page.locator('#item-history').evaluate(el => el.open), false);
    await page.locator('#item-history summary').click();
    assert.match(await page.locator('#item-history summary').textContent(), /历史检查记录.*旧版.*只读/);
    assert.match(await page.locator('#item-review-record').textContent(), /旧版人工验收记录.*Legacy fixture reviewer/);
    assert.match(await page.locator('#item-review-record').textContent(), /not evidence for this test run/);
    await capture(page, 'legacy-history');
    await close(page);
    await card(page, legacyId).click({ button: 'right' });
    assert.doesNotMatch(await page.locator('#item-menu').textContent(), /验收/);
    assert.equal(await page.locator('#item-menu').getByRole('menuitem', { name: '移至正在进行', exact: true }).count(), 1);
    await page.keyboard.press('Escape');
    await refresh(page);
    assert.equal(await fs.readFile(legacyBoardPath, 'utf8'), legacyRaw, 'Reading legacy history must not migrate/write board data');
    assert.equal((await snapshot()).revision, legacyRevision);

    // Old review sessions remain readable/open/status/cancel, but are never newly launched.
    const legacyRun = { id: randomUUID(), kind: 'acceptance', phase: 'running', workspace: root,
      taskId: 'overall', itemId: legacyId, sessionId: 'legacy-fixture-session',
      createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' };
    let historicalRuns = { version: 1, runs: [] };
    try { historicalRuns = JSON.parse(await fs.readFile(path.join(root, '.governance/operations.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    historicalRuns.runs.push(legacyRun);
    await g.write('.governance/operations.json', JSON.stringify(historicalRuns, null, 2) + '\n');
    const historyRaw = await fs.readFile(path.join(root, '.governance/operations.json'), 'utf8');
    const promptsBeforeHistory = hostCalls.filter(c => ['session/create', 'agent/prompt'].includes(c.operation)).length;
    await page.locator('#operations-open').click();
    await settled(page);
    const historyRow = page.locator('.operation-run').filter({ hasText: '历史工作项验收（旧版）' });
    await historyRow.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await historyRow.count(), 1);
    assert.equal(await fs.readFile(path.join(root, '.governance/operations.json'), 'utf8'), historyRaw);
    await historyRow.getByRole('button', { name: '打开 Agent 会话', exact: true }).click();
    await settled(page);
    assert.equal(hostCalls.findLast(c => c.operation === 'session/open').args[0], 'legacy-fixture-session');
    await historyRow.getByRole('button', { name: '查看进度 / 结果', exact: true }).click();
    await settled(page);
    assert.match(await page.locator('#operation-result').textContent(), /Fixture analysis output/);
    await capture(page, 'legacy-agent-progress');
    await historyRow.getByRole('button', { name: '取消任务', exact: true }).click();
    await confirm(page);
    assert.equal(hostCalls.at(-1).operation, 'agent/abort');
    assert.equal(hostCalls.filter(c => ['session/create', 'agent/prompt'].includes(c.operation)).length, promptsBeforeHistory);
    assert.equal(await fs.readFile(legacyBoardPath, 'utf8'), legacyRaw, 'Legacy session management cannot change the board');
    await page.locator('#operations-close').click();
    await page.locator('#analysis-start').click();
    await confirm(page, false);
    hostStreaming = true;
    await page.locator('#analysis-start').click();
    await confirm(page);
    await page.waitForSelector('.operation-run');
    assert.match(
      hostCalls.findLast((c) => c.operation === 'agent/prompt').args[0].content,
      /do not edit project files/
    );
    const writesBeforeCancel = operationWrites.length;
    await page.context().setOffline(true);
    await page.waitForFunction(() => document.querySelector('[data-operation-write]').disabled);
    assert.equal(await page.getByRole('button', { name: '取消任务', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '查看进度 / 结果', exact: true }).first().isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: '打开 Agent 会话', exact: true }).first().isEnabled(), true);
    await page.getByRole('button', { name: '查看进度 / 结果', exact: true }).first().click();
    await settled(page);
    assert.equal(await page.getByRole('button', { name: '取消任务', exact: true }).isDisabled(), true);
    await page.context().setOffline(false);
    await page.waitForFunction(() => !document.querySelector('[data-operation-write]').disabled);
    await page.getByRole('button', { name: '取消任务', exact: true }).click();
    await page.context().setOffline(true);
    await confirm(page);
    assert.equal(operationWrites.length, writesBeforeCancel, 'Disconnect during cancel confirmation must not invoke the bridge');
    await page.context().setOffline(false);
    await page.waitForFunction(() => !document.querySelector('[data-operation-write]').disabled);
    const callsBeforeCancelDismiss = hostCalls.length;
    await page.getByRole('button', { name: '取消任务', exact: true }).click();
    await confirm(page, false);
    assert.equal(hostCalls.length, callsBeforeCancelDismiss);
    await page.getByRole('button', { name: '取消任务', exact: true }).click();
    await confirm(page);
    assert.equal(hostCalls.at(-1).operation, 'agent/abort');
    await page.locator('#operations-close').click();
    const beforeDocs = hostCalls.length;
    await page.locator('#documentation-start').click();
    await page.waitForFunction(() => !document.querySelector('#launch-model').disabled);
    assert.match(await page.locator('#launch-title').textContent(), /文档维护/);
    await page.locator('#launch-cancel').click();
    assert.equal(hostCalls.length, beforeDocs);
    await page.locator('#documentation-start').click();
    await confirm(page, false);
    assert.equal(hostCalls.length, beforeDocs);
    await page.locator('#documentation-start').click();
    await page.waitForFunction(() => !document.querySelector('#launch-model').disabled);
    await page.locator('#launch-model').selectOption('fixture/reasoning');
    await page.locator('#launch-thinking').selectOption('high');
    await capture(page, 'documentation-settings');
    await confirm(page);
    const docsPrompt = hostCalls.findLast(c => c.operation === 'agent/prompt').args[0].content;
    assert.match(docsPrompt, /currently open project/);
    assert.match(docsPrompt, /Write only docs\/, notes\//);
    assert.match(docsPrompt, /Do not upgrade or install plugins/);
    assert.equal(hostCalls.findLast(c => c.operation === 'session/create').args[0].modelId, 'reasoning');
    assert.match(await page.locator('.operation-run').first().textContent(), /文档维护/);
    await capture(page, 'documentation-progress');
    await page.getByRole('button', { name: '取消任务', exact: true }).click();
    await confirm(page);
    assert.equal(hostCalls.at(-1).operation, 'agent/abort');
    await page.locator('#operations-close').click();
    // Completed runtime, stale local running record: starting the next operation must reconcile it.
    hostStreaming = true;
    await page.locator('#analysis-start').click(); await confirm(page);
    const staleRun = JSON.parse(await fs.readFile(path.join(root, '.governance/operations.json'), 'utf8')).runs.at(-1);
    await page.locator('#operations-close').click(); hostStreaming = false;
    const promptsBeforeAutoSync = hostCalls.filter(c => c.operation === 'agent/prompt').length;
    await page.locator('#documentation-start').click(); await confirm(page);
    let autoSynced = JSON.parse(await fs.readFile(path.join(root, '.governance/operations.json'), 'utf8'));
    assert.equal(autoSynced.runs.find(r => r.id === staleRun.id).phase, 'completed');
    assert.equal(hostCalls.filter(c => c.operation === 'agent/prompt').length, promptsBeforeAutoSync + 1, 'Only the new prompt is sent');
    // Opening the progress list also reconciles the next finished run without an Inspect click.
    await page.locator('#operations-close').click(); await page.locator('#operations-open').click();
    await page.waitForFunction(() => !document.querySelector('#operation-runs')?.textContent.includes('运行中'));
    autoSynced = JSON.parse(await fs.readFile(path.join(root, '.governance/operations.json'), 'utf8'));
    assert.equal(autoSynced.runs.at(-1).phase, 'completed');
    await capture(page, 'operations-auto-sync');
    await page.locator('#operations-close').click(); hostStreaming = true;
    await navigate(page, 'architecture');
    await page.locator('#architecture-analyze').click();
    await page.waitForFunction(() => !document.querySelector('#launch-model').disabled);
    await page.locator('#launch-model').selectOption('fixture/reasoning');
    await page.locator('#launch-thinking').selectOption('high');
    await confirm(page);
    const architecturePrompt = hostCalls.findLast((c) => c.operation === 'agent/prompt').args[0].content;
    assert.match(architecturePrompt, /Load Skill io\.github\.tonkic\.agent-governance\/architecture-copilot/);
    assert.match(architecturePrompt, /current-state analysis mode/);
    assert.match(architecturePrompt, /If the Skill cannot be loaded, stop and report/);
    assert.match(architecturePrompt, /architecture_sources/);
    assert.doesNotMatch(architecturePrompt, /Reanalyze the core project architecture|architecture_design_save/);
    const createdWithModel = hostCalls.findLast((c) => c.operation === 'session/create').args[0];
    assert.equal(createdWithModel.providerId, 'fixture');
    assert.equal(createdWithModel.modelId, 'reasoning');
    assert.equal(createdWithModel.thinkingLevel, 'high');
    await page.getByRole('button', { name: '取消任务', exact: true }).click();
    await confirm(page);
    await page.locator('#operations-close').click();
    await navigate(page, 'board-section');
    assert.equal(await fs.readFile(path.join(root, 'STATE.json'), 'utf8'), stateBefore);
    await page.locator('#project-open').click();
    await capture(page, 'project-actions');
    await page.locator('#project-close').click();
    const promptsBeforeRecovery = hostCalls.filter((c) => c.operation === 'agent/prompt').length;
    failCreation = true;
    await page.locator('#analysis-start').click();
    await confirm(page);
    assert.match(await page.locator('#notice').textContent(), /durable session ID/);
    await page.locator('#launch-cancel').click();
    await page.locator('#operations-open').click();
    await page.waitForSelector('.operation-run');
    const writesBeforeResolve = operationWrites.length;
    await page.context().setOffline(true);
    await page.waitForFunction(() => document.querySelector('[data-operation-write]').disabled);
    assert.equal(await page.getByRole('button', { name: '已核对 — 解除创建阻塞', exact: true }).isDisabled(), true);
    await page.context().setOffline(false);
    await page.waitForFunction(() => !document.querySelector('[data-operation-write]').disabled);
    await page.getByRole('button', { name: '已核对 — 解除创建阻塞', exact: true }).click();
    await page.context().setOffline(true);
    await confirm(page);
    assert.equal(operationWrites.length, writesBeforeResolve, 'Disconnect during resolve confirmation must not invoke the bridge');
    await page.context().setOffline(false);
    await page.waitForFunction(() => !document.querySelector('[data-operation-write]').disabled);
    await page.getByRole('button', { name: '已核对 — 解除创建阻塞', exact: true }).click();
    await confirm(page, false);
    assert.equal(
      hostCalls.filter((c) => c.operation === 'agent/prompt').length,
      promptsBeforeRecovery
    );
    await capture(page, 'creation-recovery');
    await page.getByRole('button', { name: '已核对 — 解除创建阻塞', exact: true }).click();
    await confirm(page);
    assert.equal(
      hostCalls.filter((c) => c.operation === 'agent/prompt').length,
      promptsBeforeRecovery
    );
    await page.locator('#operations-close').click();
    failCreation = false;
    // Search locator, filtered drag safety, empty-state recovery.
    await page.keyboard.press('/');
    assert.equal(
      await page.locator('#board-search').evaluate((el) => el === document.activeElement),
      true
    );
    await page.locator('#board-search').fill('canvas');
    assert.equal(await page.locator('[data-workitem]').count(), 1);
    assert.equal(await card(page, second).getAttribute('draggable'), 'false');
    await page.locator('#board-search').fill('no-such-object');
    assert.equal(await page.locator('#board-empty').isVisible(), true);
    await capture(page, 'no-results');
    await page.locator('#search-clear').click();
    assert.equal(await page.locator('[data-workitem]').count(), 3);
    // Synthetic touch PointerEvents exercise the long-press handler; not physical-device acceptance.
    await card(page, first).dispatchEvent('pointerdown', {
      pointerType: 'touch',
      button: 0,
      clientX: 200,
      clientY: 200
    });
    await page.waitForTimeout(550);
    assert.equal(await page.locator('#item-menu').isVisible(), true);
    await card(page, first).dispatchEvent('pointerup', { pointerType: 'touch' });
    await page.keyboard.press('Escape');
    await card(page, first).dispatchEvent('pointerdown', {
      pointerType: 'touch',
      button: 0,
      clientX: 200,
      clientY: 200
    });
    await card(page, first).dispatchEvent('pointermove', {
      pointerType: 'touch',
      clientX: 225,
      clientY: 210
    });
    await page.waitForTimeout(550);
    assert.equal(await page.locator('#item-menu').isVisible(), false);
    await card(page, first).dispatchEvent('pointerdown', {
      pointerType: 'touch',
      button: 0,
      clientX: 200,
      clientY: 200
    });
    await page.waitForTimeout(2200);
    await card(page, first).dispatchEvent('pointerup', { pointerType: 'touch' });
    await card(page, first).dispatchEvent('click');
    assert.equal(
      await page.locator('#item-menu').isVisible(),
      true,
      'Long hold release must preserve menu'
    );
    assert.equal(await page.locator('#item-sheet').evaluate((el) => el.open), false);
    await page.keyboard.press('Escape');
    // Offline pauses writes, preserves read access, and never replays an action on reconnect.
    await page.context().setOffline(true);
    await page.waitForFunction(() => document.querySelector('#board-new').disabled);
    assert.match(await page.locator('#notice').textContent(), /离线/);
    await capture(page, 'offline');
    await card(page, first).click();
    assert.equal(await page.locator('#item-sheet').evaluate((el) => el.open), true);
    await close(page);
    await page.context().setOffline(false);
    await refresh(page);
    assert.equal(await page.locator('#board-new').isEnabled(), true);
    // Disconnecting during confirmation must not invoke either local write path.
    const offlineBoard = JSON.stringify((await snapshot()).board);
    await menu(page, second, '移至正在进行');
    await page.context().setOffline(true);
    await confirm(page);
    assert.equal(JSON.stringify((await snapshot()).board), offlineBoard);
    await page.context().setOffline(false);
    await refresh(page);
    await menu(page, second, '编辑');
    await page.locator('#workitem-title').fill('offline draft');
    await page.locator('#workitem-save').click();
    await page.context().setOffline(true);
    await confirm(page);
    assert.equal(JSON.stringify((await snapshot()).board), offlineBoard);
    assert.equal(await page.locator('#workitem-title').inputValue(), 'offline draft');
    await page.context().setOffline(false);
    await close(page);
    await page.locator('#project-open').click();
    await page.locator('#edit-current').fill('offline progress');
    await page.getByRole('button', { name: '保存进度', exact: true }).click();
    await page.context().setOffline(true);
    await confirm(page);
    assert.equal(await fs.readFile(path.join(root, 'STATE.json'), 'utf8'), stateBefore);
    await page.context().setOffline(false);
    assert.equal(await fs.readFile(path.join(root, 'STATE.json'), 'utf8'), stateBefore);
    await page.locator('#project-close').click();
    await refresh(page);
    await refresh(page);
    await navigate(page, 'architecture');
    await page.locator('#graph-viewport').focus();
    await page.keyboard.press('/');
    await page.waitForFunction(() => !document.querySelector('#board-section').hidden);
    assert.equal(
      await page.locator('#board-search').evaluate((el) => el === document.activeElement),
      true
    );
    // Stale and workspace-switched writes rejected by real backend.
    await mutate({ action: 'board_update', id: second, title: 'External change' });
    await menu(page, second, '移至正在进行');
    await confirm(page);
    assert.match(await page.locator('#notice').textContent(), /stale/);
    await refresh(page);
    root = roots[1];
    await menu(page, second, '移至正在进行');
    await confirm(page);
    assert.match(await page.locator('#notice').textContent(), /stale|switched/);
    assert.equal(
      (await new Governance(root).run({ action: 'project_snapshot' })).board.items.length,
      0
    );
    root = roots[0];
    await refresh(page);
    // Independent project/snapshot read failures are visible and recover without overwriting data.
    failProject = true;
    await refresh(page);
    assert.match(await page.locator('#board-status').textContent(), /Fixture read failure/);
    assert.match(await page.locator('#notice.error').textContent(), /Fixture read failure/);
    await capture(page, 'read-error');
    assert.equal(await page.locator('#board-new').isDisabled(), true);
    failProject = false;
    await refresh(page);
    failSnapshot = true;
    await refresh(page);
    assert.match(await page.locator('#notice').textContent(), /Fixture read failure/);
    assert.equal(await page.locator('#board-new').isDisabled(), true);
    failSnapshot = false;
    await refresh(page);
    // Source-backed graph, direct relations, camera/keyboard and stale-source warning.
    await fs.writeFile(path.join(root, 'app.ts'), "import { value } from './store';\n");
    await fs.writeFile(path.join(root, 'store.ts'), 'export const value = 1;\n');
    const sources = await g.run({ action: 'architecture_sources', files: ['app.ts', 'store.ts'] });
    await mutate({
      action: 'architecture_set',
      graph: {
        title: 'Workspace dependencies',
        source: 'Inspected fixture imports',
        nodes: [
          { id: 'app', title: 'Application', description: 'Imports store', files: ['app.ts'] },
          { id: 'store', title: 'Store', description: 'Exports value', files: ['store.ts'] }
        ],
        edges: [{ from: 'app', to: 'store', label: 'imports' }],
        fingerprints: sources.fingerprints
      }
    });
    await refresh(page);
    await navigate(page, 'architecture');
    assert.equal(await page.locator('.architecture-node').count(), 2);
    await page.locator('[data-module="app"]').click();
    await page.locator('#module-relations button').click();
    assert.equal(await page.locator('#module-title').textContent(), 'Store');
    await page.locator('#graph-viewport').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('0');
    await page.locator('#show-workflow').click();
    assert.equal(await page.locator('.architecture-node').count(), 4);
    assert.equal(await page.locator('#graph-check-state').textContent(), '', 'Workflow must not show architecture source-check status');
    await page.locator('#module-jump').click();
    await page.waitForFunction(
      () =>
        document.querySelector('#project-dialog').open &&
        !document.querySelector('#board-section').hidden
    );
    assert.equal(await page.locator('#board-section').isVisible(), true);
    await page.locator('#project-close').click();
    await navigate(page, 'architecture');
    await page.locator('#show-architecture').click();
    await fs.appendFile(path.join(root, 'app.ts'), '// change\n');
    await refresh(page);
    assert.equal(await page.locator('#graph-warning').isVisible(), false);
    assert.match(await page.locator('#graph-check-state').textContent(), /手动模式/);
    await page.locator('#architecture-check').click();
    await settled(page);
    assert.equal(await page.locator('#graph-warning').isVisible(), true);
    const checkedState = await page.locator('#graph-check-state').textContent();
    assert.ok(checkedState.length > 0);
    await page.locator('#show-workflow').click();
    assert.equal(await page.locator('#graph-check-state').textContent(), '');
    assert.equal(await page.locator('#graph-warning').isVisible(), false);
    await page.locator('#show-architecture').click();
    assert.equal(await page.locator('#graph-check-state').textContent(), checkedState);
    holdGit = true;
    try {
      await page.locator('#refresh').click();
      await page.waitForFunction(
        () => document.querySelectorAll('.architecture-node').length === 2,
        null,
        { timeout: 2000 }
      );
      assert.equal(await page.locator('#board-new').isDisabled(), true);
      assert.equal(await page.locator('[data-workitem] button:enabled').count(), 0);
    } finally {
      holdGit = false;
      releaseGit?.();
    }
    await settled(page);
    await navigate(page, 'board-section');
    // Realistic bounded fixture objects for visual checks; never user project records.
    for (const item of [
      {
        id: 'fixture-a',
        title: 'Check release packaging',
        description: 'Keep the manifest and generated runtime aligned.'
      },
      {
        id: 'fixture-b',
        title: 'Inspect keyboard navigation',
        description: 'Focus should return to the selected object.'
      },
      {
        id: 'fixture-c',
        title: 'Review native window behavior',
        description: 'Confirm controls remain clickable.'
      }
    ])
      await mutate({ action: 'board_create', ...item });
    await mutate({ action: 'board_move', id: 'fixture-b', stage: 'doing', position: 0 });
    await mutate({
      action: 'board_update',
      id: 'fixture-b',
      title: 'Inspect keyboard navigation',
      description: 'Focus should return to the selected object.',
      blocker: 'Waiting for review'
    });
    await mutate({ action: 'board_move', id: 'fixture-c', stage: 'doing', position: 0 });
    await mutate({ action: 'board_move', id: 'fixture-c', stage: 'done', position: 0 });
    await refresh(page);
    const english = await makePage('en-US');
    await english.locator('#board-new').click();
    const enId = await english.locator('#workitem-id').inputValue();
    const literal = '<b>工作项 {0}</b> & user data';
    await english.locator('#workitem-title').fill(literal);
    await english.locator('#workitem-save').click();
    await confirm(english, false);
    assert.equal(await english.locator('#workitem-title').inputValue(), literal);
    await english.locator('#workitem-save').click();
    await confirm(english);
    assert.equal(await card(english, enId).locator('h4 b').count(), 0);
    for (const [p, lang] of [
      [page, 'zh'],
      [english, 'en']
    ]) {
      await refresh(p);
      if (await p.locator('#project-dialog').evaluate((el) => el.open))
        await p.locator('#project-close').click();
      for (const width of [390, 768, 1280])
        for (const theme of ['light', 'dark']) {
          await p.setViewportSize({ width, height: 1000 });
          await p.evaluate((theme) => {
            document.documentElement.dataset.base = theme;
          }, theme);
          for (const view of ['board-section', 'architecture', 'git-section']) {
            await navigate(p, view);
            await p.waitForTimeout(80);
            assert.ok(
              await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
              `${lang}/${view}/${width}/${theme}`
            );
            await p.screenshot({
              path: path.join(output, `${lang}-${view}-${width}-${theme}.png`),
              fullPage: true
            });
            shots++;
          }
          await navigate(p, 'architecture');
          await p.locator('#architecture-analyze').click();
          await p.waitForFunction(() => !document.querySelector('#launch-model').disabled);
          await p.locator('#launch-model').selectOption('fixture/reasoning');
          await p.locator('#launch-thinking').selectOption('high');
          assert.ok(
            await p.locator('#launch-dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
            'Launch settings must not overflow'
          );
          const launchShot = await p.screenshot({
            path: path.join(output, `${lang}-launch-${width}-${theme}.png`),
            fullPage: false
          });
          assert.equal(launchShot.readUInt32BE(20), 1000, 'Launch evidence uses the viewport height');
          shots++;
          await p.locator('#launch-cancel').click();
          await navigate(p, 'board-section');
          const geometry = () =>
            p.locator('.board-column').evaluateAll((rows) =>
              rows.map((el) => {
                const r = el.getBoundingClientRect();
                return {
                  x: Math.round(r.x + scrollX),
                  y: Math.round(r.y + scrollY),
                  width: Math.round(r.width)
                };
              })
            );
          const before = await geometry();
          assert.equal(before.length, 3, `${lang}/${width}/${theme}: exactly three stages`);
          assert.equal(await p.locator('#board-columns').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), width > 1100 ? 3 : width > 650 ? 2 : 1);
          assert.equal(await p.getByRole('button', { name: /^(人工验收|Agent 验收|Human review|Agent review)$/ }).count(), 0);
          await card(p, first).click();
          assert.deepEqual(
            await geometry(),
            before,
            `${lang}/${width}/${theme}: modal preserves board layout`
          );
          assert.ok(
            await p.locator('#item-sheet').evaluate((el) => {
              const r = el.getBoundingClientRect();
              return (
                Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2 &&
                el.scrollWidth <= el.clientWidth
              );
            }),
            'Details are centered without horizontal overflow'
          );
          const modalShot = await p.screenshot({
            path: path.join(output, `${lang}-modal-${width}-${theme}.png`),
            fullPage: false
          });
          assert.equal(modalShot.readUInt32BE(20), 1000, 'Modal evidence uses the viewport height');
          shots++;
          await close(p);
          assert.deepEqual(await geometry(), before, 'Closing modal preserves geometry');
          assert.equal(
            await p
              .locator('.board-column')
              .evaluateAll((rows) =>
                rows.every((el) => getComputedStyle(el).borderLeftWidth !== '0px')
              ),
            true,
            'Every stage has a visible column boundary'
          );
        }
      await p.setViewportSize({ width: 1280, height: 1000 });
      await navigate(p, 'board-section');
      await card(p, first).click();
      await p.screenshot({ path: path.join(output, `${lang}-details-1280.png`), fullPage: false });
      shots++;
      await close(p);
    }
    await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' });
    await card(page, first).click({ button: 'right' });
    assert.equal(
      await page.locator('#item-menu').evaluate((el) => getComputedStyle(el).animationName),
      'none'
    );
    assert.equal(
      await page.locator('#item-menu').evaluate((el) => getComputedStyle(el).backdropFilter),
      'none'
    );
    await page.keyboard.press('Escape');
    // Delayed host appearance wins over system fallback, but not a newer host event.
    for (const newerHostEvent of [false, true]) {
      const race = await browser.newPage();
      let resolveAppearance;
      await race.exposeFunction(
        'appearanceFixture',
        () =>
          new Promise((resolve) => {
            resolveAppearance = resolve;
          })
      );
      await race.addInitScript(() => {
        window.pluginBridge = {
          invoke: (channel) =>
            channel === 'app.getAppearance'
              ? window.appearanceFixture()
              : Promise.resolve(
                  channel === 'app.getLocale' ? 'en' : { ok: false, error: 'Preview fixture' }
                ),
          on: (event, fn) => {
            if (event === 'appearance:changed')
              window.addEventListener('test-appearance', (e) => fn(e.detail));
          }
        };
      });
      await race.goto(url);
      await race.waitForFunction(() => document.querySelector('#refresh').disabled === false);
      await race.emulateMedia({ colorScheme: 'dark' });
      if (newerHostEvent) await sendAppearance(race, { base: 'dark' });
      resolveAppearance({ base: 'light' });
      await race.waitForFunction(
        (expected) => document.documentElement.dataset.base === expected,
        newerHostEvent ? 'dark' : 'light'
      );
      await race.close();
    }
    // Saving in A must not update B's notification/focus after a delayed A reload.
    const raceId = 'save-race';
    await mutate({ action: 'board_create', id: raceId, title: 'A save race' });
    const bg = new Governance(roots[1]);
    await bg.run({ action: 'board_create', id: raceId, title: 'B save race', expectedRevision: (await bg.run({ action: 'project_snapshot' })).revision });
    const savePanel = await makePage();
    await card(savePanel, raceId).click();
    await savePanel.locator('#item-edit').click();
    await savePanel.locator('#workitem-title').fill('A updated race');
    delayedGitRoot = roots[0];
    await savePanel.locator('#workitem-save').click();
    await savePanel.locator('#confirm-dialog button[value="confirm"]').click();
    for (let tries = 0; !releaseDelayedGit && tries < 200; tries++) await savePanel.waitForTimeout(10);
    assert.equal(typeof releaseDelayedGit, 'function', 'A save reload reached delayed Git');
    root = roots[1];
    await savePanel.evaluate(path => window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } })), root);
    await settled(savePanel);
    await savePanel.locator('#board-search').focus();
    const noticeBeforeOldSave = await savePanel.locator('#notice').textContent();
    delayedGitRoot = null;
    releaseDelayedGit();
    await savePanel.waitForTimeout(80);
    assert.equal(await savePanel.locator('#notice').textContent(), noticeBeforeOldSave, 'Old save cannot replace B notification');
    assert.equal(await savePanel.locator('#board-search').evaluate(el => el === document.activeElement), true, 'Old save cannot focus B card with same ID');
    assert.equal((await bg.run({ action: 'project_snapshot' })).board.items.find(i => i.id === raceId).title, 'B save race');
    root = roots[0];
    await savePanel.close();
    behaviorReport.passed('delayed-save');
    // A continuation created in A must not reopen a dialog after B starts loading.
    const racePanel = await makePage();
    root = roots[2];
    await racePanel.evaluate((path) => {
      document.querySelector('#board-new').click();
      window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } }));
    }, root);
    await settled(racePanel);
    assert.equal(await racePanel.locator('#initialize-workspace').isVisible(), true);
    assert.equal(await racePanel.locator('#item-sheet').evaluate(el => el.open), false,
      'Old new-item continuation must not reopen its dialog in an uninitialized workspace');
    root = roots[0];
    await racePanel.close();
    behaviorReport.passed('new-item-continuation');
    // Real design backend + visual canvas; no actual model invocation or host acceptance.
    const designPage = await makePage();
    await navigate(designPage, 'architecture');
    await designPage.locator('#show-design').click();
    const designSnapshot = () => g.run({ action: 'architecture_design_snapshot' });
    const saveProposal = async proposal => { const s = await designSnapshot(); await g.run({ action: 'architecture_design_save', proposal, expectedDraft: s.draft.draftId, expectedRevision: s.revision }); };
    assert.equal((await designSnapshot()).baseline, null);
    const callsBeforeDraft = hostCalls.length;
    await designPage.locator('#design-begin').click();
    await designPage.locator('#design-reason').fill('Local-first project governance; no server or diagram editor dependency.');
    await designPage.locator('#design-begin-submit').click();
    await confirm(designPage, false);
    assert.equal((await designSnapshot()).draft, null, 'Canceled creation writes nothing');
    await designPage.locator('#design-begin-submit').click();
    await confirm(designPage);
    assert.equal(hostCalls.length, callsBeforeDraft, 'Creating draft must not start Agent');
    await designPage.locator('#design-start').click();
    assert.match(await designPage.locator('#launch-title').textContent(), /架构共创/);
    await designPage.locator('#launch-cancel').click();
    assert.equal(hostCalls.length, callsBeforeDraft, 'Canceled launch creates no session');
    const designProposal = {
      title: '本地项目治理设计',
      document: '## 用途\n人确认意图，Agent执行获批范围。\n## 决定\n复用本地文件与画板，不引入服务。代价：不提供多机实时协作。\n## 边界\n设计不是源码现状。<img src=x onerror="window.designInjected=true">',
      nodes: [{ id: 'intent', title: '项目意图', description: 'STATE保存获批范围；设计说明理由和取舍。', files: [] }, { id: 'canvas', title: '可视化画板', description: '查看职责和关系，不自动重画设计基线。', files: [] }],
      edges: [{ from: 'canvas', to: 'intent', label: '展示计划职责' }]
    };
    await saveProposal(designProposal);
    await refresh(designPage);
    assert.equal(await designPage.locator('.architecture-node').count(), 2);
    const savedAscii = (await designSnapshot()).draft.ascii;
    assert.ok((await designSnapshot()).draft.proposal.document.includes('```text\n' + savedAscii));
    await designPage.locator('#design-ascii-section > summary').click();
    assert.equal(await designPage.locator('#design-ascii').textContent(), savedAscii);
    for (const n of designProposal.nodes) assert.ok(savedAscii.includes(`[${n.id}]`));
    assert.ok(savedAscii.includes('[canvas] -- 展示计划职责 --> [intent]'));
    assert.equal(await designPage.locator('#design-ascii img').count(), 0);
    assert.equal(await designPage.locator('#design-ascii').evaluate(el => getComputedStyle(el).whiteSpace), 'pre');
    await designPage.locator('#show-workflow').click();
    assert.equal(await designPage.locator('#design-ascii-section').isVisible(), false);
    await designPage.locator('#show-design').click();
    assert.equal(await designPage.locator('#design-ascii').textContent(), savedAscii);
    await capture(designPage, 'ascii-design-draft');
    await designPage.locator('.design-document-details summary').click();
    assert.match(await designPage.locator('#design-document').textContent(), /<img/);
    assert.equal(await designPage.locator('#design-document img').count(), 0);
    assert.equal(await designPage.evaluate(() => window.designInjected), undefined);
    await designPage.locator('#design-review').click();
    await designPage.locator('#design-reviewer').fill('Human browser fixture');
    await designPage.locator('#design-conclusion').fill('已审阅方案、图和范围；确认不代表代码实施授权。');
    await designPage.locator('#design-reviewed').check();
    await designPage.screenshot({ path: path.join(output, 'state-design-confirm.png'), fullPage: false }); shots++;
    await designPage.locator('#design-confirm-submit').click();
    await confirm(designPage, false);
    assert.equal((await designSnapshot()).baseline, null);
    await designPage.locator('#design-confirm-submit').click();
    await confirm(designPage);
    const firstBaseline = (await designSnapshot()).baseline;
    assert.equal(firstBaseline.number, 1);
    assert.equal(await designPage.locator('#design-version').inputValue(), 'baseline');
    behaviorReport.passed('design-first-baseline');
    const storedDesign = await fs.readFile(path.join(roots[0], '.governance/architecture-design.json'), 'utf8');
    await refresh(designPage);
    await mutate({ action: 'board_update', id: raceId, title: 'Ordinary internal update' });
    await refresh(designPage);
    assert.equal(await fs.readFile(path.join(roots[0], '.governance/architecture-design.json'), 'utf8'), storedDesign);
    await designPage.locator('#design-begin').click();
    await designPage.locator('#design-reason').fill('职责调整：证据模块独立，不改变项目授权。');
    await designPage.locator('#design-begin-submit').click();
    await confirm(designPage);
    assert.deepEqual((await designSnapshot()).baseline, firstBaseline);
    const revised = JSON.parse(JSON.stringify(designProposal));
    revised.document = '## 用途\n保留稳定设计，显式修订关键职责。\n## 决定\n证据职责独立，代价是增加一个模块；不增加网络服务。';
    revised.nodes.push({ id: 'evidence', title: '验证证据', description: '只报告实际场景结果，不自动批准或认证身份。', files: [] });
    revised.edges.push({ from: 'canvas', to: 'evidence', label: '展示实际结果' });
    await saveProposal(revised); await refresh(designPage);
    assert.equal(await designPage.locator('#design-version').inputValue(), 'baseline', 'Revision cannot silently replace baseline canvas');
    assert.equal(await designPage.locator('.architecture-node').count(), 2);
    await designPage.locator('#design-version').selectOption('draft');
    assert.equal(await designPage.locator('.architecture-node').count(), 3);
    assert.ok((await designPage.locator('#design-ascii').textContent()).includes('[canvas] -- 展示实际结果 --> [evidence]'));
    assert.equal((await designPage.locator('#design-document').textContent()).includes('governance:architecture-ascii:'), false);
    await designPage.locator('#design-diff-details > summary').click();
    assert.match(await designPage.locator('#design-diff').textContent(), /evidence/);
    await capture(designPage, 'design-revision');
    await designPage.locator('#design-review').click();
    await designPage.locator('#design-reviewer').fill('Human browser fixture');
    await designPage.locator('#design-conclusion').fill('明确确认第二版，保留第一版。');
    await designPage.locator('#design-reviewed').check();
    await designPage.locator('#design-confirm-submit').click(); await confirm(designPage);
    assert.equal((await designSnapshot()).baseline.number, 2);
    assert.deepEqual((await designSnapshot()).history[0], firstBaseline);
    await designPage.locator('#design-version').selectOption('1');
    assert.equal(await designPage.locator('.architecture-node').count(), 2);
    assert.equal(await designPage.locator('#design-ascii').textContent(), firstBaseline.ascii);
    assert.equal(await designPage.locator('#design-review').isDisabled(), true);
    await designPage.locator('#design-version').selectOption('baseline');
    for (const width of [390, 768, 1280]) for (const theme of ['light', 'dark']) {
      await designPage.setViewportSize({ width, height: 1000 }); await sendAppearance(designPage, { base: theme });
      assert.equal(await designPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Design must fit narrow screens');
      await capture(designPage, `design-${width}-${theme}`);
    }
    behaviorReport.passed('design-ascii-view');
    behaviorReport.passed('design-explicit-revision');
    await designPage.setViewportSize({ width: 1280, height: 1000 });
    await designPage.locator('#design-begin').click();
    await designPage.locator('#design-reason').fill('This draft must remain in project A.');
    root = roots[1];
    await designPage.evaluate(path => window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } })), root);
    await settled(designPage);
    assert.equal(await designPage.locator('#design-begin-dialog').evaluate(el => el.open), false);
    assert.equal(await designPage.locator('.architecture-node').count(), 0);
    assert.equal(await designPage.locator('#design-ascii-section').isVisible(), false);
    assert.equal((await designPage.locator('#design-ascii').textContent()).includes('[canvas]'), false);
    assert.equal((await new Governance(root).run({ action: 'architecture_design_snapshot' })).baseline, null);
    root = roots[0];
    await designPage.evaluate(path => window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } })), root);
    await settled(designPage);
    delayedDesignRoot = roots[0];
    await designPage.locator('#refresh').click();
    const designDeadline = Date.now() + 5000;
    while (!releaseDesign && Date.now() < designDeadline) await designPage.waitForTimeout(10);
    assert.equal(typeof releaseDesign, 'function');
    root = roots[1];
    await designPage.evaluate(path => window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } })), root);
    await settled(designPage); delayedDesignRoot = null; releaseDesign();
    await designPage.waitForTimeout(80);
    assert.equal(await designPage.locator('.architecture-node').count(), 0, 'Late A design cannot populate B canvas');
    assert.equal(await designPage.locator('#design-review').isDisabled(), true);
    assert.deepEqual((await new Governance(roots[0]).run({ action: 'architecture_design_snapshot' })).baseline.number, 2);
    root = roots[0]; await designPage.close();
    behaviorReport.passed('design-workspace-isolation');
    // Independent history fixture: the existing three-done scenarios above stay unchanged.
    {
    root = roots[3];
    const historyGovernance = new Governance(root);
    await historyGovernance.run({ action: 'init' });
    await historyGovernance.run({ action: 'start', id: 'history', goal: 'Completed history fixture', criteria: ['History stays intact'] });
    const historySnapshot = () => historyGovernance.run({ action: 'project_snapshot' });
    for (let index = 0; index < 10; index++) {
      await historyGovernance.run({ action: 'board_create', id: `history-${index}`,
        title: index === 0 ? 'Older <img src=x onerror=alert(1)> record' : `Completed fixture ${index}`,
        description: `History fixture ${index}`, criteria: [`criterion-${index}`, 'Second check'],
        architectureImpact: index % 2 ? 'affects' : 'none', expectedRevision: (await historySnapshot()).revision });
    }
    const historyBoardPath = path.join(root, '.governance/board.json');
    const historyBoard = JSON.parse(await fs.readFile(historyBoardPath, 'utf8'));
    const dates = ['2019-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', '2022-01-01T00:00:00.000Z',
      '2024-01-01T00:00:00.000Z', '2023-01-01T00:00:00.000Z'];
    historyBoard.updatedAt = '2030-01-01T00:00:00.000Z';
    historyBoard.items.forEach((item, index) => {
      item.stage = index === 9 ? 'doing' : index === 5 ? 'accepted' : 'done';
      if (index < dates.length) item.completedAt = dates[index];
      if (index === 5) item.acceptance = { method: 'human', passed: true, valid: true,
        itemFingerprint: itemFingerprint(item), at: '2021-01-01T00:00:00.000Z',
        reviewer: 'Historical fixture', conclusion: 'Old record', evidence: 'Fixture only', criteria: item.criteria };
    });
    await historyGovernance.write('.governance/board.json', JSON.stringify(historyBoard, null, 2) + '\n');
    const historyRaw = await fs.readFile(historyBoardPath, 'utf8'), historyRevision = (await historySnapshot()).revision;
    const writesBeforeHistory = boardWrites.length;
    const historyPage = await makePage();
    await settled(historyPage);
    await historyPage.locator('a[href="#board-section"]').click();
    const doneIds = () => historyPage.locator('[data-stage="done"] [data-workitem]').evaluateAll(cards => cards.map(card => card.dataset.workitem));
    const rowIds = () => historyPage.locator('#completed-history-body tr').evaluateAll(rows => rows.map(row => row.dataset.historyItem));
    assert.deepEqual(await doneIds(), ['history-1', 'history-3', 'history-4', 'history-2', 'history-5']);
    assert.equal(await historyPage.locator('[data-stage="done"] .column-count').textContent(), '9');
    assert.match(await historyPage.locator('[data-stage="done"] .completed-summary').first().textContent(), /5.*9/);
    await card(historyPage, 'history-1').click();
    await historyPage.locator('#item-next').click();
    assert.equal(await historyPage.locator('#item-record-id').textContent(), 'history-3', 'Card navigation follows displayed recent order');
    await historyPage.keyboard.press('Escape');
    await historyPage.locator('#completed-history-open').focus();
    await historyPage.keyboard.press('Enter');
    assert.equal(await historyPage.locator('#completed-history-search').evaluate(el => el === document.activeElement), true);
    assert.deepEqual(await rowIds(), ['history-1', 'history-3', 'history-4', 'history-2', 'history-5', 'history-0', 'history-6', 'history-7', 'history-8']);
    assert.match(await historyPage.locator('[data-history-item="history-5"] td').nth(1).textContent(), /2021.*历史记录日期/);
    for (const id of ['history-6', 'history-7', 'history-8'])
      assert.equal(await historyPage.locator(`[data-history-item="${id}"] td`).nth(1).textContent(), '未记录');
    assert.equal(await historyPage.locator('#completed-history-body img').count(), 0, 'Titles render as text, never HTML');
    assert.match(await historyPage.locator('[data-history-item="history-0"] td').nth(2).textContent(), /2.*criterion-0/);
    assert.match(await historyPage.locator('[data-history-item="history-1"] td').nth(3).textContent(), /影响架构/);
    assert.equal((await historyPage.locator('#completed-history-body').textContent()).includes('2030'), false);
    await historyPage.locator('#completed-history-search').fill('criterion-0');
    assert.deepEqual(await rowIds(), ['history-0']);
    await historyPage.locator('[data-history-item="history-0"] button').click();
    assert.equal(await historyPage.locator('dialog[open]').count(), 1, 'History closes before details open');
    assert.equal(await historyPage.locator('#item-record-id').textContent(), 'history-0');
    assert.equal(await historyPage.locator('#item-next').isDisabled(), true, 'Details navigation uses table search results');
    await historyPage.keyboard.press('Escape');
    assert.equal(await historyPage.locator('#completed-history-open').evaluate(el => el === document.activeElement), true);
    await historyPage.locator('#board-search').fill('Completed fixture');
    assert.equal((await doneIds()).length, 8, 'Global board search bypasses the recent-five limit');
    assert.equal(await card(historyPage, 'history-8').getAttribute('draggable'), 'false');
    await historyPage.locator('#completed-history-open').click();
    assert.deepEqual(await rowIds(), ['history-0'], 'Table search is independent of global search');
    await historyPage.locator('#completed-history-search').fill('');
    await historyPage.locator('[data-history-item="history-0"] button').click();
    await historyPage.locator('#item-next').click();
    assert.equal(await historyPage.locator('#item-record-id').textContent(), 'history-6');
    await historyPage.keyboard.press('Escape');
    await historyPage.locator('#board-search').fill('');
    await historyPage.locator('#completed-history-open').click();
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
    await historyPage.keyboard.press('Tab');
    assert.equal(await historyPage.evaluate(() => !!document.activeElement.closest('#completed-history-dialog')), true, 'Keyboard focus stays in the dialog');
    await historyPage.keyboard.press('Escape');
    await historyPage.setViewportSize({ width: 1280, height: 1000 });
    await historyPage.evaluate(() => lock(true));
    assert.equal(await historyPage.locator('#completed-history-open').isDisabled(), false);
    await historyPage.locator('#completed-history-open').click();
    await historyPage.locator('#completed-history-search').fill('Older');
    await historyPage.locator('[data-history-item="history-0"] button').click();
    await historyPage.keyboard.press('Escape');
    await historyPage.evaluate(() => lock(false));
    await historyPage.context().setOffline(true);
    await historyPage.locator('#completed-history-open').click();
    assert.equal(await historyPage.locator('#completed-history-search').isDisabled(), false);
    await historyPage.locator('[data-history-item="history-0"] button').click();
    assert.equal(await historyPage.locator('#item-edit').isDisabled(), true);
    await historyPage.keyboard.press('Escape');
    await historyPage.context().setOffline(false);
    await historyPage.waitForFunction(() => navigator.onLine);
    assert.equal(await fs.readFile(historyBoardPath, 'utf8'), historyRaw, 'Rendering/search/view/offline cannot write or migrate history');
    assert.equal((await historySnapshot()).revision, historyRevision);
    assert.equal(boardWrites.length, writesBeforeHistory);
    await historyPage.locator('#completed-history-open').click();
    await historyPage.locator('[data-history-item="history-0"] button').click();
    await historyPage.locator('#item-edit').click();
    await historyPage.locator('#workitem-title').fill('Older edited record');
    await historyPage.locator('#workitem-save').click(); await confirm(historyPage);
    assert.equal((await historySnapshot()).board.items.find(item => item.id === 'history-0').title, 'Older edited record');
    await historyPage.locator('#board-search').fill('Older edited');
    await card(historyPage, 'history-0').click({ button: 'right' });
    await historyPage.locator('#item-menu').getByRole('menuitem', { name: '移至正在进行', exact: true }).click();
    await confirm(historyPage);
    assert.equal((await historySnapshot()).board.items.find(item => item.id === 'history-0').stage, 'doing');
    await historyPage.locator('#board-search').fill('');
    const dragWrites = boardWrites.length;
    await card(historyPage, 'history-1').dragTo(card(historyPage, 'history-3'));
    assert.equal(boardWrites.length, dragWrites, 'Sorted done view cannot send ambiguous reordering positions');
    assert.equal(await historyPage.locator('#confirm-dialog').evaluate(el => el.open), false);
    const countBeforeDrop = (await historySnapshot()).board.items.filter(item => item.stage === 'done').length;
    await card(historyPage, 'history-9').dragTo(card(historyPage, 'history-3'));
    await confirm(historyPage);
    assert.equal(boardWrites.at(-1).args.position, countBeforeDrop, 'Incoming done drop appends against the whole saved column');
    assert.equal((await historySnapshot()).board.items.filter(item => item.stage === 'done').at(-1).id, 'history-9');
    await card(historyPage, 'history-1').dragTo(historyPage.locator('[data-stage="doing"]'), { targetPosition: { x: 30, y: 30 } });
    await confirm(historyPage);
    assert.equal((await historySnapshot()).board.items.find(item => item.id === 'history-1').stage, 'doing', JSON.stringify(boardWrites.at(-1)) + ' · ' + await historyPage.locator('#notice-message').textContent());
    await historyPage.locator('#board-search').fill('Completed fixture');
    await historyPage.evaluate(() => {
      draggedItem = 'history-3';
      document.querySelector('[data-stage="doing"]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
    });
    assert.equal(await historyPage.locator('#confirm-dialog').evaluate(el => el.open), false, 'Filtered drop has no hidden-anchor writes');
    await historyPage.locator('#board-search').fill('');
    await historyPage.locator('#completed-history-open').click();
    await historyPage.locator('#completed-history-search').fill('criterion-5');
    root = roots[1];
    await historyPage.evaluate(path => window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } })), root);
    await settled(historyPage);
    assert.equal(await historyPage.locator('#completed-history-dialog').evaluate(el => el.open), false);
    assert.equal(await historyPage.locator('#completed-history-search').inputValue(), '');
    assert.equal(await historyPage.locator('#completed-history-body tr').count(), 0);
    root = roots[3];
    await historyPage.evaluate(path => window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } })), root);
    await settled(historyPage);
    delayedSnapshotRoot = roots[3];
    releaseSnapshot = null;
    await historyPage.locator('#refresh').click();
    const historyDeadline = Date.now() + 5000;
    while (!releaseSnapshot && Date.now() < historyDeadline) await historyPage.waitForTimeout(10);
    assert.equal(typeof releaseSnapshot, 'function');
    root = roots[1];
    await historyPage.evaluate(path => window.dispatchEvent(new CustomEvent('test-workspace', { detail: { path } })), root);
    await settled(historyPage); delayedSnapshotRoot = null; releaseSnapshot();
    await historyPage.waitForTimeout(80);
    await historyPage.locator('#completed-history-open').click();
    assert.equal((await historyPage.locator('#completed-history-body').textContent()).includes('Completed fixture'), false, 'Late foreign results cannot repopulate history');
    await historyPage.keyboard.press('Escape');
    await historyPage.close(); root = roots[0];
    }
    assert.deepEqual(errors, []);
    behaviorReport.finish(true);
    console.log(
      `PASS object workbench: menus, search, sheet, drafts, long press, keyboard, offline/error/stale/workspace guards, theme and chrome; ${shots} screenshots: ${output}`
    );
  } finally {
    await browser.close();
    await Promise.all(
      roots.map((dir) =>
        fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      )
    );
  }
})().catch((e) => {
  behaviorReport.finish(false);
  console.error(e);
  process.exitCode = 1;
});
