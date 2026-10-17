'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { Governance } = require('./core');
const { createHash } = require('node:crypto');
const { behaviorSnapshot } = require('./behaviors');
const fingerprint = (g, raw) => createHash('sha256')
    .update(JSON.stringify([g.root, raw ?? null]))
    .digest('hex');
async function panelInvoke(root, channel, payload = {}) {
    const g = new Governance(root);
    if (channel === 'governance.documents')
        return require('./documents').documents(root, payload);
    if (channel === 'governance.behaviors')
        return g.locked(() => behaviorSnapshot(g));
    if (channel === 'governance.design') {
        const { ArchitectureDesign } = require('./design');
        const design = new ArchitectureDesign(g);
        if (payload.action === 'snapshot')
            return design.run({ action: 'architecture_design_snapshot' });
        if (payload.confirmed !== true)
            throw Error('请先确认设计操作 / Confirm design action');
        const fields = { begin: ['reason'], confirm: ['expectedProposal', 'reviewer', 'conclusion'], discard: [] };
        if (!Object.hasOwn(fields, payload.action))
            throw Error('Design panel action not allowed');
        const args = { action: 'architecture_design_' + payload.action, expectedRevision: payload.revision };
        for (const key of fields[payload.action])
            args[key] = payload[key];
        return design.run(args);
    }
    if (channel === 'governance.snapshot') {
        return g.locked(async () => {
            const raw = g.expected;
            const state = raw === undefined ? null : await g.state();
            if (raw !== undefined && (await g.read('STATE.json')) !== raw)
                throw Error('状态读取期间发生变化，请刷新');
            return { workspace: g.root, state, revision: fingerprint(g, raw) };
        });
    }
    if (channel === 'governance.git')
        return { ...(await g.run({ action: 'git_status' })), workspace: g.root };
    if (channel === 'governance.project')
        return g.run({ action: 'project_snapshot', checkSources: payload.checkSources === true });
    if (channel === 'governance.workitem') {
        if (payload.confirmed !== true)
            throw Error('请先确认写入');
        const input = payload.args || {};
        const allowed = {
            board_create: ['id', 'title', 'description', 'criteria', 'gitTaskId', 'architectureImpact'],
            board_update: ['id', 'title', 'description', 'criteria', 'blocker', 'architectureImpact'],
            board_move: ['id', 'stage', 'position']
        };
        if (!Object.hasOwn(allowed, input.action))
            throw Error('Panel action not allowed');
        const args = { action: input.action, expectedRevision: payload.revision };
        for (const key of allowed[input.action])
            if (input[key] !== undefined)
                args[key] = input[key];
        return g.run(args);
    }
    if (channel !== 'governance.mutate')
        throw Error('Unsupported panel channel');
    if (payload.confirmed !== true)
        throw Error('请先确认写入');
    if (typeof payload.revision !== 'string' || !/^[a-f0-9]{64}$/.test(payload.revision))
        throw Error('请先刷新状态');
    const input = payload.args || {};
    const fields = {
        init: [],
        start: ['id', 'goal', 'criteria', 'scope', 'constraints'],
        progress: ['current', 'next', 'blocked']
    };
    if (!Object.hasOwn(fields, input.action))
        throw Error('Panel action not allowed');
    const args = { action: input.action, expectedState: payload.revision };
    for (const key of fields[input.action])
        if (input[key] !== undefined)
            args[key] = input[key];
    return g.run(args);
}
module.exports = { panelInvoke };
