'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex');
const boardFile = '.governance/board.json', architectureFile = '.governance/architecture.json';
const stages = ['todo', 'doing', 'done'];
const identifier = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
function text(value, name, max = 4000, empty = false) {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()))
        throw Error(`${name}: invalid text (max ${max})`);
    return value.trim();
}
class ProjectData {
    g;
    constructor(g) { this.g = g; }
    async raw(file) { try {
        return await this.g.read(file);
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return null;
        throw e;
    } }
    revision(raws) { return digest(JSON.stringify([this.g.root, this.g.expected ?? null, ...raws])); }
    async sourcePath(file) {
        await this.g.safe(file);
        if (/^(\.governance|changes)(\/|$)/i.test(file) || /^STATE\.json$/i.test(file))
            throw Error('Reference project source, not governance data');
    }
    board(raw) {
        if (raw === null)
            return { version: 1, items: [], updatedAt: null };
        const b = JSON.parse(raw);
        if (b.version !== 1 || !Array.isArray(b.items) || b.items.length > 100)
            throw Error('Invalid board schema');
        const ids = new Set();
        for (const item of b.items) {
            if (!identifier(item.id) || ids.has(item.id) || !stages.includes(item.stage))
                throw Error('Invalid board item');
            ids.add(item.id);
            text(item.title, 'title', 160);
            text(item.description, 'description', 4000, true);
            text(item.blocker, 'blocker', 1000, true);
            if (item.stage === 'done' && item.blocker)
                throw Error('Blocked work item cannot be done');
            for (const key of ['taskId', 'gitTaskId'])
                if (item[key] !== null && !identifier(item[key]))
                    throw Error('Invalid linked task');
        }
        return b;
    }
    async graph(value) {
        if (!value || !Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > 40 || !Array.isArray(value.edges) || value.edges.length > 100)
            throw Error('Graph requires 1–40 nodes and 0–100 edges');
        const title = text(value.title, 'graph title', 160), source = text(value.source, 'source description', 1000);
        const ids = new Set(), files = new Set();
        const nodes = [];
        for (const node of value.nodes) {
            if (!identifier(node.id) || ids.has(node.id))
                throw Error('Invalid or duplicate graph node');
            ids.add(node.id);
            if (!Array.isArray(node.files) || !node.files.length || node.files.length > 10)
                throw Error('Each node needs 1–10 source paths');
            for (const file of node.files) {
                await this.sourcePath(file);
                files.add(file);
            }
            nodes.push({ id: node.id, title: text(node.title, 'node title', 100), description: text(node.description, 'node description'), files: [...new Set(node.files)] });
        }
        if (files.size > 60)
            throw Error('Graph references at most 60 files');
        const seen = new Set();
        const edges = value.edges.map(edge => {
            if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || seen.has(`${edge.from}:${edge.to}`))
                throw Error('Invalid or duplicate graph edge');
            seen.add(`${edge.from}:${edge.to}`);
            return { from: edge.from, to: edge.to, label: text(edge.label, 'edge label', 100) };
        });
        if (!value.fingerprints || typeof value.fingerprints !== 'object' || Object.keys(value.fingerprints).length !== files.size)
            throw Error('Source fingerprints required; call architecture_sources first');
        const fingerprints = {};
        for (const file of files) {
            if (!/^[a-f0-9]{64}$/.test(value.fingerprints[file] || ''))
                throw Error(`Missing source fingerprint: ${file}`);
            fingerprints[file] = value.fingerprints[file];
        }
        return { title, source, nodes, edges, fingerprints };
    }
    async sources(files) {
        if (!Array.isArray(files) || !files.length || files.length > 60)
            throw Error('Provide 1–60 source files');
        const contents = {}, fingerprints = {};
        let size = 0;
        for (const file of files) {
            await this.sourcePath(file);
            const content = await this.g.read(file);
            size += content.length;
            if (size > 180000)
                throw Error('Source request exceeds 180000 characters; narrow selection');
            contents[file] = content;
            fingerprints[file] = digest(content);
        }
        return { workspace: this.g.root, contents, fingerprints };
    }
    async snapshot() {
        const raws = [await this.raw(boardFile), await this.raw(architectureFile)];
        let board = null, architecture = null, boardError = null, architectureError = null;
        try {
            board = this.board(raws[0]);
        }
        catch (e) {
            boardError = e.message;
        }
        try {
            if (raws[1] !== null) {
                const stored = JSON.parse(raws[1]);
                if (stored.version !== 1 || typeof stored.updatedAt !== 'string')
                    throw Error('Invalid architecture schema');
                architecture = { ...await this.graph(stored), version: 1, updatedAt: stored.updatedAt, staleFiles: [] };
                for (const [file, expected] of Object.entries(architecture.fingerprints)) {
                    try {
                        if (digest(await this.g.read(file)) !== expected)
                            architecture.staleFiles.push(file);
                    }
                    catch {
                        architecture.staleFiles.push(file);
                    }
                }
            }
        }
        catch (e) {
            architectureError = e.message;
        }
        if (await this.raw(boardFile) !== raws[0] || await this.raw(architectureFile) !== raws[1] || await this.raw('STATE.json') !== (this.g.expected ?? null))
            throw Error('Project data changed while reading; refresh');
        return { workspace: this.g.root, revision: this.revision(raws), board, architecture: architectureError ? null : architecture, boardError, architectureError };
    }
    async run(a) {
        return this.g.locked(async () => {
            if (a.action === 'project_snapshot')
                return this.snapshot();
            if (a.action === 'architecture_sources')
                return this.sources(a.files);
            const raws = [await this.raw(boardFile), await this.raw(architectureFile)];
            if (typeof a.expectedRevision !== 'string' || a.expectedRevision !== this.revision(raws))
                throw Error('Project data stale or workspace switched; refresh before writing');
            const state = await this.g.state(); // No project writes into uninitialized/malformed governance.
            let file, result;
            if (a.action === 'architecture_set') {
                const graph = await this.graph(a.graph);
                for (const [p, h] of Object.entries(graph.fingerprints))
                    if (digest(await this.g.read(p)) !== h)
                        throw Error(`Source changed; reread: ${p}`);
                file = architectureFile;
                result = { version: 1, ...graph, updatedAt: new Date().toISOString() };
            }
            else {
                const b = this.board(raws[0]);
                if (a.action === 'board_create') {
                    if (!identifier(a.id) || b.items.some(i => i.id === a.id) || b.items.length >= 100)
                        throw Error('Invalid/duplicate work item id or board full');
                    if (a.gitTaskId) {
                        if (!identifier(a.gitTaskId) || !(await this.g.run({ action: 'git_status' })).tasks.some(t => t.id === a.gitTaskId))
                            throw Error('Unknown Git task');
                    }
                    b.items.push({ id: a.id, title: text(a.title, 'title', 160), description: text(a.description ?? '', 'description', 4000, true), blocker: '', stage: 'todo', taskId: state.task, gitTaskId: a.gitTaskId || null });
                }
                else {
                    const item = b.items.find(i => i.id === a.id);
                    if (!item)
                        throw Error('Work item not found');
                    if (a.action === 'board_update') {
                        item.title = text(a.title, 'title', 160);
                        item.description = text(a.description ?? '', 'description', 4000, true);
                        item.blocker = text(a.blocker ?? '', 'blocker', 1000, true);
                        if (item.blocker && item.stage === 'done')
                            throw Error('Reopen work item before adding a blocker');
                    }
                    else if (a.action === 'board_move') {
                        if (!stages.includes(a.stage) || Math.abs(stages.indexOf(item.stage) - stages.indexOf(a.stage)) > 1)
                            throw Error('Only adjacent work-item stages are allowed');
                        if (item.blocker && a.stage === 'done')
                            throw Error('Resolve work-item blocker first');
                        if (!Number.isInteger(a.position) || a.position < 0)
                            throw Error('Invalid position');
                        const remaining = b.items.filter(i => i.id !== a.id);
                        const column = remaining.filter(i => i.stage === a.stage);
                        if (a.position > column.length)
                            throw Error('Position outside column');
                        item.stage = a.stage;
                        const anchor = column[a.position];
                        remaining.splice(anchor ? remaining.indexOf(anchor) : remaining.length, 0, item);
                        b.items = remaining;
                    }
                    else
                        throw Error('Unknown project action');
                }
                b.updatedAt = new Date().toISOString();
                file = boardFile;
                result = b;
            }
            if (await this.raw(boardFile) !== raws[0] || await this.raw(architectureFile) !== raws[1] || await this.g.read('STATE.json') !== this.g.expected)
                throw Error('Project changed externally; reload before retrying');
            const serialized = JSON.stringify(result, null, 2) + '\n';
            if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024)
                throw Error('Project data exceeds 1 MiB; shorten descriptions before saving');
            await this.g.write(file, serialized);
            return result;
        });
    }
}
module.exports = { ProjectData };
