'use strict';
const { Governance } = require('./core');
const tool = require('./tool');
async function onLoad() {
  await pi.agent.registerTool({ ...tool, execute: async args => {
    try {
      const workspace = await pi.workspace.get();
      if (!workspace?.path) throw Error('Open a project workspace first');
      return { ok: true, result: await new Governance(workspace.path).run(args) };
    } catch (error) { return { ok: false, error: error.message }; }
  } });
}
async function onUnload() { await pi.agent.unregisterTool(tool.name); }
module.exports = { onLoad, onUnload };
