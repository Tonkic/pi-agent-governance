'use strict';
const { Governance } = require('./core');
const { panelInvoke } = require('./panel');
const tool = require('./tool');
const command = { id: 'governance.open', keywords: ['governance', '治理', '任务', 'git'] };
async function isChinese() { try { return /^zh/i.test(await pi.app?.getLocale() || 'en'); } catch { return false; } }
async function execute(fn) {
  try {
    const workspace = await pi.workspace.get();
    if (!workspace?.path) throw Error(await isChinese() ? '请先打开项目工作区' : 'Open a project workspace first');
    return { ok: true, result: await fn(workspace.path) };
  } catch (error) { return { ok: false, error: error.message }; }
}
async function onLoad() {
  await pi.agent.registerTool({ ...tool, execute: args => execute(root => new Governance(root).run(args)) });
  await pi.commands.register({ ...command, title: await isChinese() ? 'Agent Governance: 打开治理面板' : 'Agent Governance: Open panel', run: async () => pi.ui.openPanel({ title: await isChinese() ? 'Agent 项目治理' : 'Agent Governance' }) });
}
async function onUnload() {
  await pi.agent.unregisterTool(tool.name);
  await pi.commands.unregister(command.id);
}
async function onPanelInvoke(channel, payload) { return execute(root => panelInvoke(root, channel, payload)); }
module.exports = { onLoad, onUnload, onPanelInvoke };
