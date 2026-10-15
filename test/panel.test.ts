'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { panelInvoke } = require('../plugin/panel');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'panel-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const snapshot = () => panelInvoke(root, 'governance.snapshot');
  const mutate = async (args: any, revision?: string) => panelInvoke(root, 'governance.mutate', { args, revision: revision || (await snapshot()).revision, confirmed: true });
  return { root, snapshot, mutate };
}
const start = { action: 'start', id: 'panel-task', goal: 'Human approved goal', criteria: ['Pass'], scope: ['src/'], constraints: ['No push'] };
test('panel initializes, starts and updates using the existing core', async t => {
  const { root, snapshot, mutate } = await fixture(t);
  await fs.writeFile(path.join(root, 'README.md'), 'User content');
  assert.equal((await snapshot()).state, null);
  await mutate({ action: 'init' }); assert.equal((await snapshot()).state.status, 'idle');
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), 'User content');
  await mutate(start);
  await mutate({ action: 'progress', current: 'Done one step', next: ['Test'], blocked: [] });
  const s = (await snapshot()).state; assert.equal(s.current, 'Done one step'); assert.deepEqual(s.next, ['Test']);
  assert.deepEqual(s.constraints, ['No push']);
});
test('stale state and switched workspace cannot be overwritten', async t => {
  const a = await fixture(t), b = await fixture(t);
  await a.mutate({ action: 'init' }); await b.mutate({ action: 'init' });
  const old = await a.snapshot();
  await assert.rejects(b.mutate(start, old.revision), /过期|切换/);
  await a.mutate(start);
  await assert.rejects(a.mutate({ action: 'progress', current: 'stale', next: [], blocked: [] }, old.revision), /过期/);
  assert.equal((await a.snapshot()).state.current, start.goal);
});
test('panel refuses unconfirmed, unsupported and malformed operations', async t => {
  const { root, snapshot, mutate } = await fixture(t);
  const s = await snapshot();
  await assert.rejects(panelInvoke(root, 'governance.mutate', { args: { action: 'init' }, revision: s.revision }), /确认/);
  await assert.rejects(panelInvoke(root, 'governance.mutate', { confirmed: true, args: { action: 'init' } }), /刷新/);
  await assert.rejects(mutate({ action: 'git_commit' }), /not allowed/);
  await assert.rejects(mutate({ action: 'toString' }), /not allowed/);
  await assert.rejects(panelInvoke(root, 'arbitrary.channel'), /Unsupported/);
  await mutate({ action: 'init' });
  await assert.rejects(mutate({ ...start, criteria: [] }), /criteria/);
  assert.equal((await snapshot()).state.task, null);
});
test('malformed State is an error, not an initialization opportunity', async t => {
  const { root, snapshot } = await fixture(t);
  await fs.writeFile(path.join(root, 'STATE.json'), '{invalid');
  await assert.rejects(snapshot(), SyntaxError);
  await assert.rejects(panelInvoke(root, 'governance.git'), /git rev-parse failed/);
});
test('panel progress invalidates existing verification', async t => {
  const { root, snapshot, mutate } = await fixture(t);
  await mutate({ action: 'init' }); await mutate(start);
  const { Governance } = require('../plugin/core');
  await new Governance(root).run({ action: 'verify', passed: true, accepted: [true], evidence: 'Fixture checked', diffReview: 'Fixture checked', files: ['README.md'] });
  assert.equal((await snapshot()).state.status, 'verified');
  await mutate({ action: 'progress', current: 'Continue', next: [], blocked: [] });
  assert.equal((await snapshot()).state.status, 'working'); assert.equal((await snapshot()).state.verification, undefined);
});
test('renderer leads with architecture, removes promotional guide and keeps valid controls', async () => {
  const html = await fs.readFile(path.join(__dirname, '../plugin/renderer/index.html'), 'utf8');
  const script = await fs.readFile(path.join(__dirname, '../plugin/renderer/panel.js'), 'utf8');
  assert.doesNotMatch(html, /FIELD GUIDE|怎么使用这个项目|THE REPOSITORY IS THE MEMORY|每一次交接|hero-block|progress-fill/);
  assert.ok(html.indexOf('id="architecture"') < html.indexOf('id="task-section"'));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'IDs must be unique');
  assert.match(script, /history\.id = 'completed-history-open'/, 'The history opener is created with the done column');
  ids.push('completed-history-open');
  for (const match of script.matchAll(/(?:\$|text|list)\('([^']+)'/g)) assert.ok(ids.includes(match[1]), `Missing element ${match[1]}`);
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(match[1]), `Missing navigation target ${match[1]}`);
  assert.equal([...html.matchAll(/data-module="/g)].length, 0, 'No fixed plugin graph may masquerade as project data');
  for (const id of ['show-architecture', 'show-workflow', 'board-columns', 'workitem-form']) assert.ok(ids.includes(id));
  for (const file of ['graph-model.js', 'graph.js', 'panel.js']) assert.ok(html.includes(`src="../runtime/renderer/${file}"`));
  const graphScript = await fs.readFile(path.join(__dirname, '../plugin/renderer/graph.js'), 'utf8');
  for (const match of graphScript.matchAll(/get\('([^']+)'/g)) assert.ok(ids.includes(match[1]), `Missing graph control ${match[1]}`);
});
test('browser bundle starts without Node globals and reports static preview', async () => {
  const vm = require('node:vm');
  const script = await fs.readFile(path.join(__dirname, '../plugin/renderer/i18n.js'), 'utf8') + '\n' + await fs.readFile(path.join(__dirname, '../plugin/renderer/design.js'), 'utf8') + '\n' + await fs.readFile(path.join(__dirname, '../plugin/renderer/panel.js'), 'utf8');
  const elements = new Map();
  const document = {
    addEventListener() {}, documentElement: { dataset: {} }, querySelectorAll: () => [], querySelector: () => ({ hidden: false }),
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, { textContent: '', classList: { toggle() {} }, reset() {}, setAttribute() {}, addEventListener() {}, replaceChildren() {} });
      return elements.get(id);
    }
  };
  vm.runInNewContext(script, { document, navigator: { language: 'zh-CN' }, window: { addEventListener() {}, dispatchEvent() {} }, Event: class {}, CustomEvent: class { constructor(...args) {} }, location: { hash: '' }, matchMedia: () => ({ matches: false }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(elements.get('notice-message').textContent, /静态预览/);
  assert.equal(elements.get('progress-form').hidden, true);
  assert.equal(document.documentElement.dataset['base'], 'light');
});
async function graphModel() {
  const script = await fs.readFile(path.join(__dirname, '../plugin/renderer/graph-model.js'), 'utf8');
  return require('node:vm').runInNewContext(script + ';({get graphNodes(){return graphNodes}, get graphEdges(){return graphEdges}, setGraphData, graphReach, graphFit, graphZoom})');
}
test('architecture traces authored direction, terminals and cycles', async () => {
  const model = await graphModel();
  assert.equal(Object.keys(model.graphNodes).length, 0);
  model.setGraphData({ nodes: ['ui','agent','core','git','state','worktree'].map(id => ({id, title:id})), edges: [{from:'ui',to:'core'}, {from:'agent',to:'core'}, {from:'core',to:'git'}, {from:'core',to:'state'}, {from:'git',to:'worktree'}] });
  const { graphNodes, graphEdges, graphReach } = model;
  for (const edge of graphEdges) { assert.ok(graphNodes[edge.from]); assert.ok(graphNodes[edge.to]); }
  const sorted = values => Array.from(values).sort();
  assert.deepEqual(sorted(graphReach('core', 'upstream').nodes), ['agent', 'core', 'ui']);
  assert.deepEqual(sorted(graphReach('core', 'downstream').nodes), ['core', 'git', 'state', 'worktree']);
  assert.equal(graphReach('worktree', 'downstream').links.size, 0);
  assert.equal(graphReach('core', 'all').links.size, 5);
  assert.equal(graphReach('worktree', 'upstream').nodes.has('state'), false);
  const cycle = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }];
  assert.equal(graphReach('a', 'downstream', cycle).links.size, 2);
});
test('architecture camera fits narrow and wide screens, zoom anchors stay fixed', async () => {
  const { graphFit, graphZoom } = await graphModel();
  for (const width of [270, 390, 760, 1200]) {
    const v = graphFit(width, 430);
    assert.ok(v.x >= 0 && v.y >= 0);
    assert.ok(940 * v.scale <= width && 440 * v.scale <= 430);
  }
  const view = { scale: 1, x: 10, y: 20 }, zoom = graphZoom(view, 1.2, 100, 100);
  assert.equal((100 - zoom.x) / zoom.scale, (100 - view.x) / view.scale);
  assert.equal((100 - zoom.y) / zoom.scale, (100 - view.y) / view.scale);
  assert.equal(graphZoom(view, 100, 100, 100).scale, 2);
  assert.equal(graphZoom(view, .001, 100, 100).scale, .05);
});

test('dependency layout ranks chains, collapses cycles and separates disconnected modules', async () => {
  const model = await graphModel();
  const data = { nodes: ['a', 'b', 'c', 'd', 'alone'].map(id => ({ id })), edges: [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'b' },
    { from: 'c', to: 'd' }, { from: 'a', to: 'd' }, { from: 'alone', to: 'alone' }
  ] };
  model.setGraphData(data);
  const n = model.graphNodes;
  assert.ok(n.a.y < n.b.y); assert.equal(n.b.y, n.c.y); assert.ok(n.c.y < n.d.y);
  const nodes: any[] = Object.values(n);
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    assert.ok(Math.abs(nodes[i].x - nodes[j].x) >= 210 || Math.abs(nodes[i].y - nodes[j].y) >= 96);
  }
  for (const edge of model.graphEdges) assert.ok(!/NaN|undefined/.test(edge.path));
  assert.notEqual(model.graphEdges[1].path, model.graphEdges[2].path);
  assert.match(model.graphEdges[4].path, /H/); // Long dependency bypasses intermediate rows.
  const first = JSON.stringify(model.graphNodes);
  model.setGraphData(data); assert.equal(JSON.stringify(model.graphNodes), first);
  model.setGraphData({ nodes: [], edges: [] }); assert.equal(Object.keys(model.graphNodes).length, 0);
});
test('bilingual copy has equal keys and placeholders, valid DOM keys, and preserves interpolated user text', async () => {
  const vm = require('node:vm');
  const script = await fs.readFile(path.join(__dirname, '../plugin/renderer/i18n.js'), 'utf8');
  const html = await fs.readFile(path.join(__dirname, '../plugin/renderer/index.html'), 'utf8');
  for (const [hostLocale, browserLocale, expected] of [['en-US', 'zh-CN', 'en'], ['zh-CN', 'en-US', 'zh-CN'], [null, 'zh-CN', 'zh-CN'], ['fr-FR', 'zh-CN', 'en']]) {
    const document = { documentElement: {}, querySelectorAll: () => [] };
    const context = vm.createContext({ document, navigator: { language: browserLocale }, window: { pluginBridge: { invoke: async () => { if (hostLocale === null) throw Error('Unavailable'); return hostLocale; } } } });
    const api = vm.runInContext(script + ';({copy, t, ready: localeReady})', context);
    await api.ready;
    assert.equal(document.documentElement['lang'], expected);
    assert.deepEqual(Object.keys(api.copy.en).sort(), Object.keys(api.copy['zh-CN']).sort());
    for (const key of Object.keys(api.copy.en)) {
      const placeholders = value => [...value.matchAll(/\{\d+\}/g)].map(m => m[0]).sort();
      assert.deepEqual(placeholders(api.copy.en[key]), placeholders(api.copy['zh-CN'][key]), key);
    }
    for (const match of html.matchAll(/data-i18n(?:-aria-label|-placeholder)?="([^"]+)"/g)) assert.ok(api.copy.en[match[1]], match[1]);
    const userText = '<img src=x onerror=alert(1)> 工作项 {1}';
    assert.ok(api.t('blocker', userText).includes(userText), 'user text is not recursively translated or interpolated');
    assert.equal(api.t('cancel'), expected === 'en' ? 'Cancel' : '取消');
  }
  assert.doesNotMatch(script, /innerHTML/);
});
test('community manifest and distribution allowlist exclude credentials and old packages', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(__dirname, '../plugin/manifest.json'), 'utf8'));
  assert.equal(manifest.id, 'io.github.tonkic.agent-governance');
  for (const locale of ['en', 'zh-CN']) {
    for (const key of ['name', 'description', 'safetyNotes']) assert.ok(manifest.i18n[locale][key].trim());
    assert.ok(manifest.ui.title[locale].trim());
  }
  assert.equal(typeof manifest.contributes.commands[0].title, 'string', 'installer requires a plain command title');
  const { piFiles } = require('../../scripts/build-distributions.cjs');
  assert.equal(new Set(piFiles).size, piFiles.length);
  for (const file of piFiles) {
    assert.doesNotMatch(file, /(?:^|\/)(?:\.\.|\.secrets|dist)(?:\/|$)|\.token$/);
    assert.ok((await fs.stat(path.join(__dirname, '../../plugin', file))).isFile());
  }
});

test('item details use a modal and cannot shrink the board through open-state CSS', async () => {
  const script = await fs.readFile(path.join(__dirname, '../plugin/renderer/panel.js'), 'utf8');
  const css = await fs.readFile(path.join(__dirname, '../../plugin/renderer/views.css'), 'utf8');
  assert.match(script, /\$\('item-sheet'\)\.showModal\(\)/);
  assert.doesNotMatch(css, /body:has\(#item-sheet/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
});

test('real plugin entry rereads workspace and refuses an explicitly bound foreign project', async t => {
  const a = await fixture(t), b = await fixture(t);
  await a.mutate({ action: 'init' });
  const main = path.join(__dirname, '../plugin/main.js');
  const vm = require('node:vm'), { createRequire } = require('node:module');
  let workspace = { path: a.root };
  const module = { exports: {} as any };
  const context = { require: createRequire(main), module, exports: module.exports,
    pi: { workspace: { get: async () => workspace }, app: { getLocale: async () => 'en' } } };
  vm.runInNewContext(await fs.readFile(main, 'utf8'), context);
  const invoke = module.exports.onPanelInvoke;
  const old = await invoke('governance.snapshot');
  assert.equal(old.result.workspace, a.root);
  workspace = { path: b.root };
  const fresh = await invoke('governance.snapshot');
  assert.equal(fresh.result.workspace, b.root);
  assert.equal(fresh.result.state, null);
  const refused = await invoke('governance.mutate', { workspace: a.root,
    args: { action: 'init' }, revision: fresh.result.revision, confirmed: true });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Workspace switched/);
  assert.deepEqual(await fs.readdir(b.root), []);
});

// Exercise the compiled renderer functions, not the backend mutation seam.
async function rendererSeam(start: string, end: string, context: any) {
  const script = await fs.readFile(path.join(__dirname, '../plugin/renderer/panel.js'), 'utf8');
  const from = script.indexOf(start), to = script.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, 'Renderer seam boundaries must exist');
  return require('node:vm').runInNewContext(script.slice(from, to) + `;(${start.match(/function (\w+)/)[1]})`, context);
}
test('renderer operation writes reject offline entry and offline confirmation; reads remain available', async () => {
  for (const action of ['cancel', 'resolve', 'status', 'open']) {
    for (const offlineAtConfirmation of [false, true]) {
      const calls = [], prompts = [];
      const navigator = { onLine: offlineAtConfirmation };
      const context = { busy: false, workspaceEpoch: 1, navigator, lock() {}, t: key => key,
        notify() {}, text() {}, loadOperations: async () => {},
        confirmWrite: async () => { prompts.push(action); navigator.onLine = false; return true; },
        invoke: async (_channel, payload) => { calls.push(payload); return { run: {}, runtime: {}, session: {} }; } };
      const operation = await rendererSeam('async function operationAction(', 'async function loadOperations(', context);
      await operation(action, 'fixture');
      const write = ['cancel', 'resolve'].includes(action);
      assert.equal(calls.length, write ? 0 : 1, `${action}: offline writes must never reach the bridge`);
      assert.equal(prompts.length, write && offlineAtConfirmation ? 1 : 0, 'Offline entry must not prompt');
    }
  }
});
test('renderer operation buttons honor offline state both on render and on unlock', async () => {
  const elements = new Map();
  const element = () => ({ disabled: false, children: [], append(...children) { this.children.push(...children); },
    addEventListener() {}, replaceChildren() { this.children = []; } });
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const document = { createElement: element, querySelectorAll: selector => {
    const buttons = $('operation-runs').children.flatMap(row => row.children.filter(child => child.type === 'button'));
    return selector.includes('data-operation-write') ? buttons.filter(button => button.dataset?.operationWrite) :
      selector.startsWith('main button') ? buttons : [];
  } };
  // Real DOM buttons have a dataset; keep that property on this minimal seam too.
  document.createElement = () => ({ ...element(), dataset: {} });
  const context = { $, document, busy: false, workspaceEpoch: 1, navigator: { onLine: false },
    snapshot: { workspace: 'fixture' }, projectSnapshot: null, editingItem: null,
    searchQuery: '', t: key => key, operationLabel: key => key, labels: {}, text() {},
    updateLaunchControls() {}, updateItemNavigation() {}, updateDesignControls() {},
    invoke: async () => ({ workspace: 'fixture', runs: [
      { id: 'unknown', kind: 'analysis', phase: 'unknown' },
      { id: 'running', kind: 'analysis', phase: 'running', sessionId: 'session' }
    ] }) };
  const load = await rendererSeam('async function loadOperations(', "$('documentation-start')", context);
  await load();
  const buttons = $('operation-runs').children.flatMap(row => row.children.filter(child => child.type === 'button'));
  const assertButtons = () => assert.deepEqual(buttons.map(button => !!button.disabled), [false, false, true, true]);
  assertButtons();
  const lock = await rendererSeam('function lock(', 'async function invoke(', context);
  lock(true); assert.ok(buttons.every(button => button.disabled));
  lock(false); assertButtons();
  context.navigator.onLine = true; lock(false); assert.ok(buttons.every(button => !button.disabled));
});
test('workflow graph clears architecture source-check status on repeated switching', async () => {
  const values = new Map(), elements = new Map();
  const context = { snapshot: { state: { status: 'working' } }, graphView: 'architecture',
    projectSnapshot: { architecture: { title: 'fixture', sourcesChecked: true, checkedAt: 'today', nodes: [], edges: [] } },
    text: (id, value) => values.set(id, value), t: key => key, labels: {},
    $: id => { if (!elements.has(id)) elements.set(id, { setAttribute() {} }); return elements.get(id); },
    renderDesign() {}, window: { dispatchEvent() {} }, CustomEvent: class {} };
  const render = await rendererSeam('function renderProjectGraph(', "$('show-architecture').addEventListener", context);
  for (let i = 0; i < 2; i++) {
    context.graphView = 'architecture'; render(); assert.equal(values.get('graph-check-state'), 'sourcesChecked');
    context.graphView = 'workflow'; render(); assert.equal(values.get('graph-check-state'), '');
  }
});

test('three-stage renderer folds accepted snapshots into done without mutating history', async () => {
  const script = await fs.readFile(path.join(__dirname, '../plugin/renderer/panel.js'), 'utf8');
  const from = script.indexOf('const boardStages ='), to = script.indexOf('const boardLabels =', from);
  assert.ok(from >= 0 && to > from);
  const { stages, effective } = require('node:vm').runInNewContext(script.slice(from, to) + ';({stages: boardStages, effective: effectiveStage})');
  assert.deepEqual(Array.from(stages), ['todo', 'doing', 'done']);
  for (const stage of ['todo', 'doing', 'done', 'accepted']) {
    const item = Object.freeze({ stage, acceptance: Object.freeze({ evidence: 'Legacy fixture only' }) });
    assert.equal(effective(item), stage === 'accepted' ? 'done' : stage);
    assert.equal(item.stage, stage, 'Effective display must not rewrite the snapshot');
  }
  assert.doesNotMatch(script, /board_accept|accept-form|accept-dialog|humanAcceptance|agentAcceptance|openHumanReview|card-review-actions/);
  assert.match(script, /legacyAcceptanceTask/);
  const html = await fs.readFile(path.join(__dirname, '../plugin/renderer/index.html'), 'utf8');
  assert.match(html, /<details id="item-history" hidden>/);
  assert.match(html, /id="item-checks"><h3 data-i18n="checks"/);
  assert.doesNotMatch(html, /accept-dialog|accept-form|item-human-review|item-agent-review/);
  const css = await fs.readFile(path.join(__dirname, '../../plugin/renderer/views.css'), 'utf8');
  assert.doesNotMatch(css, /data-stage=['"]accepted|card-review-actions|review-button|accept-dialog|criterion-check/);
});
test('renderer cannot launch new acceptance operations, even programmatically', async () => {
  const start = await rendererSeam('async function startOperation(', "$('launch-model').addEventListener", {});
  // No DOM or bridge context: a legacy kind must return before touching either.
  await start('acceptance');
});

test('completed history sorts dated records descending and leaves untimed history in saved order without mutation', async () => {
  const script = await fs.readFile(path.join(__dirname, '../plugin/renderer/panel.js'), 'utf8');
  const from = script.indexOf('function completedDate('), to = script.indexOf('const boardLabels =', from);
  assert.ok(from >= 0 && to > from);
  const { date, sorted } = require('node:vm').runInNewContext(script.slice(from, to) + ';({date: completedDate, sorted: completedItems})', {
    effectiveStage: item => item.stage === 'accepted' ? 'done' : item.stage
  });
  const items = [
    { id: 'untimed-a', stage: 'done', updatedAt: '2099-01-01T00:00:00Z' },
    { id: 'old', stage: 'done', completedAt: '2020-01-01T00:00:00Z' },
    { id: 'untimed-b', stage: 'done', completedAt: 'not a date', acceptance: { at: 'also invalid' } },
    { id: 'legacy', stage: 'accepted', acceptance: { at: '2021-01-01T00:00:00Z' } },
    { id: 'new', stage: 'done', completedAt: '2022-01-01T00:00:00Z', acceptance: { at: '2030-01-01T00:00:00Z' } },
    { id: 'doing', stage: 'doing', completedAt: '2099-01-01T00:00:00Z' },
    { id: 'tie', stage: 'done', completedAt: '2022-01-01T00:00:00Z' }
  ];
  const before = JSON.stringify(items);
  items.forEach(Object.freeze); Object.freeze(items);
  assert.deepEqual(Array.from(sorted(items), (item: any) => item.id), ['new', 'tie', 'legacy', 'old', 'untimed-a', 'untimed-b']);
  assert.equal(date(items[0]), null, 'Never infer completed time from updatedAt');
  assert.equal(date(items[2]), null, 'Invalid dates stay untimed');
  assert.equal(date(items[3]).legacy, true, 'Acceptance fallback must be explicitly historical');
  assert.equal(date(items[4]).value, items[4].completedAt, 'Completion timestamp takes precedence');
  assert.equal(JSON.stringify(items), before);
});
test('history table rendering/search is text-only and has no write or bridge calls', async () => {
  const script = await fs.readFile(path.join(__dirname, '../plugin/renderer/panel.js'), 'utf8');
  const from = script.indexOf('function renderCompletedHistory('), to = script.indexOf('function openCompletedHistory(', from);
  const render = script.slice(from, to);
  assert.match(render, /textContent = value/);
  assert.match(render, /historyOwner !== workspaceEpoch/);
  assert.match(render, /closeCompletedHistory\(false\)/);
  assert.doesNotMatch(render, /innerHTML|invoke\(|writeWorkitem|moveWorkitem/);
});
