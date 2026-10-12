'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { createHash } = require('node:crypto');
const bindingsFile = 'docs/behavior-bindings.json';
const evidenceFile = '.governance/behavior-evidence.json';
const textHash = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const hash = (value) => textHash(JSON.stringify(value));
const caseId = (id) => typeof id === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(id);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function pathCheck(file, document = false) {
    if (typeof file !== 'string' ||
        file.length > 240 ||
        (document
            ? !/^docs\/.+\.md$/.test(file)
            : !/^(?:plugin|src|test|scripts|types|docs)\//.test(file)))
        throw Error('Invalid behavior source path');
}
function validateBindings(value) {
    if (!isRecord(value) ||
        value.version !== 1 ||
        !Array.isArray(value.behaviors) ||
        !value.behaviors.length ||
        value.behaviors.length > 50)
        throw Error('Invalid behavior bindings');
    const ids = new Set();
    for (const item of value.behaviors) {
        if (!isRecord(item) || !/^[A-Z][A-Z0-9]*-[0-9]{3,6}$/.test(item.id || '') || ids.has(item.id))
            throw Error('Invalid or duplicate behavior ID');
        ids.add(item.id);
        pathCheck(item.document, true);
        for (const [name, values, limit] of [
            ['cases', item.cases, 20],
            ['files', item.files, 20]
        ]) {
            if (!Array.isArray(values) ||
                !values.length ||
                values.length > limit ||
                new Set(values).size !== values.length)
                throw Error('Invalid behavior ' + name);
        }
        if (!item.cases.every(caseId))
            throw Error('Invalid behavior case ID');
        item.files.forEach((file) => pathCheck(file));
    }
    return value;
}
async function optional(g, file) {
    try {
        return await g.read(file);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    }
}
async function behaviorContract(g) {
    const raw = await optional(g, bindingsFile);
    if (raw === null)
        return null;
    const bindings = validateBindings(JSON.parse(raw));
    const files = [
        ...new Set(bindings.behaviors.flatMap((item) => [item.document, ...item.files]))
    ].sort();
    if (files.length > 60)
        throw Error('Behavior contract references at most 60 files');
    const contents = {}, fingerprints = {};
    let size = 0;
    for (const file of files) {
        pathCheck(file, file.endsWith('.md') && file.startsWith('docs/'));
        const content = await g.read(file);
        size += content.length;
        if (size > 500000)
            throw Error('Behavior contract exceeds read budget');
        contents[file] = content;
        fingerprints[file] = textHash(content);
    }
    for (const document of new Set(bindings.behaviors.map((item) => item.document))) {
        const headings = [...contents[document].matchAll(/^### ([A-Z][A-Z0-9]*-[0-9]{3,6}) — /gm)];
        for (const heading of headings)
            if (!bindings.behaviors.some((item) => item.id === heading[1] && item.document === document))
                throw Error('Behavior document heading has no test binding: ' + heading[1]);
    }
    const behaviors = bindings.behaviors.map((item) => {
        const text = contents[item.document].replace(/\r\n/g, '\n');
        const sections = [...text.matchAll(/^### ([A-Z][A-Z0-9]*-[0-9]{3,6}) — (.+)$/gm)];
        const matches = sections.filter((section) => section[1] === item.id);
        if (matches.length !== 1)
            throw Error('Behavior document heading missing or duplicated: ' + item.id);
        const section = matches[0];
        const start = section.index + section[0].length;
        const nextHeading = /^#{1,3} /gm;
        nextHeading.lastIndex = start;
        const end = nextHeading.exec(text)?.index ?? text.length;
        const prose = text.slice(start, end).trim();
        if (!prose || prose.length > 12000)
            throw Error('Invalid behavior explanation');
        return { ...item, title: section[2], prose };
    });
    return { bindings, behaviors, fingerprints, fingerprint: hash({ bindings, fingerprints }) };
}
function validateEvidence(value) {
    if (!isRecord(value) ||
        value.version !== 1 ||
        typeof value.workspace !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.contractFingerprint || '') ||
        !/^[a-f0-9]{40}$/.test(value.sourceCommit || '') ||
        !Number.isFinite(Date.parse(value.at)) ||
        value.environment !== 'isolated-browser' ||
        (value.phase !== undefined && !['running', 'completed'].includes(value.phase)) ||
        typeof value.workingTree !== 'boolean' ||
        typeof value.suitePassed !== 'boolean' ||
        !Array.isArray(value.cases) ||
        value.cases.length > 100)
        throw Error('Invalid behavior evidence');
    const seen = new Set();
    for (const row of value.cases) {
        if (!isRecord(row) ||
            !caseId(row.id) ||
            seen.has(row.id) ||
            !['passed', 'failed', 'skipped'].includes(row.status))
            throw Error('Invalid or duplicate behavior evidence case');
        seen.add(row.id);
    }
    return value;
}
function behaviorState(contract, evidence, root) {
    if (!evidence)
        return contract.behaviors.map((item) => ({ ...item, status: 'unverified' }));
    validateEvidence(evidence);
    const matching = evidence.workspace === root && evidence.contractFingerprint === contract.fingerprint;
    return contract.behaviors.map((item) => {
        const cases = item.cases.map((id) => ({
            id,
            status: evidence.cases.find((row) => row.id === id)?.status || 'missing'
        }));
        const status = !matching
            ? 'stale'
            : evidence.phase === 'running'
                ? 'checking'
                : !evidence.suitePassed || cases.some((row) => row.status === 'failed')
                    ? 'failed'
                    : cases.some((row) => row.status !== 'passed')
                        ? 'incomplete'
                        : 'passed';
        return {
            ...item,
            status,
            cases,
            sourceCommit: evidence.sourceCommit,
            workingTree: evidence.workingTree,
            at: evidence.at,
            environment: evidence.environment
        };
    });
}
async function behaviorSnapshot(g) {
    const contract = await behaviorContract(g);
    if (!contract)
        return { workspace: g.root, behaviors: [], configured: false };
    const raw = await optional(g, evidenceFile);
    const evidence = raw === null ? null : validateEvidence(JSON.parse(raw));
    const result = behaviorState(contract, evidence, g.root);
    // Refuse a mixed snapshot if the document, bindings, source, tests or evidence changed while reading.
    const fresh = await behaviorContract(g);
    if (fresh?.fingerprint !== contract.fingerprint || (await optional(g, evidenceFile)) !== raw)
        throw Error('Behavior data changed while reading; refresh');
    return { workspace: g.root, configured: true, behaviors: result };
}
module.exports = {
    behaviorContract,
    behaviorSnapshot,
    behaviorState,
    validateBindings,
    validateEvidence,
    textHash,
    evidenceFile
};
