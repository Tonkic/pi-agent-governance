'use strict';
// Publisher CLI, not plugin runtime. Credentials never belong to a payload.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const endpoint = 'https://plugins.aiuo.net/mcp';
const tokenPath = path.join(root, '.secrets', 'plugin-center.token');
const files = [
  'main.ts', 'main.js', 'core.ts', 'core.js', 'git.ts', 'git.js',
  'panel.ts', 'panel.js', 'project.ts', 'project.js', 'tool.ts', 'tool.js',
  'README.md', 'GIT.md', 'PROJECT.md', 'PUBLISHING.md',
  'renderer/index.html', 'renderer/panel.css', 'renderer/panel.ts', 'renderer/panel.js',
  'renderer/graph.ts', 'renderer/graph.js', 'renderer/graph-model.ts', 'renderer/graph-model.js',
  'renderer/i18n.ts', 'renderer/i18n.js', 'renderer/tsconfig.json'
];
function git(...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }); }
function buildPayload(sourceRef, releaseNotes) {
  if (!/^[a-f0-9]{40}$/.test(sourceRef)) throw Error('sourceRef must be a full reviewed commit SHA');
  const read = file => git('show', `${sourceRef}:plugin/${file}`);
  const manifest = JSON.parse(read('manifest.json'));
  if (manifest.id !== 'io.github.tonkic.agent-governance') throw Error('Unexpected plugin identity');
  const allowed = ['id', 'version', 'name', 'description', 'safetyNotes', 'i18n', 'main', 'ui', 'contributes', 'activationEvents', 'permissions', 'engines', 'fs', 'net'];
  const payload = Object.fromEntries(allowed.filter(key => manifest[key] !== undefined).map(key => [key, manifest[key]]));
  Object.assign(payload, { repository: 'Tonkic/pi-agent-governance', sourceRef, releaseNotes, readme: read('README.md'), files: files.map(file => ({ path: file, content: read(file) })) });
  const serialized = JSON.stringify(payload);
  if (/pi_pat_[A-Za-z0-9_-]+/.test(serialized)) throw Error('Credential-like content found in payload; refusing upload');
  return payload;
}
async function main() {
  const mode = process.argv[2] || 'whoami';
  const readonly = ['whoami', 'list_plugins', 'list_repositories', 'tools'];
  if (![...readonly, 'create_plugin', 'preview'].includes(mode)) throw Error('Unsupported operation');
  let payload;
  if (mode === 'create_plugin' || mode === 'preview') {
    payload = buildPayload(process.argv[3], fs.readFileSync(process.argv[4], 'utf8'));
    if (mode === 'preview') { console.log(JSON.stringify({ id: payload.id, version: payload.version, sourceRef: payload.sourceRef, files: payload.files.map(f => f.path), bytes: Buffer.byteLength(JSON.stringify(payload)) }, null, 2)); return; }
    if (process.argv[5] !== '--submit') throw Error('Public submission requires --submit after explicit human authorization');
  }
  git('check-ignore', '--', '.secrets/plugin-center.token');
  if (git('ls-files', '--', '.secrets').trim()) throw Error('Secret directory is tracked; refusing authentication');
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  if (!/^pi_pat_[A-Za-z0-9_-]+$/.test(token)) throw Error('Invalid local credential format');
  let session, id = 0;
  async function rpc(method, params, notify = false) {
    const requestId = notify ? undefined : ++id;
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2024-11-05', ...(session ? { 'Mcp-Session-Id': session } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: requestId }), method, params }) });
    if (!response.ok) throw Error(`MCP HTTP ${response.status}`);
    session = response.headers.get('mcp-session-id') || session;
    const body = await response.text();
    if (!body) return null;
    const replies = response.headers.get('content-type')?.includes('text/event-stream') ? body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5))) : [JSON.parse(body)];
    const reply = replies.find(item => item.id === requestId);
    if (!notify && !reply) throw Error('MCP response missing; inspect remote status before retrying');
    if (reply?.error) throw Error(`MCP RPC error ${reply.error.code}`);
    return reply?.result;
  }
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'governance-publisher', version: '0.6.0' } });
  await rpc('notifications/initialized', {}, true);
  const result = mode === 'tools' ? await rpc('tools/list', {}) : await rpc('tools/call', { name: mode, arguments: payload || {} });
  console.log(JSON.stringify(result, null, 2).split(token).join('[REDACTED]').replace(/pi_pat_[A-Za-z0-9_-]+/g, '[REDACTED]'));
  if (result?.isError) process.exitCode = 1;
}
module.exports = { buildPayload, files };
if (require.main === module) main().catch(() => { console.error('Publisher failed. Check local inputs, permissions, and remote status before retrying; no automatic retry performed.'); process.exitCode = 1; });
