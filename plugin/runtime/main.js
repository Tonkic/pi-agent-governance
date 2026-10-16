'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { Governance } = require('./core');
const { panelInvoke } = require('./panel');
const { operationInvoke, localSession } = require('./operations');
const { resolve } = require('node:path');
const tool = require('./tool');
const command = { id: 'governance.open', keywords: ['governance', '治理', '任务', 'git'] };
async function isChinese() {
    try {
        return /^zh/i.test((await pi.app?.getLocale()) || 'en');
    }
    catch {
        return false;
    }
}
async function execute(fn, context) {
    try {
        let root;
        if (context !== undefined) {
            const id = context.sessionId;
            if (typeof id !== 'string' || !id || id.length > 200 || context.signal?.aborted)
                throw Error('Host did not supply a valid live calling session; no project fallback');
            if (!pi.desktop?.invoke || !pi.desktop?.listOperations ||
                !(await pi.desktop.listOperations()).some(row => row.id === 'session/get'))
                throw Error('Host session binding is unavailable or not granted; use the project panel');
            const reply = await pi.desktop.invoke({ operation: 'session/get', args: [{ id, messageLimit: 1, contentLimit: 1 }] });
            if (reply?.ok === false || reply?.success === false || reply?.isError)
                throw Error('Calling session could not be verified');
            const session = (reply?.result ?? reply)?.session;
            if (session?.id !== id || typeof session.projectPath !== 'string' ||
                !localSession(session, resolve(session.projectPath)) || context.signal?.aborted)
                throw Error('Calling session has no supported local project; no project fallback');
            root = session.projectPath;
        }
        else {
            const workspace = await pi.workspace.get();
            if (!workspace?.path)
                throw Error((await isChinese()) ? '请先打开项目工作区' : 'Open a project workspace first');
            root = workspace.path;
        }
        return { ok: true, result: await fn(root) };
    }
    catch (error) {
        return { ok: false, error: error.message };
    }
}
async function onLoad() {
    await pi.agent.registerTool({
        ...tool,
        execute: (args, context) => execute((root) => new Governance(root).run(args), context ?? {})
    });
    await pi.commands.register({
        ...command,
        title: (await isChinese()) ? 'Agent Governance: 打开治理面板' : 'Agent Governance: Open panel',
        run: async () => pi.ui.openPanel({ title: (await isChinese()) ? 'Agent 项目治理' : 'Agent Governance' })
    });
}
async function onUnload() {
    await pi.agent.unregisterTool(tool.name);
    await pi.commands.unregister(command.id);
}
async function onPanelInvoke(channel, payload) {
    return execute((root) => {
        if (payload?.workspace !== undefined &&
            (typeof payload.workspace !== 'string' || resolve(payload.workspace) !== resolve(root)))
            throw Error('Workspace switched; refresh before continuing');
        return channel === 'governance.operation'
            ? operationInvoke(root, payload, pi.desktop, async () => resolve((await pi.workspace.get())?.path || '') === resolve(root), pi.models)
            : panelInvoke(root, channel, payload);
    });
}
module.exports = { onLoad, onUnload, onPanelInvoke };
