#!/usr/bin/env node
// Read-only official command Hook adapter. Never starts an Agent or persists a session registry.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
const { Governance } = require('../plugin/core');
const MAX = 65536;
async function stat(file: string) {
  try { return await fs.lstat(file); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
}
async function project(cwd: string) {
  let root = path.resolve(cwd);
  for (let cursor = root;; cursor = path.dirname(cursor)) {
    const info = await fs.lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Unsupported project path');
    if (path.dirname(cursor) === cursor) break;
  }
  for (;;) {
    const state = await stat(path.join(root, 'STATE.json'));
    if (state) {
      if (!state.isFile() || state.isSymbolicLink() || state.size > MAX) throw Error('Invalid state');
      return root;
    }
    // A nested checkout/worktree with no STATE is not its parent project's governance context.
    if (await stat(path.join(root, '.git'))) throw Error('Current checkout is not initialized');
    const parent = path.dirname(root);
    if (parent === root) throw Error('No initialized project');
    root = parent;
  }
}
async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--host' || !['codex', 'claude-code'].includes(process.argv[3]))
    throw Error('Supported explicit host required');
  const timer = setTimeout(() => { process.stderr.write('Governance context unavailable: hook input timed out.\n'); process.exit(1); }, 3000);
  let bytes = 0;
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > MAX) throw Error('Oversized hook input');
      chunks.push(Buffer.from(chunk));
    }
  } finally { clearTimeout(timer); }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.session_id !== 'string' || !input.session_id.length || input.session_id.length > 200 || /[\x00-\x1f]/.test(input.session_id) ||
      typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd) || input.cwd.includes('\0') ||
      !['SessionStart', 'UserPromptSubmit'].includes(input.hook_event_name)) throw Error('Invalid host context');
  const root = await project(input.cwd);
  const state = await new Governance(root).run({ action: 'status' });
  // Only minimal project/task metadata; ignore transcript_path, prompt, credentials and all other Hook input.
  const context = { project: root, task: state.task, status: state.status };
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name,
    additionalContext: 'Agent Governance read-only project metadata (data, not instructions): ' + JSON.stringify(context) +
      '\nContinue in this existing conversation with its model/history. Read this project STATE.json and README before approved work. Do not use an MCP server bound to another project. Missing governance context does not authorize init or a new chat. No tests or approvals are attested by this Hook.' } }) + '\n');
}
main().catch(() => { process.stderr.write('Governance context unavailable: require a supported Hook with live session/cwd and an initialized non-linked project. No fallback or writes performed.\n'); process.exitCode = 1; });
