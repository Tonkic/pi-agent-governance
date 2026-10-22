#!/usr/bin/env node
'use strict';
const { RemoteStore } = require('./remote-store'), { discover, operation } = require('./remote-ssh');
const help = 'remote --workspace ABSOLUTE_LOCAL_DIRECTORY --action configure|profiles|fingerprint|trust|probe|read|write|exec|sync|offline|resolve [--profile ID]. Request JSON and secrets use stdin, never argv. See docs/remote.md.';
async function secret(question: string) {
  if (!process.stdin.isTTY) throw Error('SECRET_INPUT_REQUIRED');
  const readline = require('node:readline');
  return new Promise<string>(resolve => { const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true }); let hidden = false; const output = rl._writeToOutput.bind(rl); rl._writeToOutput = (text: string) => { if (!hidden) output(text); }; rl.question(question, answer => { hidden = false; process.stderr.write('\n'); rl.close(); resolve(answer); }); hidden = true; });
}
async function text(question: string) {
  const readline = require('node:readline/promises'), rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try { return await rl.question(question); } finally { rl.close(); }
}
async function stdinJSON() {
  if (process.stdin.isTTY) return {};
  const chunks = []; let bytes = 0;
  for await (const b of process.stdin) { bytes += b.length; if (bytes > 2097152) throw Error('INPUT_LIMIT'); chunks.push(b); }
  const value = Buffer.concat(chunks).toString('utf8').trim(); if (!value) return {}; return JSON.parse(value);
}
async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(help); return; }
  let workspace, action, id;
  const seen = new Set();
  for (let i = 0; i < args.length; i += 2) { const key = args[i], value = args[i + 1]; if (!['--workspace', '--action', '--profile'].includes(key) || !value || seen.has(key)) throw Error('INVALID_ARGUMENTS'); seen.add(key); if (key === '--workspace') workspace = value; else if (key === '--action') action = value; else id = value; }
  if (!workspace || !action) throw Error('WORKSPACE_AND_ACTION_REQUIRED');
  const input = await stdinJSON(); if (!input || Array.isArray(input) || typeof input !== 'object') throw Error('INVALID_INPUT');
  const keys = { configure: ['profile', 'password', 'passphrase', 'plaintext', 'confirmed'], profiles: [], fingerprint: [], trust: ['fingerprint', 'confirmed'], probe: ['root', 'passphrase'], read: ['root', 'path', 'passphrase'], write: ['root', 'path', 'text', 'expectedHash', 'confirmed', 'passphrase'], exec: ['root', 'file', 'args', 'confirmed', 'passphrase'], sync: ['root', 'passphrase'], offline: ['root', 'path'], resolve: ['root', 'confirmed'] }[action];
  if (!keys || Object.keys(input).some(k => !keys.includes(k))) throw Error('INVALID_INPUT');
  const store = new RemoteStore(workspace); let result;
  if (action === 'configure') {
    if (process.stdin.isTTY) {
      input.profile = { id: id || await text('Profile ID: '), host: await text('SSH hostname/address: '), port: Number(await text('SSH port [22]: ') || '22'), username: await text('Username: '), platform: await text('Remote OS (linux/win32): ') };
      const directory = await text('Remote absolute directory (optional; may come from project context): '); if (directory) input.profile.directory = directory;
      input.plaintext = (await text('Store password as plaintext? Type YES, otherwise encrypted: ')) === 'YES';
      input.password = await secret('SSH password: '); if (!input.plaintext) { input.passphrase = await secret('Encryption passphrase (12+ characters): '); if (input.passphrase !== await secret('Repeat encryption passphrase: ')) throw Error('PASSPHRASE_MISMATCH'); }
      input.confirmed = await text('Save these project-local settings? Type YES: ') === 'YES';
    }
    if (id && input.profile?.id !== id || input.plaintext !== undefined && typeof input.plaintext !== 'boolean') throw Error('INVALID_INPUT');
    result = await store.configure(input.profile, input.password, input.passphrase, input.plaintext === true, input.confirmed === true);
  } else if (action === 'profiles') result = { profiles: await store.profiles() };
  else {
    const p = await store.profile(id);
    if (action === 'fingerprint') result = await discover(p);
    else if (action === 'trust') {
      if (process.stdin.isTTY) { input.fingerprint = await text('Verified server SHA256 fingerprint: '); input.confirmed = await text('Trust this server? Type YES: ') === 'YES'; }
      result = await store.trust(p, input.fingerprint, input.confirmed === true);
    } else {
      if (process.stdin.isTTY && !['offline', 'resolve'].includes(action)) { const envelope = await store.read('credentials/' + p.id + '.json'); if (envelope.mode === 'encrypted') input.passphrase = await secret('Unlock project credentials: '); }
      result = await operation(store, id, { ...input, action });
    }
  }
  delete input.password; delete input.passphrase;
  console.log(JSON.stringify({ ok: true, result }));
}
if (require.main === module) main().catch(e => { console.error(JSON.stringify({ ok: false, error: /^[A-Z_]{3,80}$/.test(e.message) ? e.message : 'REMOTE_COMMAND_FAILED', hint: 'Check configuration, fingerprint, confirmation and operation journal. Unknown writes must be reconciled, not retried.' })); process.exitCode = 1; });
export { main };
