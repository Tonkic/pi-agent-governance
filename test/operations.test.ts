'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Governance } = require('../plugin/core');
const { operationInvoke } = require('../plugin/operations');
async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'operations-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const g = new Governance(root);
  await g.run({ action: 'init' });
  await g.run({
    action: 'start',
    id: 'approved',
    goal: 'Review only',
    criteria: ['No unauthorized work']
  });
  const calls = [];
  let failPrompt = false;
  let onCreate = async () => {};
  let streaming = true;
  const desktop: any = {
    listOperations: async () =>
      [
        'session/create',
        'agent/prompt',
        'agent/getStatus',
        'session/get',
        'session/open',
        'agent/abort'
      ].map((id) => ({ id })),
    invoke: async (request) => {
      calls.push(request);
      switch (request.operation) {
        case 'session/create':
          await onCreate();
          return { id: 'owned-session' };
        case 'agent/prompt':
          if (failPrompt) throw Error('ambiguous timeout');
          return { accepted: true };
        case 'agent/getStatus':
          return { isStreaming: streaming };
        case 'session/get':
          return {
            session: { id: 'owned-session' },
            messages: [{ role: 'assistant', content: 'Review output' }]
          };
        default:
          return { ok: true };
      }
    }
  };
  const start = async (kind = 'analysis', extra = {}) =>
    operationInvoke(
      root,
      {
        action: 'start',
        sessionMode: 'new',
        kind,
        revision: (await g.run({ action: 'project_snapshot' })).revision,
        confirmed: true,
        ...extra
      },
      desktop
    );
  return {
    root,
    g,
    calls,
    desktop,
    start,
    set failPrompt(v) {
      failPrompt = v;
    },
    set onCreate(fn) {
      onCreate = fn;
    },
    set streaming(v) {
      streaming = v;
    }
  };
}

test('confirmed project actions create bound sessions, read progress and never auto-accept work', async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.root, 'STATE.json'), 'utf8');
  await assert.rejects(
    operationInvoke(f.root, { action: 'start', kind: 'analysis' }, f.desktop),
    /Confirm/
  );
  assert.equal(f.calls.length, 0);
  const run = await f.start();
  assert.equal(run.phase, 'running');
  assert.equal(run.sessionId, 'owned-session');
  assert.equal(f.calls[0].args[0].projectPath, f.root);
  assert.equal(f.calls[0].args[0].mode, 'agent');
  assert.match(f.calls[1].args[0].content, /do not edit project files/);
  await assert.rejects(f.start(), /existing/);
  const state = await operationInvoke(f.root, { action: 'status', id: run.id }, f.desktop);
  assert.equal(state.run.phase, 'running');
  f.streaming = false;
  const ended = await operationInvoke(f.root, { action: 'status', id: run.id }, f.desktop);
  assert.equal(ended.run.phase, 'completed');
  assert.equal(await fs.readFile(path.join(f.root, 'STATE.json'), 'utf8'), before);
  await assert.rejects(
    operationInvoke(f.root, { action: 'open', id: 'foreign-session' }, f.desktop),
    /owned/
  );
  await operationInvoke(f.root, { action: 'open', id: run.id }, f.desktop);
  assert.equal(f.calls.at(-1).operation, 'session/open');
});

test('ambiguous submission persists and cannot retry; cancellation only targets owned session', async (t) => {
  const f = await fixture(t);
  f.failPrompt = true;
  await assert.rejects(f.start(), /ambiguous/);
  const list = await operationInvoke(f.root, { action: 'list' }, f.desktop);
  const run = list.runs[0];
  assert.equal(run.phase, 'unknown');
  await assert.rejects(f.start(), /existing/);
  assert.equal(f.calls.filter((c) => c.operation === 'agent/prompt').length, 1);
  f.streaming = false;
  assert.equal(
    (await operationInvoke(f.root, { action: 'status', id: run.id }, f.desktop)).run.phase,
    'unknown'
  );
  await assert.rejects(
    operationInvoke(f.root, { action: 'cancel', id: run.id }, f.desktop),
    /Confirm/
  );
  await operationInvoke(f.root, { action: 'cancel', id: run.id, confirmed: true }, f.desktop);
  assert.deepEqual(f.calls.at(-1), {
    operation: 'agent/abort',
    args: [{ sessionId: 'owned-session' }]
  });
});

test('stale workspace and human intent changes before prompting preserve sessions without sending', async (t) => {
  const f = await fixture(t);
  const old = (await f.g.run({ action: 'project_snapshot' })).revision;
  await f.g.run({ action: 'progress', current: 'Updated', next: [], blocked: [] });
  await assert.rejects(
    operationInvoke(
      f.root,
      { action: 'start', sessionMode: 'new', kind: 'analysis', revision: old, confirmed: true },
      f.desktop
    ),
    /stale/
  );
  assert.equal(f.calls.length, 0);
  f.onCreate = () =>
    f.g.run({ action: 'progress', current: 'Changed during host create', next: [], blocked: [] });
  await assert.rejects(f.start(), /changed before prompt/);
  assert.equal(
    f.calls.some((c) => c.operation === 'agent/prompt'),
    false
  );
  const run = (await operationInvoke(f.root, { action: 'list' }, f.desktop)).runs[0];
  assert.equal(run.phase, 'failed');
  assert.equal(run.sessionId, 'owned-session');
  const b = await fixture(t);
  await assert.rejects(
    operationInvoke(
      b.root,
      {
        action: 'start',
        sessionMode: 'new',
        kind: 'analysis',
        revision: (await b.g.run({ action: 'project_snapshot' })).revision,
        confirmed: true
      },
      b.desktop,
      async () => false
    ),
    /stale|switched/
  );
  assert.equal(b.calls.length, 0, 'Switched workspace is rejected before creating a session');
  assert.equal(
    b.calls.some((c) => c.operation === 'agent/prompt'),
    false
  );
});

test('new acceptance sessions are removed, but old owned sessions remain readable and cancelable', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.start('acceptance'), /Unknown project operation/);
  assert.equal(f.calls.length, 0);
  const run = await f.start('analysis');
  const file = path.join(f.root, '.governance/operations.json');
  const history = JSON.parse(await fs.readFile(file, 'utf8'));
  history.runs[0].kind = 'acceptance';
  history.runs[0].itemId = 'old';
  await fs.writeFile(file, JSON.stringify(history));
  const raw = await fs.readFile(file, 'utf8');
  const list = await operationInvoke(f.root, { action: 'list' }, f.desktop);
  assert.equal(list.runs[0].kind, 'acceptance');
  assert.equal(await fs.readFile(file, 'utf8'), raw);
  await operationInvoke(f.root, { action: 'open', id: run.id }, f.desktop);
  await operationInvoke(f.root, { action: 'status', id: run.id }, f.desktop);
  const canceled = await operationInvoke(
    f.root,
    { action: 'cancel', id: run.id, confirmed: true },
    f.desktop
  );
  assert.equal(canceled.phase, 'canceled');
  assert.equal(canceled.kind, 'acceptance');
  assert.equal(
    f.calls.filter((c) => c.operation === 'agent/prompt').length,
    1,
    'No old acceptance prompt replayed'
  );
  assert.equal(f.calls.filter((c) => c.operation === 'agent/abort').length, 1);
});

test('sessionless creation failures can be explicitly resolved without replay', async (t) => {
  for (const mode of ['denied', 'denied-response', 'missing-id', 'interrupted']) {
    const f = await fixture(t);
    const invoke = f.desktop.invoke;
    f.desktop.invoke = async (request) => {
      if (request.operation === 'session/create') {
        if (mode === 'denied')
          throw Object.assign(Error('Creation denied'), { code: 'PERMISSION_DENIED' });
        if (mode === 'missing-id') return {};
        if (mode === 'denied-response')
          return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Creation denied' } };
        throw Error('Interrupted creation');
      }
      return invoke(request);
    };
    await assert.rejects(f.start());
    const run = (await operationInvoke(f.root, { action: 'list' }, f.desktop)).runs[0];
    if (mode.startsWith('denied')) assert.equal(run.phase, 'failed');
    else {
      if (mode === 'interrupted') {
        const file = path.join(f.root, '.governance/operations.json');
        const data = JSON.parse(await fs.readFile(file, 'utf8'));
        data.runs[0].phase = 'creating';
        await fs.writeFile(file, JSON.stringify(data));
      }
      await assert.rejects(
        operationInvoke(f.root, { action: 'resolve', id: run.id }, f.desktop),
        /Confirm/
      );
      await operationInvoke(f.root, { action: 'resolve', id: run.id, confirmed: true }, f.desktop);
    }
    assert.equal(
      f.calls.some((c) => c.operation === 'agent/prompt'),
      false
    );
    f.desktop.invoke = invoke;
    await f.start();
    assert.equal(f.calls.filter((c) => c.operation === 'agent/prompt').length, 1);
  }
});

test('a delayed idle status cannot overwrite an explicit cancellation', async (t) => {
  const f = await fixture(t);
  const run = await f.start();
  f.streaming = false;
  const invoke = f.desktop.invoke;
  let release, reached;
  const pending = new Promise((resolve) => {
    reached = resolve;
  });
  f.desktop.invoke = async (request) => {
    if (request.operation === 'session/get') {
      reached();
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    return invoke(request);
  };
  const reading = operationInvoke(f.root, { action: 'status', id: run.id }, f.desktop);
  await pending;
  await operationInvoke(f.root, { action: 'cancel', id: run.id, confirmed: true }, f.desktop);
  release();
  assert.equal((await reading).run.phase, 'canceled');
  assert.equal(
    (await operationInvoke(f.root, { action: 'list' }, f.desktop)).runs[0].phase,
    'canceled'
  );
});

test('a rejected prompt response is not reported as a running task', async (t) => {
  const f = await fixture(t);
  const invoke = f.desktop.invoke;
  f.desktop.invoke = async (request) =>
    request.operation === 'agent/prompt'
      ? { accepted: false, error: 'Prompt refused' }
      : invoke(request);
  await assert.rejects(f.start(), /Prompt refused/);
  assert.equal(
    (await operationInvoke(f.root, { action: 'list' }, f.desktop)).runs[0].phase,
    'unknown'
  );
});

test('model metadata is projected without secrets; explicit selection validates before creating a session', async (t) => {
  const f = await fixture(t);
  const rows = [
    {
      key: 'configured/model/one',
      providerId: 'configured',
      providerName: 'Provider',
      modelId: 'model/one',
      label: 'Reasoning model',
      supportsReasoning: true,
      thinkingLevels: ['low', 'high', 'invented'],
      apiKey: 'fixture-secret'
    },
    {
      key: 'configured/plain',
      providerId: 'configured',
      modelId: 'plain',
      supportsReasoning: false,
      thinkingLevels: ['high']
    }
  ];
  const models = { list: async () => rows };
  const invoke = async (payload) =>
    operationInvoke(f.root, payload, f.desktop, async () => true, models);
  const options = await invoke({ action: 'models' });
  assert.equal(JSON.stringify(options).includes('fixture-secret'), false);
  assert.deepEqual(options.models[0].thinkingLevels, ['low', 'high']);
  assert.deepEqual(options.models[1].thinkingLevels, []);
  const revision = (await f.g.run({ action: 'project_snapshot' })).revision;
  const start = { action: 'start', sessionMode: 'new', kind: 'architecture', confirmed: true, revision };
  for (const selection of [
    { modelKey: 'missing', thinkingLevel: 'high' },
    { modelKey: 'configured/plain', thinkingLevel: 'high' },
    { modelKey: 'configured/model/one', thinkingLevel: 'invented' },
    { thinkingLevel: 'high' }
  ])
    await assert.rejects(invoke({ ...start, ...selection }), /model|thinking/);
  assert.equal(f.calls.length, 0);
  assert.equal((await operationInvoke(f.root, { action: 'list' }, f.desktop)).runs.length, 0);
  const run = await invoke({ ...start, modelKey: 'configured/model/one', thinkingLevel: 'high' });
  assert.deepEqual(f.calls[0].args[0], {
    title: 'Governance · architecture',
    projectPath: f.root,
    mode: 'agent',
    providerId: 'configured',
    modelId: 'model/one',
    thinkingLevel: 'high'
  });
  assert.equal(run.modelKey, 'configured/model/one');
  assert.equal(run.thinkingLevel, 'high');
  await assert.rejects(operationInvoke(f.root, { action: 'models' }, f.desktop), /unavailable/);
});

test('model lookup reserves submission before awaiting; a duplicate cannot release its reservation', async (t) => {
  const f = await fixture(t);
  let releaseModels, releaseCreate, enteredCreate;
  const modelGate = new Promise((resolve) => {
    releaseModels = resolve;
  });
  const createEntered = new Promise((resolve) => {
    enteredCreate = resolve;
  });
  const models = {
    list: async () => {
      await modelGate;
      return [
        {
          key: 'fixture/model',
          providerId: 'fixture',
          modelId: 'model',
          supportsReasoning: true,
          thinkingLevels: ['high']
        }
      ];
    }
  };
  const hostInvoke = f.desktop.invoke;
  f.desktop.invoke = async (request) => {
    if (request.operation === 'session/create') {
      enteredCreate();
      await new Promise((resolve) => {
        releaseCreate = resolve;
      });
    }
    return hostInvoke(request);
  };
  const args = {
    action: 'start',
    sessionMode: 'new',
    kind: 'analysis',
    confirmed: true,
    modelKey: 'fixture/model',
    thinkingLevel: 'high',
    revision: (await f.g.run({ action: 'project_snapshot' })).revision
  };
  const first = operationInvoke(f.root, args, f.desktop, async () => true, models);
  const second = operationInvoke(f.root, args, f.desktop, async () => true, models).then(
    () => null,
    (e) => e
  );
  releaseModels();
  await createEntered;
  try {
    const rejected = await second;
    assert.match(rejected?.message || '', /already being submitted/);
    const run = (await operationInvoke(f.root, { action: 'list' }, f.desktop)).runs[0];
    await assert.rejects(
      operationInvoke(f.root, { action: 'resolve', id: run.id, confirmed: true }, f.desktop),
      /Wait/
    );
  } finally {
    releaseCreate();
    await first;
  }
  assert.equal(f.calls.filter((c) => c.operation === 'session/create').length, 1);
  assert.equal(f.calls.filter((c) => c.operation === 'agent/prompt').length, 1);
});

test('documentation maintenance is project-bound, confirmed and limited to documentation', async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.root, 'STATE.json'), 'utf8');
  const revision = (await f.g.run({ action: 'project_snapshot' })).revision;
  await assert.rejects(
    operationInvoke(f.root, { action: 'start', kind: 'documentation', revision }, f.desktop),
    /Confirm/
  );
  assert.equal(f.calls.length, 0);
  const run = await f.start('documentation');
  assert.equal(run.kind, 'documentation');
  assert.equal(f.calls[0].args[0].projectPath, f.root);
  const prompt = f.calls.find((c) => c.operation === 'agent/prompt').args[0].content;
  for (const boundary of [
    'currently open project',
    'Write only docs/, notes/',
    'Do not edit functional source',
    'Do not upgrade or install plugins',
    'Microsoft Writing Style Guide',
    'progressive disclosure',
    '4–8 lines',
    'preserve historical evidence unchanged',
    'no Git mutations'
  ])
    assert.ok(prompt.includes(boundary), boundary);
  assert.ok(prompt.includes(JSON.stringify(f.root)));
  assert.equal(await fs.readFile(path.join(f.root, 'STATE.json'), 'utf8'), before);
  assert.equal(
    (await operationInvoke(f.root, { action: 'list' }, f.desktop)).runs[0].kind,
    'documentation'
  );
  await assert.rejects(f.start('analysis'), /existing/);
  await operationInvoke(f.root, { action: 'cancel', id: run.id, confirmed: true }, f.desktop);
  assert.equal(f.calls.at(-1).operation, 'agent/abort');
  assert.equal(
    (await operationInvoke(f.root, { action: 'list' }, f.desktop)).runs[0].phase,
    'canceled'
  );
});

test('documentation maintenance refuses stale projects and does not replay ambiguous submissions', async (t) => {
  const f = await fixture(t);
  f.onCreate = () => f.g.run({ action: 'progress', current: 'New intent', next: [], blocked: [] });
  await assert.rejects(f.start('documentation'), /changed before prompt/);
  assert.equal(
    f.calls.some((c) => c.operation === 'agent/prompt'),
    false
  );
  const b = await fixture(t);
  b.failPrompt = true;
  await assert.rejects(b.start('documentation'), /ambiguous/);
  await assert.rejects(b.start('documentation'), /existing/);
  assert.equal(b.calls.filter((c) => c.operation === 'agent/prompt').length, 1);
});

test('persisted operation history rejects non-record roots and runs before host side effects', async (t) => {
  const f = await fixture(t);
  const file = path.join(f.root, '.governance/operations.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (const entry of [null, false, 42, 'bad', []]) {
    for (const [value, message] of [
      [entry, 'Invalid project operation history'],
      [{ version: 1, runs: [entry] }, 'Invalid project operation record']
    ]) {
      const raw = JSON.stringify(value);
      await fs.writeFile(file, raw);
      for (const invoke of [
        () => operationInvoke(f.root, { action: 'list' }, f.desktop),
        () => f.start()
      ]) {
        await assert.rejects(invoke(), (error) => {
          assert.equal(error instanceof TypeError, false);
          assert.equal(error.message, message);
          return true;
        });
      }
      assert.equal(f.calls.length, 0);
      assert.equal(await fs.readFile(file, 'utf8'), raw);
    }
  }
  await fs.writeFile(file, JSON.stringify({ version: 1, runs: [] }));
  assert.equal((await f.start()).phase, 'running');
});
test('design sessions require an explicit current draft and never confirm it', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.start('design'), /draft/);
  await f.g.run({
    action: 'architecture_design_begin',
    reason: 'First design',
    expectedRevision: (await f.g.run({ action: 'architecture_design_snapshot' })).revision
  });
  const d = await f.g.run({ action: 'architecture_design_snapshot' });
  await assert.rejects(f.start('design', { designRevision: '0'.repeat(64) }), /Design changed/);
  await f.start('design', { designRevision: d.revision });
  const prompt = f.calls.find((c) => c.operation === 'agent/prompt').args[0].content;
  assert.match(prompt, /io.github.tonkic.agent-governance\/architecture-copilot/);
  assert.match(prompt, /design proposal mode/);
  assert.match(prompt, /If the Skill cannot be loaded, stop and report/);
  assert.doesNotMatch(prompt, /current-state analysis mode/);
  assert.match(prompt, /Never confirm a baseline/);
  assert.match(prompt, /Only the current draft may change/);
  assert.equal((await f.g.run({ action: 'architecture_design_snapshot' })).baseline, null);
});
test('design changed during session creation prevents the stale prompt without replay', async (t) => {
  const f = await fixture(t);
  await f.g.run({
    action: 'architecture_design_begin',
    reason: 'First design',
    expectedRevision: (await f.g.run({ action: 'architecture_design_snapshot' })).revision
  });
  const d = await f.g.run({ action: 'architecture_design_snapshot' });
  f.onCreate = async () => {
    const { panelInvoke } = require('../plugin/panel');
    await panelInvoke(f.root, 'governance.design', {
      action: 'discard',
      revision: d.revision,
      confirmed: true
    });
  };
  await assert.rejects(f.start('design', { designRevision: d.revision }), /Project changed/);
  assert.equal(f.calls.filter((c) => c.operation === 'agent/prompt').length, 0);
});
test('starting another operation reconciles a finished known session without manual status or prompt replay', async (t) => {
  const f = await fixture(t);
  const old = await f.start();
  f.streaming = false;
  const next = await f.start('architecture');
  assert.notEqual(next.id, old.id);
  const history = JSON.parse(
    await fs.readFile(path.join(f.root, '.governance/operations.json'), 'utf8')
  );
  assert.equal(history.runs.find((r) => r.id === old.id).phase, 'completed');
  assert.equal(history.runs.find((r) => r.id === next.id).phase, 'running');
  assert.equal(f.calls.filter((c) => c.operation === 'agent/prompt').length, 2);
  assert.equal(f.calls.filter((c) => c.operation === 'agent/abort').length, 0);
});
test('progress list reconciles finished sessions but never unknown submissions', async (t) => {
  const f = await fixture(t);
  const old = await f.start();
  f.streaming = false;
  const list = await operationInvoke(f.root, { action: 'list' }, f.desktop);
  assert.equal(list.runs.find((r) => r.id === old.id).phase, 'completed');
  const u = await fixture(t);
  u.failPrompt = true;
  await assert.rejects(u.start(), /ambiguous/);
  u.streaming = false;
  assert.equal(
    (await operationInvoke(u.root, { action: 'list' }, u.desktop)).runs[0].phase,
    'unknown'
  );
  await assert.rejects(u.start(), /existing/);
});
test('failed or malformed host probes preserve running history and never create another session', async (t) => {
  for (const response of [
    'throw',
    {},
    { isStreaming: 'false' },
    { isStreaming: false, isRunning: true }
  ]) {
    const f = await fixture(t);
    await f.start();
    const file = path.join(f.root, '.governance/operations.json'),
      raw = await fs.readFile(file, 'utf8');
    const invoke = f.desktop.invoke;
    f.desktop.invoke = async (request) => {
      if (request.operation === 'agent/getStatus') {
        if (response === 'throw') throw Error('Probe unavailable');
        return response;
      }
      return invoke(request);
    };
    await assert.rejects(f.start());
    assert.equal(await fs.readFile(file, 'utf8'), raw);
    assert.equal(f.calls.filter((c) => c.operation === 'session/create').length, 1);
  }
  const f = await fixture(t);
  await f.start();
  f.streaming = false;
  const file = path.join(f.root, '.governance/operations.json'),
    raw = await fs.readFile(file, 'utf8');
  const invoke = f.desktop.invoke;
  f.desktop.invoke = async (request) =>
    request.operation === 'session/get' ? { session: null } : invoke(request);
  await assert.rejects(f.start());
  assert.equal(await fs.readFile(file, 'utf8'), raw);
});
test('reconciliation never overwrites a concurrent cancellation or changed project intent', async (t) => {
  for (const change of ['cancel', 'intent', 'workspace']) {
    const f = await fixture(t);
    const run = await f.start();
    f.streaming = false;
    const invoke = f.desktop.invoke;
    let changed = false,
      current = true;
    f.desktop.invoke = async (request) => {
      if (request.operation === 'agent/getStatus' && !changed) {
        changed = true;
        if (change === 'cancel')
          await operationInvoke(
            f.root,
            { action: 'cancel', id: run.id, confirmed: true },
            f.desktop
          );
        if (change === 'intent')
          await f.g.run({
            action: 'progress',
            current: 'Human changed intent',
            next: [],
            blocked: []
          });
        if (change === 'workspace') current = false;
      }
      return invoke(request);
    };
    if (change === 'cancel') {
      const list = await operationInvoke(f.root, { action: 'list' }, f.desktop);
      assert.equal(list.runs[0].phase, 'canceled');
    } else {
      await assert.rejects(
        operationInvoke(f.root, { action: 'list' }, f.desktop, async () => current),
        /changed|switched/i
      );
      const history = JSON.parse(
        await fs.readFile(path.join(f.root, '.governance/operations.json'), 'utf8')
      );
      assert.equal(history.runs[0].phase, 'running');
    }
  }
});
test('status timeout retains the old run and sends no new prompt', async (t) => {
  const f = await fixture(t);
  await f.start();
  const file = path.join(f.root, '.governance/operations.json'),
    before = await fs.readFile(file, 'utf8');
  let reached;
  const querying = new Promise((resolve) => {
    reached = resolve;
  });
  const invoke = f.desktop.invoke;
  f.desktop.invoke = async (request) => {
    if (request.operation === 'agent/getStatus') {
      reached();
      return new Promise(() => {});
    }
    return invoke(request);
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = f.start();
  await querying;
  t.mock.timers.tick(10000);
  await assert.rejects(pending, /timed out/);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.equal(f.calls.filter((c) => c.operation === 'agent/prompt').length, 1);
});
test('official desktop status envelope supports idle reconciliation and manual status inspection', async (t) => {
  for (const action of ['list', 'status', 'start']) {
    const f = await fixture(t);
    const old = await f.start();
    const invoke = f.desktop.invoke;
    f.desktop.invoke = async (request) =>
      request.operation === 'agent/getStatus'
        ? {
            status: {
              sessionId: old.sessionId,
              isRunning: false,
              pendingToolConfirmations: 0,
              currentTurnId: 'last-finished-turn'
            }
          }
        : invoke(request);
    if (action === 'start') await f.start('architecture');
    else await operationInvoke(f.root, { action, id: old.id }, f.desktop);
    const data = JSON.parse(
      await fs.readFile(path.join(f.root, '.governance/operations.json'), 'utf8')
    );
    assert.equal(data.runs.find((r) => r.id === old.id).phase, 'completed');
    assert.equal(
      f.calls.filter((c) => c.operation === 'agent/prompt').length,
      action === 'start' ? 2 : 1
    );
  }
});
test('official status envelope keeps running and waiting permissions busy and rejects malformed identity/status', async (t) => {
  for (const status of [
    { sessionId: 'owned-session', isRunning: true, pendingToolConfirmations: 0 },
    { sessionId: 'owned-session', isRunning: false, pendingToolConfirmations: 1 },
    { sessionId: 'owned-session', isRunning: true, currentTurnId: 'active-turn' },
    { sessionId: 'foreign-session', isRunning: false },
    { sessionId: 'owned-session', isRunning: 'false' },
    { sessionId: 'owned-session', isRunning: false, pendingToolConfirmations: -1 },
    { sessionId: 'owned-session', isRunning: false, pendingToolConfirmations: '0' },
    { sessionId: 'owned-session' }
  ]) {
    const f = await fixture(t);
    await f.start();
    const invoke = f.desktop.invoke;
    f.desktop.invoke = async (request) =>
      request.operation === 'agent/getStatus' ? { status } : invoke(request);
    const file = path.join(f.root, '.governance/operations.json'),
      raw = await fs.readFile(file, 'utf8');
    await assert.rejects(f.start());
    assert.equal(await fs.readFile(file, 'utf8'), raw);
    assert.equal(f.calls.filter((c) => c.operation === 'agent/prompt').length, 1);
  }
});

test('architecture analysis defaults to the Skill in current-state mode without opening a design draft', async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.root, 'STATE.json'), 'utf8');
  const run = await f.start('architecture');
  assert.equal(run.kind, 'architecture');
  const prompts = f.calls.filter(c => c.operation === 'agent/prompt');
  assert.equal(prompts.length, 1);
  const prompt = prompts[0].args[0].content;
  assert.match(prompt, /Load Skill io\.github\.tonkic\.agent-governance\/architecture-copilot/);
  assert.match(prompt, /current-state analysis mode/);
  assert.match(prompt, /If the Skill cannot be loaded, stop and report/);
  assert.match(prompt, /architecture_sources/);
  assert.match(prompt, /architecture_set/);
  assert.match(prompt, /Do not create or change design drafts or baselines/);
  assert.doesNotMatch(prompt, /Reanalyze the core project architecture|architecture_design_save/);
  assert.equal(await fs.readFile(path.join(f.root, 'STATE.json'), 'utf8'), before);
  assert.equal((await f.g.run({ action: 'architecture_design_snapshot' })).draft, null);
});

test('architecture Skill documents separate current-state and design write boundaries', async () => {
  const skill = await fs.readFile(path.join(__dirname, '../../plugin/skills/architecture-copilot/SKILL.md'), 'utf8');
  assert.match(skill, /## 源码现状分析模式/);
  assert.match(skill, /architecture_sources/);
  assert.match(skill, /architecture_set/);
  assert.match(skill, /不创建或修改设计草案、基线/);
  assert.match(skill, /## 方案设计模式/);
  assert.match(skill, /不改 `.governance\/architecture.json`/);
  assert.doesNotMatch(skill, /不要改功能代码、STATE、看板、AGENTS.md、源码现状图/);
});

test('explicitly removed old operation records stay absent on reads and do not block a new Skill session', async (t) => {
  const f = await fixture(t);
  const file = path.join(f.root, '.governance/operations.json');
  await f.start('architecture');
  await fs.unlink(file); // User-authorized record cleanup, not runtime auto-pruning.
  const listed = await operationInvoke(f.root, { action: 'list' }, f.desktop);
  assert.deepEqual(listed.runs, []);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  assert.equal(f.calls.filter(c => c.operation === 'agent/abort').length, 0);
  assert.equal(f.calls.filter(c => c.operation === 'agent/prompt').length, 1);
  const next = await f.start('architecture');
  assert.equal(next.phase, 'running');
  assert.equal(f.calls.filter(c => c.operation === 'agent/prompt').length, 2);
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(saved.runs.map(run => run.id), [next.id]);
});

test('reuse lists only local project sessions and sends into the same conversation without model changes', async (t) => {
  const f = await fixture(t);
  const prior = f.desktop.invoke;
  f.desktop.listOperations = async () => ['session/list', 'session/get', 'agent/getStatus', 'agent/prompt', 'session/open', 'agent/abort'].map(id => ({ id }));
  f.desktop.invoke = async (request) => {
    f.calls.push(request);
    const session = { id: 'existing', title: 'Existing context', projectPath: f.root, mode: 'agent', providerId: 'ready', modelId: 'same', thinkingLevel: 'high' };
    if (request.operation === 'session/list') return { sessions: [session, { ...session, id: 'other', projectPath: path.dirname(f.root) }, { ...session, id: 'scheduled', scheduledRun: true }, { ...session, id: 'remote', remoteWorkspace: { hostKey: 'remote' } }] };
    if (request.operation === 'session/get') return { session: { ...session, messages: [{ content: 'Do not copy this transcript' }] } };
    if (request.operation === 'agent/getStatus') return { status: { isRunning: false, sessionId: 'existing' } };
    if (request.operation === 'agent/prompt') return { accepted: true };
    return prior(request);
  };
  const list = await operationInvoke(f.root, { action: 'sessions' }, f.desktop);
  assert.deepEqual(list.sessions, [{ id: 'existing', title: 'Existing context', modelKey: 'ready/same', thinkingLevel: 'high' }]);
  assert.doesNotMatch(JSON.stringify(list), /Do not copy|scheduled|remote/);
  const run = await f.start('analysis', { sessionMode: 'existing', sessionId: 'existing' });
  assert.equal(run.sessionId, 'existing'); assert.equal(run.sessionMode, 'existing'); assert.equal(run.phase, 'running');
  assert.equal(f.calls.filter(c => c.operation === 'session/create' || c.operation === 'session/configure').length, 0);
  const prompt = f.calls.find(c => c.operation === 'agent/prompt');
  assert.equal(prompt.args[0].sessionId, 'existing'); assert.doesNotMatch(prompt.args[0].content, /Do not copy/);
  const gets = f.calls.filter(c => c.operation === 'session/get'); assert.ok(gets.length >= 2);
  assert.ok(gets.every(c => c.args[0].messageLimit === 1 && c.args[0].contentLimit === 1));
  await assert.rejects(operationInvoke(f.root, { action: 'cancel', id: run.id, confirmed: true }, f.desktop), /shared|host/i);
  assert.equal(f.calls.filter(c => c.operation === 'agent/abort').length, 0);
});

test('reuse fails closed for missing identity, foreign/busy/unsupported sessions and never silently creates', async (t) => {
  for (const mode of ['missing', 'foreign', 'busy', 'plan', 'remote', 'moved', 'model']) {
    const f = await fixture(t); let reads = 0;
    f.desktop.invoke = async request => {
      f.calls.push(request);
      if (request.operation === 'session/get') return { session: { id: 'existing', title: 'Existing', projectPath: mode === 'foreign' || (mode === 'moved' && ++reads > 1) ? path.dirname(f.root) : f.root, mode: mode === 'plan' ? 'plan' : 'agent', ...(mode === 'remote' ? { remoteWorkspace: {} } : {}) } };
      if (request.operation === 'agent/getStatus') return { status: { isRunning: mode === 'busy' } };
      throw Error('No mutations expected');
    };
    await assert.rejects(f.start('analysis', { sessionMode: 'existing', ...(mode !== 'missing' ? { sessionId: 'existing' } : {}), ...(mode === 'model' ? { modelKey: 'override/model' } : {}) }));
    assert.equal(f.calls.filter(c => ['session/create', 'agent/prompt', 'session/configure'].includes(c.operation)).length, 0, mode);
  }
  const f = await fixture(t);
  await assert.rejects(f.start('analysis', { sessionMode: undefined }), /session/i);
  assert.equal(f.calls.length, 0);
});

test('shared unknown submission releases only after inspection without abort/replay; moved sessions cannot reconcile', async t => {
  const f = await fixture(t);
  let moved = false;
  const original = f.desktop.invoke;
  f.desktop.invoke = async request => request.operation === 'session/get'
    ? { session: { id: 'shared', mode: 'agent', projectPath: moved ? path.dirname(f.root) : f.root } }
    : original(request);
  f.streaming = false;
  f.failPrompt = true;
  await assert.rejects(f.start('analysis', { sessionMode: 'existing', sessionId: 'shared' }), /ambiguous timeout/);
  let run = (await operationInvoke(f.root, { action: 'list' }, f.desktop)).runs[0];
  assert.equal(run.phase, 'unknown');
  await assert.rejects(operationInvoke(f.root, { action: 'resolve', id: run.id }, f.desktop), /Confirm/);
  const before = f.calls.length;
  await operationInvoke(f.root, { action: 'resolve', id: run.id, confirmed: true }, f.desktop);
  assert.equal(f.calls.length, before);
  assert.equal((await operationInvoke(f.root, { action: 'list' }, f.desktop)).runs[0].phase, 'failed');
  f.failPrompt = false;
  run = await f.start('analysis', { sessionMode: 'existing', sessionId: 'shared' });
  moved = true;
  await assert.rejects(operationInvoke(f.root, { action: 'list' }, f.desktop), /Cannot verify previous operation/);
  const stored = JSON.parse(await fs.readFile(path.join(f.root, '.governance/operations.json'), 'utf8'));
  assert.equal(stored.runs.find(r => r.id === run.id).phase, 'running');
  assert.equal(f.calls.filter(c => c.operation === 'agent/abort' || c.operation === 'session/create').length, 0);
});
