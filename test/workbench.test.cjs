'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const vm = require('node:vm');
const { EventEmitter, once } = require('node:events');
const { randomBytes, webcrypto } = require('node:crypto');
const { BrowserWorkbench } = require('../build/plugin/workbench');
const { startBrowserConsole } = require('../build/plugin/browser');
const roots = { assetRoot: path.resolve('plugin'), webAssetsRoot: path.resolve('web') };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() >= end) assert.fail('Bounded condition timed out'); await sleep(10); }
}
async function directory(t) {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'workbench-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5 }));
  return root;
}
function post(app, channel, payload, headers = {}) {
  return fetch(app.origin + '/api/invoke', { method: 'POST', signal: AbortSignal.timeout(3000), headers: { Origin: app.origin, 'Content-Type': 'application/json', 'X-Governance-Token': app.url.split('#')[1], ...headers }, body: JSON.stringify({ channel, payload }) });
}
async function lease(app, id, event, status = 200) {
  const res = await post(app, 'governance.lease', { id, event });
  assert.equal(res.status, status); return res.json();
}
const id = () => randomBytes(16).toString('hex');
async function server(t, extra = {}) {
  const workspace = await directory(t);
  const app = await startBrowserConsole({ ...roots, workspace, managed: true, lease: { startupGraceMs: 2000, ttlMs: 600, emptyGraceMs: 120, heartbeatMs: 50 }, ...extra });
  t.after(() => app.close()); return app;
}
async function disconnected(origin) {
  const url = new URL(origin);
  await new Promise((resolve, reject) => {
    const socket = net.connect(Number(url.port), url.hostname);
    socket.setTimeout(1500, () => { socket.destroy(); reject(Error('Connection check timed out')); });
    socket.once('connect', () => { socket.destroy(); reject(Error('Old listener remains open')); });
    socket.once('error', () => resolve());
  });
}
function manager(t, options = {}) {
  const urls = [], apps = [];
  const workbench = new BrowserWorkbench({ ...roots, openExternal: async url => { urls.push(url); }, startServer: async opts => { const app = await startBrowserConsole(opts); apps.push(app); return app; }, ...options });
  t.after(() => workbench.dispose()); return { workbench, urls, apps };
}
test('workbench starts without init, returns no credential, serializes duplicate opens and isolates switching', async t => {
  const a = await directory(t), b = await directory(t);
  const f = manager(t);
  assert.deepEqual(f.workbench.status(), { workspace: null, origin: null, open: false });
  const values = await Promise.all([f.workbench.open(a), f.workbench.open(a), f.workbench.open(a)]);
  assert.equal(f.apps.length, 1); assert.equal(f.urls.length, 3);
  for (const value of values) { assert.deepEqual(Object.keys(value).sort(), ['opened', 'origin', 'workspace']); assert.equal(value.origin, f.apps[0].origin); }
  assert.equal(new Set(f.urls).size, 1); assert.deepEqual(await fs.readdir(a), []);
  const first = f.apps[0];
  assert.deepEqual(await f.workbench.close(b), { closed: false }); assert.equal(f.workbench.status().open, true);
  const agent = new http.Agent({ keepAlive: true }); t.after(() => agent.destroy());
  await new Promise((resolve, reject) => http.get(first.origin + '/panel/', { agent }, res => { res.resume(); res.once('end', resolve); }).once('error', reject));
  const switched = await f.workbench.open(b);
  assert.equal(switched.workspace, b); assert.equal(first.closed, true); await disconnected(first.origin);
  assert.equal(f.apps.length, 2); assert.deepEqual(await fs.readdir(b), []);
  await f.workbench.close(); assert.equal(f.workbench.status().open, false);
  assert.deepEqual(await f.workbench.close(), { closed: false });
  await assert.rejects(f.workbench.open('')); await assert.rejects(f.workbench.open('.'));
});
test('close/dispose invalidate delayed real servers before any opener; disposal is permanent', async t => {
  const root = await directory(t);
  for (const action of ['close', 'dispose']) {
    const ready = deferred(), release = deferred(), apps = [], urls = [];
    const f = manager(t, { openExternal: async url => { urls.push(url); }, startServer: async opts => { const app = await startBrowserConsole(opts); apps.push(app); ready.resolve(); await release.promise; return app; } });
    const pending = f.workbench.open(root); const rejected = assert.rejects(pending, /Unable to open browser workbench/);
    await ready.promise;
    const closing = f.workbench[action]();
    const queued = f.workbench.open(root); const queuedResult = action === 'dispose' ? assert.rejects(queued, /disposed/) : queued;
    release.resolve(); await rejected; await closing; await queuedResult;
    assert.equal(apps[0].closed, true); await disconnected(apps[0].origin);
    assert.equal(urls.length, action === 'dispose' ? 0 : 1);
    if (action === 'dispose') { assert.strictEqual(f.workbench.dispose(), f.workbench.dispose()); await assert.rejects(f.workbench.open(root), /disposed/); }
  }
});
test('identity is checked at invocation, readiness and immediately before opener, including async switch', async t => {
  const root = await directory(t);
  for (const stage of ['initial', 'ready', 'before-open']) {
    let current = stage !== 'initial', checks = 0;
    const f = manager(t, { startServer: async opts => { const app = await startBrowserConsole(opts); f.apps.push(app); if (stage === 'ready') current = false; return app; } });
    await assert.rejects(f.workbench.open(root, async () => { checks++; if (stage === 'before-open' && checks === 5) current = false; return current; }));
    assert.equal(f.urls.length, 0); assert.equal(f.workbench.status().open, false);
    for (const app of f.apps) { assert.equal(app.closed, true); await disconnected(app.origin); }
  }
  const gate = deferred(), entered = deferred(); let checks = 0;
  const f = manager(t);
  const pending = f.workbench.open(root, async () => { if (++checks === 5) { entered.resolve(); await gate.promise; } return true; });
  const rejected = assert.rejects(pending); await entered.promise;
  const closing = f.workbench.close(); gate.resolve(); await rejected; await closing;
  assert.equal(f.urls.length, 0); assert.equal(f.apps[0].closed, true);
});
test('opener and startup failures are generic, reclaim ownership, never retry, and permit a new explicit open', async t => {
  const root = await directory(t); let calls = 0;
  const f = manager(t, { openExternal: async url => { calls++; throw Error('Sensitive ' + url); } });
  await assert.rejects(f.workbench.open(root), { message: 'Unable to open browser workbench.' });
  assert.equal(calls, 1); assert.equal(f.apps[0].closed, true); assert.equal(f.workbench.status().open, false); await disconnected(f.apps[0].origin);
  await assert.rejects(f.workbench.open(root)); assert.equal(calls, 2); assert.equal(f.apps.length, 2);
  const bad = manager(t, { startServer: async () => { throw Error('Private injected details'); } });
  await assert.rejects(bad.workbench.open(root), { message: 'Unable to open browser workbench.' }); assert.equal(bad.urls.length, 0);
});
test('shared close is idempotent and bounded for incomplete headers, body and keepalive connections', async t => {
  const app = await server(t);
  const sockets = [];
  for (const data of ['', 'GET /panel/ HTTP/1.1\r\n', `POST /api/invoke HTTP/1.1\r\nHost: ${new URL(app.origin).host}\r\nOrigin: ${app.origin}\r\nContent-Type: application/json\r\nX-Governance-Token: ${app.url.split('#')[1]}\r\nContent-Length: 1000\r\n\r\n{`]) {
    const socket = net.connect(Number(new URL(app.origin).port), '127.0.0.1'); socket.on('error', () => {}); socket.resume();
    await once(socket, 'connect'); if (data) socket.write(data); sockets.push(socket);
  }
  t.after(() => sockets.forEach(socket => socket.destroy()));
  const started = Date.now(), closing = app.close();
  assert.strictEqual(app.close(), closing); assert.equal(app.closed, true);
  assert.throws(() => { app.closed = false; }, TypeError);
  await closing; assert.ok(Date.now() - started < 2000); await app.close(); await disconnected(app.origin);
  await until(() => sockets.every(socket => socket.destroyed));
});
test('leases require normal authentication, strict schema and a bounded 16-page budget', async t => {
  const app = await server(t, { lease: { startupGraceMs: 3000, ttlMs: 3000, emptyGraceMs: 150, heartbeatMs: 100 } });
  for (const headers of [{ 'X-Governance-Token': '' }, { Origin: 'null' }, { 'Content-Type': 'text/plain' }]) assert.equal((await post(app, 'governance.lease', { id: id(), event: 'join' }, headers)).status, 403);
  for (const payload of [{}, { id: 'wrong', event: 'join' }, { id: id(), event: 'touch' }, { id: id(), event: 'join', workspace: app.workspace }, { id: id(), event: 'join', ttlMs: 1 }, { id: id(), event: 'leave', extra: true }]) assert.equal((await post(app, 'governance.lease', payload)).status, 400);
  await lease(app, id(), 'heartbeat', 400);
  const ids = Array.from({ length: 16 }, id);
  for (const page of ids) assert.equal((await lease(app, page, 'join')).result.managed, true);
  await lease(app, id(), 'join', 400); await lease(app, ids[0], 'heartbeat'); await lease(app, ids[0], 'join');
  await lease(app, ids[0], 'leave'); await lease(app, id(), 'join');
  assert.deepEqual(await fs.readdir(app.workspace), []);
  assert.equal((await post(app, 'governance.operation', { action: 'start' })).status, 400);
});
test('multiple tabs, refresh and bfcache joins survive individual leaves; repeated leave never extends grace', async t => {
  const app = await server(t, { lease: { startupGraceMs: 1500, ttlMs: 1000, emptyGraceMs: 180, heartbeatMs: 60 } });
  const a = id(), b = id(), refreshed = id();
  await lease(app, a, 'join'); await lease(app, b, 'join'); await lease(app, a, 'leave');
  await sleep(220); assert.equal(app.closed, false); await lease(app, b, 'heartbeat');
  await lease(app, b, 'leave'); await sleep(50); await lease(app, refreshed, 'join');
  await sleep(220); assert.equal(app.closed, false);
  await lease(app, refreshed, 'leave'); await sleep(50); await lease(app, refreshed, 'join');
  await sleep(220); assert.equal(app.closed, false); await lease(app, refreshed, 'leave');
  const start = Date.now();
  for (let n = 0; n < 3; n++) { await sleep(35); await lease(app, refreshed, 'leave'); }
  await until(() => app.closed, 700); assert.ok(Date.now() - start < 400); await app.close(); await disconnected(app.origin);
});
test('startup without pages, crashed page TTL, unmanaged CLI and manager reopen after expiry', async t => {
  const timing = { startupGraceMs: 140, ttlMs: 180, emptyGraceMs: 90, heartbeatMs: 40 };
  const empty = await server(t, { lease: timing }); await sleep(150); assert.equal(empty.closed, false); await until(() => empty.closed); await empty.close();
  const crashed = await server(t, { lease: timing }); await lease(crashed, id(), 'join'); await sleep(190); assert.equal(crashed.closed, false); await until(() => crashed.closed); await crashed.close();
  const manual = await server(t, { managed: false, lease: timing });
  assert.deepEqual((await lease(manual, id(), 'join')).result, { managed: false }); await sleep(320); assert.equal(manual.closed, false);
  const root = await directory(t), f = manager(t, { lease: timing });
  await f.workbench.open(root); await until(() => f.apps[0].closed); assert.deepEqual(f.workbench.status(), { workspace: null, origin: null, open: false });
  await f.workbench.open(root); assert.equal(f.apps.length, 2); assert.equal(f.workbench.status().open, true);
});
test('default last-page grace is at least five seconds and heartbeat interval remains fifteen seconds', async t => {
  const app = await server(t, { lease: { startupGraceMs: 100, ttlMs: 100 } });
  const page = id();
  assert.equal((await lease(app, page, 'join')).result.heartbeatMs, 15000);
  const start = Date.now(); await lease(app, page, 'leave');
  await sleep(4700); assert.equal(app.closed, false);
  await until(() => app.closed, 2000); assert.ok(Date.now() - start >= 5000); await app.close();
});
test('20 real HTTP open/switch/close cycles leave no owned TCP server or listening port', async t => {
  const a = await directory(t), b = await directory(t), f = manager(t);
  const baseline = new Set(process._getActiveHandles().filter(handle => handle instanceof net.Server));
  for (let cycle = 0; cycle < 20; cycle++) {
    const first = await f.workbench.open(a); assert.equal((await fetch(first.origin + '/panel/')).status, 200);
    await f.workbench.open(a); await f.workbench.open(b); await disconnected(first.origin);
    await f.workbench.close(); assert.equal(f.workbench.status().open, false);
  }
  await f.workbench.dispose();
  for (const app of f.apps) { assert.equal(app.closed, true); await disconnected(app.origin); }
  await until(() => process._getActiveHandles().filter(handle => handle instanceof net.Server && !baseline.has(handle)).length === 0);
  assert.equal(f.apps.length, 40);
});
// Execute the browser bridge in a document-shaped VM. Fetches still hit the real HTTP service.
async function bridge(app, extra = {}) {
  const listeners = new Map(), timers = new Map(), calls = []; let serial = 0, pending = 0;
  const token = app.url.split('#')[1];
  const node = () => ({ setAttribute() {}, append() {}, before() {}, after() {} });
  const context = { navigator: { language: 'en' }, location: { hash: extra.stored ? '' : '#' + token, pathname: '/panel/' }, history: { replaceState() {} }, sessionStorage: { setItem() {}, getItem: () => token }, document: { createElement: node, querySelector: node }, matchMedia: () => ({ matches: false, addEventListener() {} }), crypto: webcrypto, AbortController, AbortSignal,
    setTimeout(fn, delay) { const key = ++serial; timers.set(key, { fn, delay }); assert.ok(timers.size <= 1); return key; }, clearTimeout(key) { timers.delete(key); },
    window: { addEventListener(event, handler) { listeners.set(event, handler); } },
    fetch: async (url, options) => {
      calls.push({ url, options }); pending++;
      try { if (extra.offline?.()) throw Error('Offline'); return await fetch(app.origin + url, { ...options, headers: { ...options.headers, Origin: app.origin } }); }
      finally { pending--; }
    }
  };
  vm.runInNewContext(await fs.readFile(path.resolve('web/bridge.js'), 'utf8'), context);
  const settle = async () => { await until(() => pending === 0); await sleep(5); };
  await settle();
  return { calls, timers, token, settle, event: async name => { listeners.get(name)?.(); await settle(); }, tick: async () => { const [key, timer] = timers.entries().next().value; timers.delete(key); timer.fn(); await settle(); } };
}
test('bridge authenticates joins/heartbeats/keepalive leaves, distinct copied tabs, pageshow and offline recovery without backlog', async t => {
  const app = await server(t, { lease: { startupGraceMs: 4000, ttlMs: 4000, emptyGraceMs: 200, heartbeatMs: 100 } });
  let offline = false;
  const a = await bridge(app, { offline: () => offline }), b = await bridge(app, { stored: true });
  const payload = call => JSON.parse(call.options.body).payload;
  assert.notEqual(payload(a.calls[0]).id, payload(b.calls[0]).id);
  assert.equal(a.timers.size, 1); await a.tick(); assert.equal(payload(a.calls.at(-1)).event, 'heartbeat');
  await a.event('pagehide'); assert.equal(a.timers.size, 0); assert.equal(a.calls.at(-1).options.keepalive, true); assert.equal(payload(a.calls.at(-1)).event, 'leave');
  const previous = payload(a.calls.at(-1)).id;
  await a.event('pageshow'); assert.equal(a.timers.size, 1); assert.notEqual(payload(a.calls.at(-1)).id, previous);
  offline = true; await a.tick(); assert.equal(a.timers.size, 0); const count = a.calls.length;
  await sleep(50); assert.equal(a.calls.length, count);
  const reconnectId = payload(a.calls.at(-1)).id;
  offline = false; await a.event('online'); assert.equal(payload(a.calls.at(-1)).event, 'join'); assert.equal(a.timers.size, 1);
  assert.equal(payload(a.calls.at(-1)).id, reconnectId);
  for (const call of [...a.calls, ...b.calls]) { assert.equal(call.url, '/api/invoke'); assert.equal(call.options.headers['X-Governance-Token'], a.token); assert.equal(call.options.body.includes(a.token), false); assert.deepEqual(Object.keys(payload(call)).sort(), ['event', 'id']); }
  await a.event('pagehide'); await b.event('pagehide');
  const manual = await server(t, { managed: false }); const c = await bridge(manual);
  assert.equal(c.timers.size, 0); await c.event('pageshow'); assert.equal(c.calls.length, 1);
});
async function openerModule(platform, spawn, env = {}) {
  const source = await fs.readFile(path.resolve('build/plugin/browser-open.js'), 'utf8');
  const exports = {}, fakeProcess = { platform, env: { SystemRoot: 'C:\\Windows', ...env } };
  vm.runInNewContext(source, { exports, process: fakeProcess, require: name => name === 'node:child_process' ? { spawn } : name === 'node:os' ? { release: () => 'test-local' } : require(name), setTimeout, clearTimeout });
  return exports.openBrowser;
}
test('restricted opener accepts only private loopback shape and fixed platform plans; no shell, retries or URL errors', async () => {
  const url = 'http://127.0.0.1:32123/panel/#' + 'a'.repeat(64);
  for (const platform of ['win32', 'darwin', 'linux']) {
    const calls = [];
    const open = await openerModule(platform, (...args) => { calls.push(args); const child = new EventEmitter(); queueMicrotask(() => child.emit('exit', 0, null)); return child; });
    await open(url); assert.equal(calls.length, 1);
    assert.equal(calls[0][0], platform === 'win32' ? 'C:\\Windows\\System32\\rundll32.exe' : platform === 'darwin' ? '/usr/bin/open' : '/usr/bin/xdg-open');
    assert.deepEqual(Array.from(calls[0][1]), platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]);
    assert.equal(calls[0][2].shell, false); assert.equal(calls[0][2].stdio, 'ignore'); assert.equal(calls[0][2].windowsHide, true);
    for (const bad of [url.replace('127.0.0.1', 'localhost'), url.replace('http:', 'https:'), url.replace(':32123', ':0'), url.replace(':32123', ':65536'), url.replace('/panel/', '/other/'), url.replace('/panel/', '/x/../panel/'), url.replace('/panel/', '/panel/?x=y'), url + '\n', url.replace('127.0.0.1', 'user@127.0.0.1')]) await assert.rejects(open(bad), { message: 'Unable to open the local browser workbench.' });
    assert.equal(calls.length, 1);
  }
  for (const env of [{ SSH_CONNECTION: 'remote' }, { SSH_TTY: 'remote' }, { WSL_INTEROP: 'remote' }, { CODESPACES: 'true' }]) {
    const open = await openerModule('linux', () => assert.fail('Remote opener must not spawn'), env); await assert.rejects(open(url));
  }
  for (const event of ['error', 'exit', 'throw']) {
    let calls = 0;
    const open = await openerModule('linux', () => { calls++; if (event === 'throw') throw Error(url); const child = new EventEmitter(); queueMicrotask(() => child.emit(event, event === 'error' ? Error(url) : 1)); return child; });
    await assert.rejects(open(url), { message: 'Unable to open the local browser workbench.' }); assert.equal(calls, 1);
  }
});
test('opener has a real bounded timeout and kills only its own child, without retry', { timeout: 6500 }, async () => {
  let spawned = 0, killed = 0;
  const open = await openerModule('linux', () => { spawned++; const child = new EventEmitter(); child.kill = () => { killed++; return true; }; return child; });
  const start = Date.now();
  await assert.rejects(open('http://127.0.0.1:32123/panel/#' + 'a'.repeat(64)), { message: 'Unable to open the local browser workbench.' });
  assert.ok(Date.now() - start < 5000); assert.equal(spawned, 1); assert.equal(killed, 1);
});
