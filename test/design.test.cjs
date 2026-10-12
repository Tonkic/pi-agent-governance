'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Governance } = require('../plugin/runtime/core');
const { panelInvoke } = require('../plugin/runtime/panel');
const file = '.governance/architecture-design.json';
const proposal = (title = 'Local-first governance') => ({
  title,
  document:
    '## Purpose\nKeep project intent and implementation separate.\n## Decisions\nUse local JSON; no server.\n## Limits\nCaller evidence is not authentication.',
  nodes: [
    { id: 'governance', title: 'Governance', description: 'Owns task intent', files: [] },
    { id: 'view', title: 'Canvas', description: 'Shows the proposed responsibilities', files: [] }
  ],
  edges: [{ from: 'view', to: 'governance', label: 'reads intent' }]
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'design-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const g = new Governance(root);
  await g.run({ action: 'init' });
  await g.run({ action: 'start', id: 'approved', goal: 'Design', criteria: ['Stable baseline'] });
  const snapshot = () => g.run({ action: 'architecture_design_snapshot' });
  const mutate = async (action, fields = {}) => {
    const s = await snapshot();
    return g.run({
      action,
      ...(action === 'architecture_design_save' ? { expectedDraft: s.draft?.draftId } : {}),
      ...fields,
      expectedRevision: s.revision
    });
  };
  const confirm = async () => {
    const s = await snapshot();
    return panelInvoke(root, 'governance.design', {
      action: 'confirm',
      revision: s.revision,
      expectedProposal: s.draft.proposalFingerprint,
      reviewer: 'Human fixture',
      conclusion: 'Reviewed document and graph',
      confirmed: true
    });
  };
  return { root, g, snapshot, mutate, confirm };
}
test('design reads are noncreating and baselines are stable through unrelated project updates', async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.root, 'STATE.json'), 'utf8');
  assert.equal((await f.snapshot()).baseline, null);
  await assert.rejects(fs.access(path.join(f.root, file)), { code: 'ENOENT' });
  await f.mutate('architecture_design_begin', { reason: 'First design' });
  await f.mutate('architecture_design_save', { proposal: proposal() });
  await f.confirm();
  const stored = await fs.readFile(path.join(f.root, file), 'utf8');
  const s = await f.g.run({ action: 'project_snapshot' });
  await f.g.run({
    action: 'board_create',
    id: 'ordinary-update',
    title: 'Ordinary update',
    expectedRevision: s.revision
  });
  assert.equal(await fs.readFile(path.join(f.root, file), 'utf8'), stored);
  assert.equal(await fs.readFile(path.join(f.root, 'STATE.json'), 'utf8'), before);
  assert.equal((await f.snapshot()).baseline.number, 1);
  assert.equal((await f.g.run({ action: 'project_snapshot' })).architecture, null);
});
test('explicit revision preserves baseline, exposes differences, appends history and supports discard', async (t) => {
  const f = await fixture(t);
  await f.mutate('architecture_design_begin', { reason: 'First' });
  await f.mutate('architecture_design_save', { proposal: proposal() });
  await f.confirm();
  const old = (await f.snapshot()).baseline;
  await assert.rejects(
    f.mutate('architecture_design_save', { proposal: proposal('Bypass') }),
    /draft/i
  );
  await f.mutate('architecture_design_begin', { reason: 'Separate module boundary' });
  const next = proposal('Revised');
  next.nodes.push({
    id: 'evidence',
    title: 'Evidence',
    description: 'Reports actual checks',
    files: []
  });
  await f.mutate('architecture_design_save', { proposal: next });
  const pending = await f.snapshot();
  assert.deepEqual(pending.baseline, old);
  assert.equal(pending.draft.baseVersion, 1);
  assert.deepEqual(pending.diff.addedNodes, ['evidence']);
  assert.equal(pending.diff.documentChanged, false);
  await f.confirm();
  assert.deepEqual((await f.snapshot()).history[0], old);
  assert.equal((await f.snapshot()).baseline.number, 2);
  await f.mutate('architecture_design_begin', { reason: 'Not needed' });
  const current = (await f.snapshot()).baseline;
  await panelInvoke(f.root, 'governance.design', {
    action: 'discard',
    revision: (await f.snapshot()).revision,
    confirmed: true
  });
  assert.deepEqual((await f.snapshot()).baseline, current);
  assert.equal((await f.snapshot()).draft, null);
});
test('confirmation requires reviewed content and panel confirmation; Agent tool cannot confirm', async (t) => {
  const f = await fixture(t);
  await f.mutate('architecture_design_begin', { reason: 'First' });
  await assert.rejects(f.confirm(), /proposal/i);
  await f.mutate('architecture_design_save', { proposal: proposal() });
  const old = await f.snapshot();
  await assert.rejects(
    f.g.run({ action: 'architecture_design_confirm', expectedRevision: old.revision }),
    /Unknown/
  );
  await assert.rejects(
    panelInvoke(f.root, 'governance.design', {
      action: 'confirm',
      revision: old.revision,
      confirmed: false
    }),
    /确认|Confirm/
  );
  await assert.rejects(
    panelInvoke(f.root, 'governance.design', {
      action: 'confirm',
      revision: old.revision,
      expectedProposal: '0'.repeat(64),
      reviewer: 'Human',
      conclusion: 'Yes',
      confirmed: true
    }),
    /proposal.*changed/i
  );
  await f.mutate('architecture_design_save', { proposal: proposal('Changed') });
  await assert.rejects(
    panelInvoke(f.root, 'governance.design', {
      action: 'confirm',
      revision: old.revision,
      expectedProposal: old.draft.proposalFingerprint,
      reviewer: 'Human',
      conclusion: 'Yes',
      confirmed: true
    }),
    /stale|switched/i
  );
  assert.equal((await f.snapshot()).baseline, null);
});
test('design rejects foreign revisions, changed task, unsafe paths and invalid graph without replacing records', async (t) => {
  const a = await fixture(t),
    b = await fixture(t);
  await assert.rejects(
    b.g.run({
      action: 'architecture_design_begin',
      reason: 'Wrong project',
      expectedRevision: (await a.snapshot()).revision
    }),
    /stale|switched/i
  );
  await a.mutate('architecture_design_begin', { reason: 'First' });
  for (const bad of [
    null,
    [],
    { ...proposal(), nodes: [null] },
    { ...proposal(), edges: [null] },
    { ...proposal(), nodes: [{ id: 'x', title: 'Bad', description: 'Bad', files: ['.env'] }] }
  ]) {
    await assert.rejects(a.mutate('architecture_design_save', { proposal: bad }));
  }
  await a.g.run({ action: 'progress', current: 'Changed intent', next: [], blocked: [] });
  await a.mutate('architecture_design_save', { proposal: proposal() });
  const state = JSON.parse(await fs.readFile(path.join(a.root, 'STATE.json'), 'utf8'));
  state.task = 'different';
  await fs.writeFile(path.join(a.root, 'STATE.json'), JSON.stringify(state));
  await assert.rejects(a.confirm(), /task/i);
  assert.equal((await b.snapshot()).draft, null);
});
test('corrupt design records stay on disk without replacing their content', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, '.governance'), { recursive: true });
  for (const bad of ['null', '{"version":1,"history":[null],"draft":null}', '{bad']) {
    await fs.writeFile(path.join(f.root, file), bad);
    const s = await f.snapshot();
    assert.ok(s.error);
    assert.equal(s.baseline, null);
    await assert.rejects(f.mutate('architecture_design_begin', { reason: 'Overwrite' }));
    assert.equal(await fs.readFile(path.join(f.root, file), 'utf8'), bad);
  }
});
test('design history capacity rejects rather than silently pruning confirmed versions', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 20; i++) {
    await f.mutate('architecture_design_begin', { reason: 'Explicit revision ' + i });
    await f.mutate('architecture_design_save', { proposal: proposal('Version ' + i) });
    await f.confirm();
  }
  const before = await fs.readFile(path.join(f.root, file), 'utf8');
  await assert.rejects(
    f.mutate('architecture_design_begin', { reason: 'Would lose history' }),
    /history full/i
  );
  assert.equal(await fs.readFile(path.join(f.root, file), 'utf8'), before);
  assert.equal((await f.snapshot()).history.length, 20);
});
test('declared Skill is bounded, licensed and available only with explicitly approved prompt permission', async () => {
  const manifest = JSON.parse(await fs.readFile(path.resolve('plugin/manifest.json'), 'utf8'));
  assert.ok(manifest.permissions.includes('agent.prompt.inject'));
  const entry = manifest.contributes.skills.find((s) => s.id === 'architecture-copilot');
  const text = await fs.readFile(path.resolve('plugin', entry.path), 'utf8');
  assert.ok(Buffer.byteLength(text) < 10000);
  assert.match(text, /不自动确认/);
  assert.match(text, /462c8c52a6307de0ad34c8a24f94486cc5bd4655/);
  assert.match(
    await fs.readFile(path.resolve('plugin/skills/architecture-copilot/LICENSE'), 'utf8'),
    /MIT License/
  );
});
test('late proposals cannot write into a replacement draft even with a fresh revision', async (t) => {
  const f = await fixture(t);
  await f.mutate('architecture_design_begin', { reason: 'Original session' });
  const oldId = (await f.snapshot()).draft.draftId;
  await panelInvoke(f.root, 'governance.design', {
    action: 'discard',
    revision: (await f.snapshot()).revision,
    confirmed: true
  });
  await f.mutate('architecture_design_begin', { reason: 'Replacement session' });
  await assert.rejects(
    f.mutate('architecture_design_save', { expectedDraft: oldId, proposal: proposal('Late') }),
    /draft replaced/i
  );
  assert.equal((await f.snapshot()).draft.proposal, null);
});
