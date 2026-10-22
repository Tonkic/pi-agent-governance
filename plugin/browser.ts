import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as http from 'node:http';
import type { Socket } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
const { panelInvoke } = require('./panel');
const MAX_BODY = 1024 * 1024;
const rendererFiles = ['i18n', 'graph-model', 'graph', 'design', 'shell', 'panel', 'documents', 'git-history'];
export async function noLinks(file: string) {
  let current = path.resolve(file);
  for (;;) {
    if ((await fs.lstat(current)).isSymbolicLink()) throw Error('Linked paths are not supported');
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
}
export async function workspacePath(workspace: string) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace) || workspace.includes('\0')) throw Error('Explicit absolute workspace required');
  const root = path.resolve(workspace);
  await noLinks(root);
  if (!(await fs.stat(root)).isDirectory()) throw Error('Workspace directory required');
  return root;
}
export interface BrowserOptions {
  workspace: string;
  port?: number;
  assetRoot: string;
  webAssetsRoot: string;
  managed?: boolean;
  // Trusted programmatic configuration only; never read from HTTP, CLI or environment.
  lease?: { startupGraceMs?: number; heartbeatMs?: number; ttlMs?: number; emptyGraceMs?: number };
}
export interface BrowserConsole {
  readonly origin: string;
  readonly url: string;
  readonly workspace: string;
  readonly closed: boolean;
  close(): Promise<void>;
}
async function assets(assetRoot: string, webAssetsRoot: string) {
  const files: Array<[string, string, string]> = [
    ['/panel/', path.join(assetRoot, 'renderer/index.html'), 'text/html; charset=utf-8'],
    ['/panel/panel.css', path.join(assetRoot, 'renderer/panel.css'), 'text/css; charset=utf-8'],
    ['/panel/tokens.css', path.join(assetRoot, 'renderer/tokens.css'), 'text/css; charset=utf-8'],
    ['/panel/shell.css', path.join(assetRoot, 'renderer/shell.css'), 'text/css; charset=utf-8'],
    ['/panel/views.css', path.join(assetRoot, 'renderer/views.css'), 'text/css; charset=utf-8'],
    ['/panel/documents.css', path.join(assetRoot, 'renderer/documents.css'), 'text/css; charset=utf-8'],
    ['/console/bridge.js', path.join(webAssetsRoot, 'bridge.js'), 'text/javascript; charset=utf-8'],
    ['/console/console.css', path.join(webAssetsRoot, 'console.css'), 'text/css; charset=utf-8'],
    ...rendererFiles.map(name => [`/runtime/renderer/${name}.js`, path.join(assetRoot, `runtime/renderer/${name}.js`), 'text/javascript; charset=utf-8'] as [string, string, string])
  ];
  const result = new Map<string, { bytes: Buffer; type: string }>();
  for (const [url, target, type] of files) {
    await noLinks(target);
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > 4 * MAX_BODY) throw Error('Invalid console asset');
    let bytes = await fs.readFile(target);
    if (url === '/panel/') {
      const html = bytes.toString('utf8');
      if (!html.includes('<body>') || !html.includes('<script src="../runtime/renderer/i18n.js">')) throw Error('Unsupported panel entry');
      bytes = Buffer.from(html.replace('<body>', '<body data-local-console="true">')
        .replace('</head>', '<link rel="stylesheet" href="/console/console.css"></head>')
        .replace('<script src="../runtime/renderer/i18n.js">', '<script src="/console/bridge.js"></script><script src="../runtime/renderer/i18n.js">'));
    }
    result.set(url, { bytes, type });
  }
  return result;
}
function allowed(channel: string, payload: any) {
  const reads = ['governance.snapshot', 'governance.git', 'governance.project', 'governance.behaviors'];
  if (reads.includes(channel)) return true;
  if (channel === 'governance.gitHistory') return ['list', 'detail', 'diff'].includes(payload.action);
  if (channel === 'governance.documents') return ['list', 'read'].includes(payload.action);
  if (channel === 'governance.workitem') return ['board_create', 'board_update', 'board_move'].includes(payload.args?.action);
  if (channel === 'governance.mutate') return ['init', 'start', 'progress'].includes(payload.args?.action);
  if (channel === 'governance.design') return ['snapshot', 'begin', 'confirm', 'discard'].includes(payload.action);
  return false;
}
export async function startBrowserConsole(options: BrowserOptions): Promise<BrowserConsole> {
  const { workspace, port = 0, assetRoot, webAssetsRoot, managed = false } = options;
  const root = await workspacePath(workspace);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
  const inventory = await assets(assetRoot, webAssetsRoot);
  const timing = { startupGraceMs: 60000, heartbeatMs: 15000, ttlMs: 120000, emptyGraceMs: 5000, ...options.lease };
  if (Object.values(timing).some(n => !Number.isSafeInteger(n) || n <= 0 || n > 2147483647)) throw Error('Invalid lease configuration');
  const token = randomBytes(32).toString('hex');
  let origin = '';
  let active = 0;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let leaseTimer: ReturnType<typeof setTimeout> | undefined;
  let emptyDeadline = 0;
  const leases = new Map<string, number>();
  const sockets = new Set<Socket>();
  // One deadline timer, with a separate grace after startup or the last page expires/leaves.
  const schedule = () => {
    clearTimeout(leaseTimer);
    if (!managed || closed) return;
    const now = Date.now();
    let lastExpiry = 0;
    for (const [id, expires] of leases) {
      if (expires <= now) { leases.delete(id); lastExpiry = Math.max(lastExpiry, expires); }
    }
    if (lastExpiry && !leases.size) emptyDeadline = lastExpiry + timing.emptyGraceMs;
    const deadline = leases.size ? Math.min(...leases.values()) : emptyDeadline;
    leaseTimer = setTimeout(() => {
      if (!leases.size && Date.now() >= emptyDeadline) { void close(); return; }
      schedule();
    }, Math.max(1, deadline - now));
  };
  const lease = (payload: any) => {
    if (Object.keys(payload).length !== 2 || Object.keys(payload).some(k => !['id', 'event'].includes(k)) || typeof payload.id !== 'string' || !/^[a-f0-9]{32}$/.test(payload.id) || !['join', 'heartbeat', 'leave'].includes(payload.event)) return null;
    if (!managed) return { managed: false };
    const now = Date.now();
    // Prune before enforcing the tab budget or recognizing a heartbeat.
    schedule();
    if (payload.event === 'join') {
      if (!leases.has(payload.id) && leases.size >= 16) return null;
      leases.set(payload.id, now + timing.ttlMs);
    } else if (payload.event === 'heartbeat') {
      if (!leases.has(payload.id)) return null;
      leases.set(payload.id, now + timing.ttlMs);
    } else if (leases.delete(payload.id) && !leases.size) emptyDeadline = now + timing.emptyGraceMs;
    schedule();
    return { managed: true, heartbeatMs: timing.heartbeatMs };
  };
  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: string | Buffer, type = 'application/json; charset=utf-8') => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': type }); res.end(body);
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const reject = (code = 403) => send(code, '{"ok":false,"error":"Request rejected"}');
    // Exact Host prevents DNS rebinding; Origin/token prevent cross-origin writes and reads.
    if (closed || req.headers.host !== origin.slice(7) || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])))) return reject();
    if (req.headers.origin && req.headers.origin !== origin) return reject();
    const url = req.url;
    if (req.method === 'GET' && url === '/') { res.writeHead(302, { Location: '/panel/' }); return res.end(); }
    if (req.method === 'GET' && inventory.has(url)) {
      const asset = inventory.get(url); return send(200, asset.bytes, asset.type);
    }
    if (url !== '/api/invoke') return reject(404);
    if (req.method !== 'POST') return reject(405);
    if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return reject();
    const provided = req.headers['x-governance-token'];
    if (typeof provided !== 'string' || !/^[a-f0-9]{64}$/.test(provided) || !timingSafeEqual(Buffer.from(provided), Buffer.from(token))) return reject();
    if (Number(req.headers['content-length']) > MAX_BODY) return reject(413);
    if (active >= 8) return reject(429);
    active++;
    let behaviorRead = false;
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) { reject(413); return; }
        chunks.push(chunk);
      }
      if (closed) return reject();
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(k => !['channel', 'payload'].includes(k))) return reject(400);
      const payload = input.payload ?? {};
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reject(400);
      if (input.channel === 'governance.lease') {
        const result = lease(payload);
        if (!result) return reject(400);
        send(200, JSON.stringify({ ok: true, result })); return;
      }
      if (!allowed(input.channel, payload)) return reject(400);
      if (payload.workspace !== undefined && payload.workspace !== root) return reject(409);
      await noLinks(root);
      if (closed) return reject();
      behaviorRead = input.channel === 'governance.behaviors';
      const result = await panelInvoke(root, input.channel, payload);
      send(200, JSON.stringify({ ok: true, result }));
    } catch (error) {
      if (behaviorRead && error.message === 'Behavior contract exceeds read budget') {
        send(409, JSON.stringify({ ok: false, error: 'Behavior documents exceed the 500000-character source read budget. Reduce the bound source/test content; refreshing or confirming will not resolve this limit. / 行为文档关联源码超过500000字符读取预算。请精简关联源码/测试内容；刷新或确认不能解除此限额。' })); return;
      }
      // No caller arguments, raw Git output, credentials or stack traces in responses/logs.
      send(409, JSON.stringify({ ok: false, error: 'Operation rejected. Refresh and check confirmation, task scope, paths, locks and current revision. / 操作被拒绝：请刷新并检查确认、范围、路径、锁和最新修订。' }));
    } finally { active--; }
  });
  function close(): Promise<void> {
    if (closePromise) return closePromise;
    closed = true;
    clearTimeout(leaseTimer);
    leases.clear();
    closePromise = new Promise<void>(resolve => {
      const force = setTimeout(() => {
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections();
        resolve();
      }, 1000);
      server.close(() => { clearTimeout(force); resolve(); });
      server.closeIdleConnections();
    });
    return closePromise;
  }
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 1000;
  server.maxConnections = 32;
  await new Promise<void>((resolve, reject) => {
    const failed = () => { server.removeListener('listening', ready); reject(Error('Local console startup failed')); };
    const ready = () => { server.removeListener('error', failed); resolve(); };
    server.once('error', failed); server.once('listening', ready); server.listen(port, '127.0.0.1');
  });
  const address = server.address() as { port: number };
  origin = `http://127.0.0.1:${address.port}`;
  emptyDeadline = Date.now() + timing.startupGraceMs + timing.emptyGraceMs;
  schedule();
  return Object.freeze({ origin, url: `${origin}/panel/#${token}`, workspace: root, close, get closed() { return closed; } });
}
