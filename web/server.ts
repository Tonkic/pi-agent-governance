#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
const { panelInvoke } = require('../plugin/panel');
const MAX_BODY = 1024 * 1024;
const rootDir = path.resolve(__dirname, '../..');
const rendererFiles = ['i18n', 'graph-model', 'graph', 'design', 'panel'];
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
async function assets() {
  const files: Array<[string, string, string]> = [
    ['/panel/', 'plugin/renderer/index.html', 'text/html; charset=utf-8'],
    ['/panel/panel.css', 'plugin/renderer/panel.css', 'text/css; charset=utf-8'],
    ['/panel/views.css', 'plugin/renderer/views.css', 'text/css; charset=utf-8'],
    ['/console/bridge.js', 'web/bridge.js', 'text/javascript; charset=utf-8'],
    ['/console/console.css', 'web/console.css', 'text/css; charset=utf-8'],
    ...rendererFiles.map(name => [`/runtime/renderer/${name}.js`, `plugin/runtime/renderer/${name}.js`, 'text/javascript; charset=utf-8'] as [string, string, string])
  ];
  const result = new Map<string, { bytes: Buffer; type: string }>();
  for (const [url, name, type] of files) {
    const target = path.join(rootDir, name);
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
  if (channel === 'governance.workitem') return ['board_create', 'board_update', 'board_move'].includes(payload.args?.action);
  if (channel === 'governance.mutate') return ['init', 'start', 'progress'].includes(payload.args?.action);
  if (channel === 'governance.design') return ['snapshot', 'begin', 'confirm', 'discard'].includes(payload.action);
  return false;
}
export async function startConsole({ workspace, port = 0 }: { workspace: string; port?: number }) {
  const root = await workspacePath(workspace);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
  const inventory = await assets();
  const token = randomBytes(32).toString('hex');
  let origin = '';
  let active = 0;
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
    if (req.headers.host !== origin.slice(7) || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])))) return reject();
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
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) { reject(413); return; }
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(k => !['channel', 'payload'].includes(k))) return reject(400);
      const payload = input.payload ?? {};
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !allowed(input.channel, payload)) return reject(400);
      if (payload.workspace !== undefined && payload.workspace !== root) return reject(409);
      await noLinks(root);
      const result = await panelInvoke(root, input.channel, payload);
      send(200, JSON.stringify({ ok: true, result }));
    } catch {
      // No caller arguments, raw Git output, credentials or stack traces in responses/logs.
      send(409, JSON.stringify({ ok: false, error: 'Operation rejected. Refresh and check confirmation, task scope, paths, locks and current revision. / 操作被拒绝：请刷新并检查确认、范围、路径、锁和最新修订。' }));
    } finally { active--; }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 1000;
  server.maxConnections = 32;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address() as { port: number };
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, url: `${origin}/panel/#${token}`, workspace: root, close: () => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections();
  }) };
}
async function main() {
  const args = process.argv.slice(2);
  if (![2, 4].includes(args.length) || args[0] !== '--workspace' || (args.length === 4 && (args[2] !== '--port' || !/^(0|[1-9]\d{0,4})$/.test(args[3])))) throw Error('Invalid startup arguments');
  const app = await startConsole({ workspace: args[1], port: args.length === 4 ? Number(args[3]) : 0 });
  process.stdout.write(`Local project console (private local access link; do not share):\n${app.url}\nBound workspace: ${app.workspace}\nStop with Ctrl+C. No automatic initialization or Agent execution.\n`);
  for (const signal of ['SIGINT', 'SIGTERM'] as NodeJS.Signals[]) process.once(signal, () => { void app.close(); });
}
if (require.main === module) main().catch(() => { process.stderr.write('Local console startup failed. Supply an existing absolute non-linked workspace and optional --port 0..65535.\n'); process.exitCode = 1; });
