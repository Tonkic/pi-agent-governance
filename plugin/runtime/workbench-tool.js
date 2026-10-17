'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const workbenchTool = {
    name: 'governance_ui',
    description: 'Open, close or inspect the shared local browser workbench for this host-bound project. Open/close require confirmed:true after explicit user intent. Keeps the existing conversation/model; no directory selector, Agent launch or automatic init. Never accepts a path or URL and never returns private access credentials.',
    risk: 'medium',
    schema: {
        type: 'object', additionalProperties: false, required: ['action'],
        properties: { action: { type: 'string', enum: ['open', 'close', 'status'] }, confirmed: { type: 'boolean' } }
    }
};
async function invokeWorkbench(manager, root, args, isCurrent = async () => true) {
    if (!args || typeof args !== 'object' || Array.isArray(args) ||
        Object.keys(args).some(key => !['action', 'confirmed'].includes(key)) ||
        !['open', 'close', 'status'].includes(args.action) ||
        (args.confirmed !== undefined && typeof args.confirmed !== 'boolean'))
        throw Error('Invalid workbench arguments');
    if (!manager)
        throw Error('Browser workbench is unavailable');
    if (!(await isCurrent()))
        throw Error('Host project changed; retry only after checking current context');
    if (args.action === 'status') {
        const state = manager.status();
        return state.workspace === root ? state : { workspace: root, origin: null, open: false };
    }
    if (args.confirmed !== true)
        throw Error('Confirm explicit user intent to open or close the browser workbench');
    if (args.action === 'open')
        return manager.open(root, isCurrent);
    return manager.close(root);
}
module.exports = { workbenchTool, invokeWorkbench };
