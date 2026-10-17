#!/usr/bin/env node
import * as path from 'node:path';
import { startBrowserConsole, BrowserOptions } from '../plugin/browser';
export { noLinks, workspacePath } from '../plugin/browser';
export function startConsole(options: Omit<BrowserOptions, 'assetRoot' | 'webAssetsRoot'>) {
  return startBrowserConsole({ ...options, assetRoot: path.resolve(__dirname, '../../plugin'), webAssetsRoot: path.resolve(__dirname, '../../web') });
}
async function main() {
  const args = process.argv.slice(2);
  if (![2, 4].includes(args.length) || args[0] !== '--workspace' || (args.length === 4 && (args[2] !== '--port' || !/^(0|[1-9]\d{0,4})$/.test(args[3])))) throw Error('Invalid startup arguments');
  const app = await startConsole({ workspace: args[1], port: args.length === 4 ? Number(args[3]) : 0 });
  process.stdout.write(`Local project console (private local access link; do not share):\n${app.url}\nBound workspace: ${app.workspace}\nStop with Ctrl+C. No automatic initialization or Agent execution.\n`);
  for (const signal of ['SIGINT', 'SIGTERM'] as NodeJS.Signals[]) process.once(signal, () => { void app.close(); });
}
if (require.main === module) main().catch(() => { process.stderr.write('Local console startup failed. Supply an existing absolute non-linked workspace and optional --port 0..65535.\n'); process.exitCode = 1; });
