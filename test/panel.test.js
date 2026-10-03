'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
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
    const mutate = async (args, revision) => panelInvoke(root, 'governance.mutate', { args, revision: revision || (await snapshot()).revision, confirmed: true });
    return { root, snapshot, mutate };
}
const start = { action: 'start', id: 'panel-task', goal: 'Human approved goal', criteria: ['Pass'], scope: ['src/'], constraints: ['No push'] };
test('panel initializes, starts and updates using the existing core', async (t) => {
    const { root, snapshot, mutate } = await fixture(t);
    await fs.writeFile(path.join(root, 'README.md'), 'User content');
    assert.equal((await snapshot()).state, null);
    await mutate({ action: 'init' });
    assert.equal((await snapshot()).state.status, 'idle');
    assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), 'User content');
    await mutate(start);
    await mutate({ action: 'progress', current: 'Done one step', next: ['Test'], blocked: [] });
    const s = (await snapshot()).state;
    assert.equal(s.current, 'Done one step');
    assert.deepEqual(s.next, ['Test']);
    assert.deepEqual(s.constraints, ['No push']);
});
test('stale state and switched workspace cannot be overwritten', async (t) => {
    const a = await fixture(t), b = await fixture(t);
    await a.mutate({ action: 'init' });
    await b.mutate({ action: 'init' });
    const old = await a.snapshot();
    await assert.rejects(b.mutate(start, old.revision), /过期|切换/);
    await a.mutate(start);
    await assert.rejects(a.mutate({ action: 'progress', current: 'stale', next: [], blocked: [] }, old.revision), /过期/);
    assert.equal((await a.snapshot()).state.current, start.goal);
});
test('panel refuses unconfirmed, unsupported and malformed operations', async (t) => {
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
test('malformed State is an error, not an initialization opportunity', async (t) => {
    const { root, snapshot } = await fixture(t);
    await fs.writeFile(path.join(root, 'STATE.json'), '{invalid');
    await assert.rejects(snapshot(), SyntaxError);
    await assert.rejects(panelInvoke(root, 'governance.git'), /git rev-parse failed/);
});
test('panel progress invalidates existing verification', async (t) => {
    const { root, snapshot, mutate } = await fixture(t);
    await mutate({ action: 'init' });
    await mutate(start);
    const { Governance } = require('../plugin/core');
    await new Governance(root).run({ action: 'verify', passed: true, accepted: [true], evidence: 'Fixture checked', diffReview: 'Fixture checked', files: ['README.md'] });
    assert.equal((await snapshot()).state.status, 'verified');
    await mutate({ action: 'progress', current: 'Continue', next: [], blocked: [] });
    assert.equal((await snapshot()).state.status, 'working');
    assert.equal((await snapshot()).state.verification, undefined);
});
test('renderer leads with architecture, removes promotional guide and keeps valid controls', async () => {
    const html = await fs.readFile(path.join(__dirname, '../plugin/renderer/index.html'), 'utf8');
    const script = await fs.readFile(path.join(__dirname, '../plugin/renderer/panel.js'), 'utf8');
    assert.doesNotMatch(html, /FIELD GUIDE|怎么使用这个项目|THE REPOSITORY IS THE MEMORY|每一次交接|hero-block|progress-fill/);
    assert.ok(html.indexOf('id="architecture"') < html.indexOf('id="task-section"'));
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(ids.length, new Set(ids).size, 'IDs must be unique');
    for (const match of script.matchAll(/(?:\$|text|list)\('([^']+)'/g))
        assert.ok(ids.includes(match[1]), `Missing element ${match[1]}`);
    for (const match of html.matchAll(/href="#([^"]+)"/g))
        assert.ok(ids.includes(match[1]), `Missing navigation target ${match[1]}`);
    assert.equal([...html.matchAll(/data-module="/g)].length, 0, 'No fixed plugin graph may masquerade as project data');
    for (const id of ['show-architecture', 'show-workflow', 'board-columns', 'workitem-form'])
        assert.ok(ids.includes(id));
    for (const file of ['graph-model.js', 'graph.js', 'panel.js'])
        assert.ok(html.includes(`src="${file}"`));
    const graphScript = await fs.readFile(path.join(__dirname, '../plugin/renderer/graph.js'), 'utf8');
    for (const match of graphScript.matchAll(/get\('([^']+)'/g))
        assert.ok(ids.includes(match[1]), `Missing graph control ${match[1]}`);
});
test('browser bundle starts without Node globals and reports static preview', async () => {
    const vm = require('node:vm');
    const script = await fs.readFile(path.join(__dirname, '../plugin/renderer/panel.js'), 'utf8');
    const elements = new Map();
    const document = {
        documentElement: { dataset: {} }, querySelectorAll: () => [],
        getElementById: id => {
            if (!elements.has(id))
                elements.set(id, { textContent: '', classList: { toggle() { } }, reset() { }, setAttribute() { }, addEventListener() { }, replaceChildren() { } });
            return elements.get(id);
        }
    };
    vm.runInNewContext(script, { document, window: { addEventListener() { }, dispatchEvent() { } }, CustomEvent: class {
            constructor(...args) { }
        }, location: { hash: '' }, matchMedia: () => ({ matches: false }) });
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
    model.setGraphData({ nodes: ['ui', 'agent', 'core', 'git', 'state', 'worktree'].map(id => ({ id, title: id })), edges: [{ from: 'ui', to: 'core' }, { from: 'agent', to: 'core' }, { from: 'core', to: 'git' }, { from: 'core', to: 'state' }, { from: 'git', to: 'worktree' }] });
    const { graphNodes, graphEdges, graphReach } = model;
    for (const edge of graphEdges) {
        assert.ok(graphNodes[edge.from]);
        assert.ok(graphNodes[edge.to]);
    }
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
    assert.ok(n.a.y < n.b.y);
    assert.equal(n.b.y, n.c.y);
    assert.ok(n.c.y < n.d.y);
    const nodes = Object.values(n);
    for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
            assert.ok(Math.abs(nodes[i].x - nodes[j].x) >= 210 || Math.abs(nodes[i].y - nodes[j].y) >= 96);
        }
    for (const edge of model.graphEdges)
        assert.ok(!/NaN|undefined/.test(edge.path));
    assert.notEqual(model.graphEdges[1].path, model.graphEdges[2].path);
    assert.match(model.graphEdges[4].path, /H/); // Long dependency bypasses intermediate rows.
    const first = JSON.stringify(model.graphNodes);
    model.setGraphData(data);
    assert.equal(JSON.stringify(model.graphNodes), first);
    model.setGraphData({ nodes: [], edges: [] });
    assert.equal(Object.keys(model.graphNodes).length, 0);
});
