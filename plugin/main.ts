'use strict';
const { Governance } = require('./core');
const { localSession } = require('./operations');
const { resolve } = require('node:path');
const { BrowserWorkbench } = require('./workbench');
const { workbenchTool, invokeWorkbench } = require('./workbench-tool');
const tool = require('./tool');
const command = { id: 'governance.open', keywords: ['governance', '治理', '任务', 'browser', '浏览器'] };
let workbench: any = null;
let loaded = false;
let workspaceHooked = false;
let epoch = 0;
async function isChinese() {
  try { return /^zh/i.test((await pi.app?.getLocale()) || 'en'); } catch { return false; }
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Host context query timed out; no project fallback')), 10000);
    })]);
  } finally { clearTimeout(timer); }
}
async function workspaceRoot(context?: any) {
  if (context !== undefined) {
    const id = context.sessionId;
    if (typeof id !== 'string' || !id || id.length > 200 || context.signal?.aborted)
      throw Error('Host did not supply a valid live calling session; no project fallback');
    if (!pi.desktop?.invoke || !pi.desktop?.listOperations ||
        !(await bounded(pi.desktop.listOperations()) as any[]).some(row => row.id === 'session/get'))
      throw Error('Host session binding is unavailable or not granted; reconnect a supported host');
    const reply: any = await bounded(pi.desktop.invoke({ operation: 'session/get', args: [{ id, messageLimit: 1, contentLimit: 1 }] }));
    if (reply?.ok === false || reply?.success === false || reply?.isError) throw Error('Calling session could not be verified');
    const session = (reply?.result ?? reply)?.session;
    if (session?.id !== id || typeof session.projectPath !== 'string' ||
        !localSession(session, resolve(session.projectPath)) || context.signal?.aborted)
      throw Error('Calling session has no supported local project; no project fallback');
    return resolve(session.projectPath);
  }
  const workspace = await bounded(pi.workspace.get()) as any;
  if (!workspace?.path)
    throw Error((await isChinese()) ? '请先在宿主打开项目' : 'Open a project in the host first');
  return resolve(workspace.path);
}
async function execute(fn, context?: any) {
  try { return { ok: true, result: await fn(await workspaceRoot(context)) }; }
  catch (error) { return { ok: false, error: error.message }; }
}
async function uiAction(args, context?: any) {
  const owner = epoch;
  return execute(async root => {
    if (!loaded || !workbench) throw Error('Browser workbench is unavailable');
    if (args?.action === 'open' && !workspaceHooked)
      throw Error('Host workspace lifecycle events are unavailable; browser startup refused');
    const current = async () => loaded && owner === epoch &&
      (await workspaceRoot(context)) === root;
    return invokeWorkbench(workbench, root, args, current);
  }, context);
}
async function workspaceChanged() {
  // Revoke the previous capability instead of ever redirecting it to another project.
  epoch++;
  await workbench?.close();
}
async function onLoad() {
  if (loaded) return;
  loaded = true;
  epoch++;
  workbench = new BrowserWorkbench({
    assetRoot: resolve(__dirname, '..'), webAssetsRoot: resolve(__dirname, 'web'),
    openExternal: async url => {
      if (!pi.shell?.openExternal) throw Error('shell.openExternal is unavailable or not granted');
      await pi.shell.openExternal(url);
    }
  });
  try {
    if (pi.events?.on && pi.events?.off) {
      await pi.events.on('workspace:changed', workspaceChanged);
      workspaceHooked = true;
    }
    await pi.agent.registerTool({ ...tool,
      execute: (args, context) => execute(root => new Governance(root).run(args), context ?? {}) });
    await pi.agent.registerTool({ ...workbenchTool,
      execute: (args, context) => uiAction(args, context ?? {}) });
    await pi.commands.register({ ...command,
      title: (await isChinese()) ? 'Agent Governance: 打开浏览器工作台' : 'Agent Governance: Open browser workbench',
      run: async () => {
        const reply = await uiAction({ action: 'open', confirmed: true });
        if (!reply.ok) throw Error(reply.error);
        return reply.result;
      }
    });
  } catch (error) {
    await onUnload().catch(() => {});
    throw error;
  }
}
async function onUnload() {
  loaded = false;
  epoch++;
  const owned = workbench;
  workbench = null;
  try {
    const cleanup = [() => pi.agent.unregisterTool(tool.name), () => pi.agent.unregisterTool(workbenchTool.name), () => pi.commands.unregister(command.id)];
    if (workspaceHooked) cleanup.push(() => Promise.resolve(pi.events.off('workspace:changed', workspaceChanged)));
    workspaceHooked = false;
    const settled = await Promise.allSettled(cleanup.map(fn => Promise.resolve().then(fn)));
    const failed = settled.find(row => row.status === 'rejected') as PromiseRejectedResult;
    if (failed) throw failed.reason;
  } finally { await owned?.dispose(); }
}
module.exports = { onLoad, onUnload };
