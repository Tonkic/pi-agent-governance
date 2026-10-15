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
  if (args.length !== 2 || args[0] !== '--workspace' || !path.isAbsolute(args[1]) || args[1].includes('\0'))
    throw Error('Usage: node build/mcp/server.js --workspace <absolute-existing-directory>');
  const root = path.resolve(args[1]);
  await noLinks(root);
  if (!(await fs.stat(root)).isDirectory()) throw Error('Workspace must be an existing directory');
  return root;
}
async function main() {
  const root = await bindWorkspace(process.argv.slice(2));
  const packageRoot = path.resolve(__dirname, '../..');
  let skillRoot = path.join(packageRoot, 'skills/architecture-copilot');
  try { await fs.lstat(skillRoot); }
  catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
    skillRoot = path.join(packageRoot, 'plugin/skills/architecture-copilot');
  }
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
  const server = new Server({ name: 'agent-governance', version }, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: 'Use only in a trusted repository. Read status and README first. Explicit user scope authorizes writes; prompts and Skills do not. No automatic init, Agent turn or host control. Tests/approvals remain caller-attested.'
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
    name: tool.name, description: tool.description, inputSchema: tool.schema,
    annotations: { title: 'Repository governance', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments;
    if (request.params.name !== tool.name || !args ||
        Buffer.byteLength(JSON.stringify(args)) > MAX_BYTES || !validate(args))
      throw new McpError(ErrorCode.InvalidParams, 'Invalid governance arguments; see tools/list schema');
    try {
      // Each invocation gets a fresh core object: no shared mutable revision token across requests.
      await noLinks(root);
      const result = await new Governance(root).run(args);
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
  process.stdin.once('end', () => { void server.close(); });
  await server.connect(transport);
}
main().catch(() => {
  process.stderr.write('Agent Governance MCP startup failed. Use --workspace with an absolute existing, non-linked trusted directory and a complete Skill package.\n');
  process.exitCode = 1;
});
