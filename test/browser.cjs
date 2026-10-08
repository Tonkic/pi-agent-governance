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
const hostCalls = [];
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
    [1, 2].map(() => fs.mkdtemp(path.join(base, 'workbench-browser-')))
  );
  let root = roots[0],
    holdGit = false,
    releaseGit,
    failProject = false,
    failSnapshot = false;
  const g = new Governance(root);
  for (const dir of roots) await new Governance(dir).run({ action: 'init' });
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
      if (channel === 'app.getLocale') return locale;
      if (channel === 'app.getAppearance') return { base: 'light' };
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
              ? await operationInvoke(root, payload, desktop, async () => true, models)
              : await panelInvoke(root, channel, payload)
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
    // Default is object workbench, with no permanently visible item editor or KPI wall.
    assert.equal(await page.locator('#board-section').isVisible(), true);
    assert.equal(await page.locator('#workitem-form').isVisible(), false);
    assert.equal(await page.locator('.metrics').count(), 0);
    assert.equal(await page.locator('.workspace-nav a').count(), 3);
    assert.equal(await page.locator('#project-dialog').evaluate((el) => el.open), false);
    assert.equal(await page.locator('.board-column').count(), 4);
    assert.equal(await page.locator('#board-section #task-section').count(), 0);
    for (const id of ['architecture', 'git-section', 'board-section']) {
      await navigate(page, id);
      assert.equal(await page.locator('#action-panel').isVisible(), true);
      assert.equal(await page.locator('#board-new').isVisible(), id === 'board-section');
      assert.equal(await page.locator('#architecture-analyze').isVisible(), id === 'architecture');
      assert.equal(await page.locator('#show-workflow').isVisible(), id === 'architecture');
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
    const second = await create('Polish architecture canvas');
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
      'Desktop board starts as one row of four columns'
    );
    await card(page, first).click();
    const openedGeometry = await boardGeometry();
    assert.deepEqual(
      openedGeometry,
      beforeDetails,
      'Opening item details must not resize or reflow the four-column board'
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
    // Human review records criteria/evidence; cancellation retains the form, edits invalidate acceptance.
    await card(page, first).getByRole('button', { name: '人工验收', exact: true }).click();
    await page.locator('#accept-reviewer').fill('Fixture human');
    await page.locator('#accept-conclusion').fill('Keyboard return checked');
    await page.locator('#accept-evidence').fill('Real browser focus assertions passed');
    await page.keyboard.press('Escape');
    await confirm(page, false);
    assert.equal(await page.locator('#accept-dialog').evaluate((el) => el.open), true);
    assert.equal(await page.locator('#item-sheet').evaluate((el) => el.open), true);
    assert.equal(
      await page.locator('#accept-evidence').inputValue(),
      'Real browser focus assertions passed'
    );
    await page.locator('#accept-form button[type="submit"]').click();
    assert.equal(
      await page.locator('#confirm-dialog').evaluate((el) => el.open),
      false,
      'Unchecked criteria block passing review'
    );
    await page.locator('#accept-criteria input').check();
    await capture(page, 'human-review');
    await page.locator('#accept-form button[type="submit"]').click();
    await confirm(page, false);
    assert.equal(
      await page.locator('#accept-evidence').inputValue(),
      'Real browser focus assertions passed'
    );
    assert.equal((await snapshot()).board.items.find((i) => i.id === first).stage, 'done');
    await page.locator('#accept-form button[type="submit"]').click();
    await confirm(page);
    assert.equal((await snapshot()).board.items.find((i) => i.id === first).stage, 'accepted');
    await card(page, first).click();
    assert.match(await page.locator('#item-review-record').textContent(), /Fixture human/);
    await close(page);
    await menu(page, first, '编辑');
    await page
      .locator('#workitem-description')
      .fill('Check search, object details and keyboard return. Revised.');
    await page.locator('#workitem-save').click();
    await confirm(page);
    let reviewItem = (await snapshot()).board.items.find((i) => i.id === first);
    assert.equal(reviewItem.stage, 'done');
    assert.equal(reviewItem.acceptance.valid, false);
    await card(page, first).getByRole('button', { name: '人工验收', exact: true }).click();
    await page.locator('#accept-result').selectOption('fail');
    await page.locator('#accept-reviewer').fill('Fixture human');
    await page.locator('#accept-conclusion').fill('Need another check');
    await page.locator('#accept-evidence').fill('A criterion was not verified');
    await page.locator('#accept-form button[type="submit"]').click();
    await confirm(page);
    assert.equal((await snapshot()).board.items.find((i) => i.id === first).stage, 'doing');
    await menu(page, first, '移至已完成');
    await confirm(page);
    // Public desktop operations are simulated. Settled turns alone never mutate board acceptance.
    const beforeAgent = hostCalls.length;
    await card(page, first).getByRole('button', { name: 'Agent 验收', exact: true }).click();
    await confirm(page, false);
    assert.equal(hostCalls.length, beforeAgent);
    await card(page, first).getByRole('button', { name: 'Agent 验收', exact: true }).click();
    await confirm(page);
    await page.waitForSelector('.operation-run');
    await capture(page, 'agent-progress');
    assert.match(
      hostCalls.findLast((c) => c.operation === 'agent/prompt').args[0].content,
      /board_accept/
    );
    await page.getByRole('button', { name: '查看进度 / 结果', exact: true }).click();
    await settled(page);
    assert.match(await page.locator('#operation-result').textContent(), /Fixture analysis output/);
    hostStreaming = false;
    await page.getByRole('button', { name: '查看进度 / 结果', exact: true }).click();
    await settled(page);
    assert.equal((await snapshot()).board.items.find((i) => i.id === first).stage, 'done');
    await page.locator('#operations-close').click();
    // Simulate the Agent's explicit evidence submission, rather than a frontend auto-pass.
    reviewItem = (await snapshot()).board.items.find((i) => i.id === first);
    await mutate({
      action: 'board_accept',
      id: first,
      expectedItem: reviewItem.itemFingerprint,
      method: 'agent',
      passed: true,
      accepted: [true],
      reviewer: 'Fixture Agent',
      conclusion: 'Criterion checked',
      evidence: 'Isolated browser checks, no physical-host claim'
    });
    await refresh(page);
    assert.equal(
      await page.locator(`[data-stage="accepted"] [data-workitem="${first}"]`).count(),
      1
    );
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
    await page.getByRole('button', { name: '取消任务', exact: true }).click();
    await confirm(page, false);
    assert.equal(hostCalls.at(-1).operation, 'agent/prompt');
    await page.getByRole('button', { name: '取消任务', exact: true }).click();
    await confirm(page);
    assert.equal(hostCalls.at(-1).operation, 'agent/abort');
    await page.locator('#operations-close').click();
    await navigate(page, 'architecture');
    await page.locator('#architecture-analyze').click();
    await page.waitForFunction(() => !document.querySelector('#launch-model').disabled);
    await page.locator('#launch-model').selectOption('fixture/reasoning');
    await page.locator('#launch-thinking').selectOption('high');
    await confirm(page);
    assert.match(
      hostCalls.findLast((c) => c.operation === 'agent/prompt').args[0].content,
      /architecture_sources/
    );
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
    assert.equal(await page.locator('[data-workitem]').count(), 2);
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
    assert.equal(await page.locator('#graph-warning').isVisible(), true);
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
          await p.screenshot({
            path: path.join(output, `${lang}-launch-${width}-${theme}.png`),
            fullPage: true
          });
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
          await p.screenshot({
            path: path.join(output, `${lang}-modal-${width}-${theme}.png`),
            fullPage: true
          });
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
      await p.screenshot({ path: path.join(output, `${lang}-details-1280.png`), fullPage: true });
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
    assert.deepEqual(errors, []);
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
  console.error(e);
  process.exitCode = 1;
});
