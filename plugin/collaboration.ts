'use strict';
const { RemoteStore } = require('./remote-store');
const { collaborationProgram } = require('./collaboration-program');
function bindingOK(b: any) {
  if (!b || Object.keys(b).some(k => !['version', 'repository', 'branch'].includes(k)) || b.version !== 1 || typeof b.repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(b.repository) || b.repository.endsWith('.git') || typeof b.branch !== 'string' || b.branch.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(b.branch) || b.branch.includes('..') || b.branch.includes('//') || b.branch.split('/').some(x => !x || x.startsWith('.') || x.endsWith('.') || x.endsWith('.lock'))) throw Error('INVALID_GITHUB_BINDING');
  return b;
}
async function readBinding(store: any) {
  try { const file = await store.safe('github.json'); await require('node:fs/promises').lstat(file); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  return bindingOK(await store.read('github.json'));
}
async function authority(store: any, profile?: string, root?: string) {
  // A malformed or unreachable GitHub binding is never treated as absence.
  const b = await readBinding(store);
  if (b !== null) return { authority: 'github', ...bindingOK(b), available: 'unchecked' };
  if (profile !== undefined) { const p = await store.profile(profile); const remoteRoot = root ?? p.directory; if (!require('./remote-ssh').rootOK(remoteRoot, p)) throw Error('ABSOLUTE_REMOTE_DIRECTORY_REQUIRED'); return { authority: 'ssh', profile, root: remoteRoot, available: 'unchecked' }; }
  if (root !== undefined) throw Error('SSH_PROFILE_REQUIRED');
  return { authority: 'local', root: store.root, available: true };
}
async function collaborate(workspace: string, action: string, input: any = {}, profile?: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('INVALID_INPUT');
  const keys = { authority: ['root'], bind: ['repository', 'branch', 'token', 'confirmed'], inspect: ['root', 'token', 'passphrase'], read: ['root', 'token', 'passphrase', 'path'], publish: ['root', 'token', 'passphrase', 'expectedHead', 'target', 'confirmed'], reconcile: ['root', 'token', 'passphrase'] }[action];
  if (!keys || Object.keys(input).some(k => !keys.includes(k))) throw Error('INVALID_INPUT');
  const store = new RemoteStore(workspace);
  if (action === 'bind') {
    if (profile !== undefined) throw Error('BIND_FROM_LOCAL_WORKSPACE');
    if (input.confirmed !== true) throw Error('CONFIRMATION_REQUIRED');
    const b = bindingOK({ version: 1, repository: input.repository, branch: input.branch });
    await store.guardGit();
    return store.lock(async () => {
      const previous = await readBinding(store); if (previous !== null) throw Error('GITHUB_ALREADY_BOUND');
      const inspected = await collaborationProgram({ root: store.root, action: 'inspect', repository: b.repository, branch: b.branch, token: input.token });
      await store.atomic('github.json', b, true);
      return { ...inspected, bound: true };
    });
  }
  const selected = await authority(store, profile, input.root);
  if (action === 'authority') return selected;
  if (selected.authority !== 'github') {
    if (action !== 'read' && action !== 'inspect') throw Error('GITHUB_BINDING_REQUIRED');
    if (selected.authority === 'ssh') return { authority: 'ssh', result: await require('./remote-ssh').operation(store, profile, { action: action === 'inspect' ? 'probe' : 'read', root: selected.root, path: input.path, passphrase: input.passphrase }) };
    if (action === 'inspect') return selected;
    const r = await require('./documents').documents(store.root, { action: 'read', path: input.path });
    return { authority: 'local', result: r };
  }
  const request = { root: store.root, action, repository: selected.repository, branch: selected.branch, token: input.token, ...(action === 'read' ? { path: input.path } : {}), ...(action === 'publish' ? { expectedHead: input.expectedHead, target: input.target, confirmed: input.confirmed } : {}) };
  if (profile === undefined) { if (input.root !== undefined) throw Error('SSH_PROFILE_REQUIRED'); return collaborationProgram(request); }
  const { connect, rpc, rootOK } = require('./remote-ssh'), p = await store.profile(profile), root = input.root ?? p.directory;
  if (!rootOK(root, p)) throw Error('ABSOLUTE_REMOTE_DIRECTORY_REQUIRED');
  return store.lock(async () => {
    await store.guardGit(); const trusted = await store.trusted(p); if (!trusted) throw Error('HOST_FINGERPRINT_NOT_TRUSTED');
    let password = await store.password(p, input.passphrase), c;
    try {
      c = await connect(p, password, trusted);
      const previous = await store.journal(p, root);
      if (action === 'publish') {
        if (input.confirmed !== true) throw Error('CONFIRMATION_REQUIRED');
        if (previous?.status === 'unknown') throw Error('PREVIOUS_RESULT_UNKNOWN_RECONCILE_FIRST');
        await store.journal(p, root, { status: 'unknown', action: 'github-publish', expectedHead: input.expectedHead, repository: selected.repository, branch: selected.branch });
      }
      // No installation or shell command is constructed from user input; fixed trusted function and bounded stdin only.
      const result = await rpc(c, { ...request, root }, true);
      if (!result || result.authority !== 'github' || result.repository !== selected.repository || result.branch !== selected.branch || result.root !== root) throw Error('INVALID_COLLABORATION_RESPONSE');
      if (action === 'publish' || action === 'reconcile' && previous?.action === 'github-publish' && result.pushStatus === 'saved') await store.journal(p, root, { status: 'saved', action: 'github-publish', submittedHead: result.submittedHead, target: result.target });
      return result;
    } finally { password = ''; c?.end(); c?.destroy(); }
  });
}
export { authority, bindingOK, collaborate };
