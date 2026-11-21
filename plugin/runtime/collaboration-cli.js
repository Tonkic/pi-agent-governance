#!/usr/bin/env node
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const { collaborate } = require('./collaboration');
async function main(args = process.argv.slice(2)) {
    if (args.length === 1 && args[0] === '--help') {
        console.log('collaboration --workspace ABSOLUTE_DIRECTORY --action authority|bind|inspect|read|publish|reconcile. JSON and GitHub token use stdin only. See docs/guides/collaboration.md.');
        return;
    }
    let workspace, action;
    const seen = new Set();
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i], value = args[i + 1];
        if (!['--workspace', '--action'].includes(key) || !value || seen.has(key))
            throw Error('INVALID_ARGUMENTS');
        seen.add(key);
        if (key === '--workspace')
            workspace = value;
        else
            action = value;
    }
    if (!workspace || !action)
        throw Error('WORKSPACE_AND_ACTION_REQUIRED');
    const chunks = [];
    let n = 0;
    if (process.stdin.isTTY)
        throw Error('JSON_STDIN_REQUIRED');
    for await (const b of process.stdin) {
        n += b.length;
        if (n > 65536)
            throw Error('INPUT_LIMIT');
        chunks.push(b);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    const input = raw ? JSON.parse(raw) : {};
    try {
        const result = await collaborate(workspace, action, input);
        console.log(JSON.stringify({ ok: true, result }));
    }
    finally {
        if (input && typeof input === 'object')
            delete input.token;
    }
}
if (require.main === module) {
    main().catch((e) => {
        console.error(JSON.stringify({
            ok: false,
            error: /^[A-Z_]{3,80}$/.test(e.message) ? e.message : 'COLLABORATION_FAILED',
            hint: 'GitHub binding does not fall back on connection failure. Reconcile unknown pushes; never retry blindly.'
        }));
        process.exitCode = 1;
    });
}
