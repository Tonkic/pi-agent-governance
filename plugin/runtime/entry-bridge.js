"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.entryBridge = entryBridge;
const node_crypto_1 = require("node:crypto");
function entryBridge(action, context) {
    const revision = (value) => (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(value)).digest('hex');
    return async (channel, payload) => {
        try {
            if (channel !== 'governance.entry' || !payload || typeof payload !== 'object' || Array.isArray(payload))
                throw Error();
            const opening = payload.action === 'open';
            const keys = opening ? ['action', 'confirmed', 'revision'] : ['action'];
            if ((!opening && payload.action !== 'status') || Object.keys(payload).some(key => !keys.includes(key)) ||
                (opening && (payload.confirmed !== true || !/^[a-f0-9]{64}$/.test(payload.revision))))
                throw Error();
            const before = await context(), current = revision(before);
            if (opening && payload.revision !== current)
                throw Error();
            const reply = await action(opening ? { action: 'open', confirmed: true } : { action: 'status' }, undefined, before);
            if (!reply.ok || revision(await context()) !== current || reply.result.workspace !== before.workspace)
                throw Error();
            // Only connection metadata. Never expose the private URL, origin, core data or raw host errors.
            return { ok: true, result: { workspace: before.workspace, open: opening || reply.result.open === true, revision: current } };
        }
        catch {
            return { ok: false, error: 'Entry request rejected. Refresh project status and check host permissions.' };
        }
    };
}
