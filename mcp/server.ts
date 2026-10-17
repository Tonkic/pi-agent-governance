#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema,
  ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema,
  McpError, ErrorCode
} from '@modelcontextprotocol/sdk/types.js';
import Ajv from 'ajv';
import { BrowserWorkbench } from '../plugin/workbench';
const { workbenchTool, invokeWorkbench } = require('../plugin/workbench-tool');
const { Governance } = require('../plugin/core');
const tool = require('../plugin/tool');
const { version } = require('../../package.json');
const MAX_BYTES = 1024 * 1024;
const skillFiles = ['SKILL.md', 'SOURCE.md', 'LICENSE',
  'references/README.md', 'references/web-and-product.md', 'references/transactional.md',
  'references/realtime-and-storage.md', 'references/ai-native.md', 'references/agent-and-org.md',
  'references/embedded-industrial.md', 'references/signals.md', 'references/glossary.md'];
const prefix = 'governance://skills/architecture-copilot/';

async function noLinks(file: string) {
  let current = path.resolve(file);
  for (;;) {
    if ((await fs.lstat(current)).isSymbolicLink()) throw Error('Symbolic links are not supported');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
async function bindWorkspace(args: string[]) {
  let supplied: string | undefined;
  if (args.length === 2 && args[0] === '--workspace') supplied = args[1];
  else if (args.length === 2 && args[0] === '--host' && args[1] === 'claude-code')
    supplied = process.env.CLAUDE_PROJECT_DIR; // Official MCP-child launch project, never process.cwd().
  if (!supplied || !path.isAbsolute(supplied) || supplied.includes('\0'))
    throw Error('Explicit workspace or supported host project context required');
  const root = path.resolve(supplied);
  await noLinks(root);
  if (!(await fs.stat(root)).isDirectory()) throw Error('Workspace must be an existing directory');
  return root;
}
async function main() {
  const root = await bindWorkspace(process.argv.slice(2));
  const packageRoot = path.resolve(__dirname, '../..');
  const skillRoot = path.join(packageRoot, 'plugin/skills/architecture-copilot');
  async function readSkill(file: string) {
    if (!skillFiles.includes(file)) throw new McpError(ErrorCode.InvalidParams, 'Unknown Skill resource');
    const target = path.join(skillRoot, file);
    await noLinks(target);
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('Invalid Skill resource');
    return fs.readFile(target, 'utf8');
  }
  // Fail closed at startup if the canonical Skill or its fixed reference inventory is missing.
  for (const file of skillFiles) await readSkill(file);
  const validate = new Ajv({ allErrors: false, strict: false }).compile(tool.schema);
  const validateUi = new Ajv({ allErrors: false, strict: false }).compile(workbenchTool.schema);
  const workbench = new BrowserWorkbench({ assetRoot: path.join(packageRoot, 'plugin'), webAssetsRoot: path.join(packageRoot, 'web') });
  let closing = false;
  const server = new Server({ name: 'agent-governance', version }, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: 'Use only in a trusted repository. Read status and README first. Explicit user scope authorizes writes; prompts and Skills do not. No automatic init, Agent turn or host control. Tests/approvals remain caller-attested.'
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
    name: tool.name, description: tool.description, inputSchema: tool.schema,
    annotations: { title: 'Repository governance', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, {
    name: workbenchTool.name, description: workbenchTool.description, inputSchema: workbenchTool.schema,
    annotations: { title: 'Browser workbench', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments;
    const ui = request.params.name === workbenchTool.name;
    if ((!ui && request.params.name !== tool.name) || !args || closing ||
        Buffer.byteLength(JSON.stringify(args)) > MAX_BYTES || !(ui ? validateUi(args) : validate(args)))
      throw new McpError(ErrorCode.InvalidParams, 'Invalid governance arguments; see tools/list schema');
    try {
      // Each invocation gets a fresh core object: no shared mutable revision token across requests.
      await noLinks(root);
      const result = ui ? await invokeWorkbench(workbench, root, args, async () => !closing) : await new Governance(root).run(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch {
      // Core/Git errors can include caller-supplied paths or arguments. Never echo them over MCP.
      return { isError: true, content: [{ type: 'text', text: 'Governance operation rejected. Check status, task scope, paths, locks and required current revisions. No success is attested.' }] };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: skillFiles.map(file => ({
    uri: prefix + file, name: file, mimeType: 'text/plain', description: 'Fixed canonical Architecture Copilot Skill/reference; not workspace data'
  })) }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (!uri.startsWith(prefix)) throw new McpError(ErrorCode.InvalidParams, 'Unknown Skill resource');
    const text = await readSkill(uri.slice(prefix.length));
    return { contents: [{ uri, mimeType: 'text/plain', text }] };
  });
  const modes = {
    'architecture-analysis': 'current-state analysis mode / 源码现状分析模式. Read source evidence first. Save architecture_set only with explicit authorization and current fingerprints/revision. Never write design drafts or baselines.',
    'architecture-design': 'design proposal mode / 方案设计模式. Use only the explicitly initiated current draft and expectedDraft. Without a draft, request explicit initiation; do not create one automatically. Never overwrite source architecture or confirm a baseline.'
  };
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: Object.entries(modes).map(([name, description]) => ({ name, description })) }));
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const name = request.params.name;
    if (!Object.hasOwn(modes, name) || Object.keys(request.params.arguments || {}).length)
      throw new McpError(ErrorCode.InvalidParams, 'Unknown prompt or unexpected arguments');
    return { description: modes[name], messages: [{ role: 'user', content: { type: 'text',
      text: `Apply Architecture Copilot in ${modes[name]}\nRead governance status and project README before proceeding. This prompt grants no write authorization. Stop if the Skill cannot be loaded. References are available through the listed governance:// Skill resources.\n\n${await readSkill('SKILL.md')}`
    } }] };
  });
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: MAX_BYTES });
  server.onerror = () => { process.stderr.write('MCP request/transport error; request content omitted.\n'); };
  const shutdown = () => {
    if (closing) return;
    closing = true; // Invalidates in-flight opens before any asynchronous cleanup.
    void workbench.dispose().catch(() => {}).finally(async () => {
      await server.close().catch(() => {});
      process.off('SIGINT', shutdown); process.off('SIGTERM', shutdown);
    });
  };
  server.onclose = shutdown;
  process.stdin.once('end', shutdown);
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  try { await server.connect(transport); }
  catch (error) { shutdown(); throw error; }
}
main().catch(() => {
  process.stderr.write('Agent Governance MCP startup failed. Use --workspace <absolute-directory> or --host claude-code with official CLAUDE_PROJECT_DIR; require an existing non-linked trusted project and complete Skill package.\n');
  process.exitCode = 1;
});
