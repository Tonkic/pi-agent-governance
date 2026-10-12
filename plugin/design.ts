'use strict';
const { createHash, randomUUID } = require('node:crypto');
const designFile = '.governance/architecture-design.json';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
function designText(value, name, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw Error(`Invalid design ${name} (max ${max})`);
  return value.trim();
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw Error('Invalid design timestamp');
  return value;
}
function designDiff(before, after) {
  const oldNodes = new Map((before?.nodes || []).map((n) => [n.id, n]));
  const nextNodes = new Map((after?.nodes || []).map((n) => [n.id, n]));
  const oldEdges = new Map((before?.edges || []).map((e) => [`${e.from}:${e.to}`, e]));
  const nextEdges = new Map((after?.edges || []).map((e) => [`${e.from}:${e.to}`, e]));
  const compare = (a, b) => ({
    added: [...b.keys()].filter((k) => !a.has(k)),
    removed: [...a.keys()].filter((k) => !b.has(k)),
    changed: [...b.keys()].filter((k) => a.has(k) && digest(a.get(k)) !== digest(b.get(k)))
  });
  const nodes = compare(oldNodes, nextNodes),
    edges = compare(oldEdges, nextEdges);
  return {
    addedNodes: nodes.added,
    removedNodes: nodes.removed,
    changedNodes: nodes.changed,
    addedEdges: edges.added,
    removedEdges: edges.removed,
    changedEdges: edges.changed,
    titleChanged: before?.title !== after?.title,
    documentChanged: before?.document !== after?.document
  };
}
class ArchitectureDesign {
  g: any;
  constructor(g) {
    this.g = g;
  }
  async raw() {
    try {
      return await this.g.read(designFile);
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  revision(raw) {
    return digest([this.g.root, this.g.expected ?? null, raw]);
  }
  async proposal(value) {
    if (
      !record(value) ||
      !Array.isArray(value.nodes) ||
      !value.nodes.length ||
      value.nodes.length > 40 ||
      !Array.isArray(value.edges) ||
      value.edges.length > 100
    )
      throw Error('Design proposal requires 1–40 nodes and 0–100 edges');
    const ids = new Set(),
      files = new Set();
    const nodes = [];
    for (const n of value.nodes) {
      if (
        !record(n) ||
        !id(n.id) ||
        ids.has(n.id) ||
        !Array.isArray(n.files) ||
        n.files.length > 10
      )
        throw Error('Invalid design node');
      ids.add(n.id);
      for (const f of n.files) {
        await this.g.safe(f);
        if (/^(\.governance|changes)(\/|$)/i.test(f) || /^STATE\.json$/i.test(f))
          throw Error('Design paths must reference project files, not governance data');
        files.add(f);
      }
      nodes.push({
        id: n.id,
        title: designText(n.title, 'node title', 100),
        description: designText(n.description, 'node description'),
        files: [...new Set(n.files)]
      });
    }
    if (files.size > 60) throw Error('Design references at most 60 files');
    const pairs = new Set();
    const edges = value.edges.map((e) => {
      if (
        !record(e) ||
        !ids.has(e.from) ||
        !ids.has(e.to) ||
        e.from === e.to ||
        pairs.has(`${e.from}:${e.to}`)
      )
        throw Error('Invalid design edge');
      pairs.add(`${e.from}:${e.to}`);
      return { from: e.from, to: e.to, label: designText(e.label, 'edge label', 100) };
    });
    return {
      title: designText(value.title, 'title', 160),
      document: designText(value.document, 'document', 20000),
      nodes,
      edges
    };
  }
  async data(raw) {
    if (raw === null) return { version: 1, history: [], draft: null, updatedAt: null };
    const d = JSON.parse(raw);
    if (
      !record(d) ||
      d.version !== 1 ||
      !Array.isArray(d.history) ||
      d.history.length > 20 ||
      (d.draft !== null && !record(d.draft))
    )
      throw Error('Invalid architecture design record');
    timestamp(d.updatedAt);
    for (const [i, b] of d.history.entries()) {
      if (
        !record(b) ||
        b.number !== i + 1 ||
        !id(b.taskId) ||
        b.baseVersion !== i ||
        b.method !== 'human'
      )
        throw Error('Invalid design baseline');
      const p = await this.proposal(b.proposal);
      if (b.proposalFingerprint !== digest(p)) throw Error('Design baseline content changed');
      designText(b.reason, 'reason', 2000);
      designText(b.reviewer, 'reviewer', 160);
      designText(b.conclusion, 'conclusion', 2000);
      timestamp(b.confirmedAt);
    }
    if (d.draft) {
      if (
        typeof d.draft.draftId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(d.draft.draftId) ||
        !id(d.draft.taskId) ||
        d.draft.baseVersion !== d.history.length
      )
        throw Error('Invalid design draft');
      designText(d.draft.reason, 'reason', 2000);
      timestamp(d.draft.updatedAt);
      if (d.draft.proposal !== null) {
        const p = await this.proposal(d.draft.proposal);
        if (d.draft.proposalFingerprint !== digest(p))
          throw Error('Design proposal content changed');
      } else if (d.draft.proposalFingerprint !== null) throw Error('Invalid empty design proposal');
    }
    return d;
  }
  async snapshot() {
    const raw = await this.raw();
    let d,
      error = null;
    try {
      d = await this.data(raw);
    } catch (e) {
      error = e.message;
    }
    if ((await this.raw()) !== raw || (await this.stateRaw()) !== (this.g.expected ?? null))
      throw Error('Design changed while reading; refresh');
    const baseline = d?.history.at(-1) || null;
    return {
      workspace: this.g.root,
      revision: this.revision(raw),
      baseline,
      history: d?.history || [],
      draft: d?.draft || null,
      diff: d?.draft?.proposal ? designDiff(baseline?.proposal, d.draft.proposal) : null,
      error
    };
  }
  async stateRaw() {
    try {
      return await this.g.read('STATE.json');
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  // Confirmation/discard are called by the confirmed panel whitelist, never registered Agent actions.
  async run(a) {
    return this.g.locked(async () => {
      if (a.action === 'architecture_design_snapshot') return this.snapshot();
      const raw = await this.raw();
      if (typeof a.expectedRevision !== 'string' || a.expectedRevision !== this.revision(raw))
        throw Error('Design stale or workspace switched; refresh');
      const state = await this.g.state();
      if (!state.task) throw Error('Start an approved project task first');
      const d = await this.data(raw),
        now = new Date().toISOString();
      if (a.action === 'architecture_design_begin') {
        if (d.draft) throw Error('A design draft already exists; resume or explicitly discard it');
        if (d.history.length >= 20)
          throw Error(
            'Design history full (20 baselines); preserve and archive manually before continuing'
          );
        d.draft = {
          draftId: randomUUID(),
          baseVersion: d.history.length,
          taskId: state.task,
          reason: designText(a.reason, 'reason', 2000),
          proposal: null,
          proposalFingerprint: null,
          updatedAt: now
        };
      } else if (a.action === 'architecture_design_discard') {
        if (!d.draft) throw Error('No design draft');
        d.draft = null; // Explicit panel action can discard an old task's draft, but never its baseline.
      } else {
        if (!d.draft) throw Error('Begin an explicit design draft first');
        if (d.draft.taskId !== state.task)
          throw Error('Design draft belongs to another task; discard explicitly before redesign');
        if (a.action === 'architecture_design_save') {
          if (a.expectedDraft !== d.draft.draftId)
            throw Error('Design draft replaced; stop the old design session');
          d.draft.proposal = await this.proposal(a.proposal);
          d.draft.proposalFingerprint = digest(d.draft.proposal);
          d.draft.updatedAt = now;
        } else if (a.action === 'architecture_design_confirm') {
          if (!d.draft.proposal) throw Error('Save a design proposal before confirming');
          if (a.expectedProposal !== d.draft.proposalFingerprint)
            throw Error('Design proposal changed; review before confirming');
          if (d.history.length >= 20) throw Error('Design history full');
          d.history.push({
            ...d.draft,
            number: d.history.length + 1,
            method: 'human',
            reviewer: designText(a.reviewer, 'reviewer', 160),
            conclusion: designText(a.conclusion, 'conclusion', 2000),
            confirmedAt: now
          });
          d.draft = null;
        } else throw Error('Unknown design action');
      }
      d.updatedAt = now;
      if ((await this.raw()) !== raw || (await this.stateRaw()) !== this.g.expected)
        throw Error('Design or task changed externally; refresh');
      const serialized = JSON.stringify(d, null, 2) + '\n';
      if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024)
        throw Error('Design data exceeds 1 MiB; shorten content without deleting history');
      await this.g.write(designFile, serialized);
      return { saved: true };
    });
  }
}
module.exports = { ArchitectureDesign, designFile, designDiff };
