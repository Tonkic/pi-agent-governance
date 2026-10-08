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
      { action: 'start', kind: 'analysis', revision: old, confirmed: true },
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
        kind: 'analysis',
        revision: (await b.g.run({ action: 'project_snapshot' })).revision,
        confirmed: true
      },
      b.desktop,
      async () => false
    ),
    /changed before prompt/
  );
  assert.equal(
    b.calls.some((c) => c.operation === 'agent/prompt'),
    false
  );
});

test('Agent acceptance launches only for active-task done items and pins reviewed content', async (t) => {
  const f = await fixture(t);
  const mutate = async (a) =>
    f.g.run({ ...a, expectedRevision: (await f.g.run({ action: 'project_snapshot' })).revision });
  await mutate({
    action: 'board_create',
    id: 'one',
    title: 'Review me',
    criteria: ['Actual check']
  });
  await assert.rejects(f.start('acceptance', { itemId: 'one' }), /completed/);
  assert.equal(f.calls.length, 0);
  await mutate({ action: 'board_move', id: 'one', stage: 'doing', position: 0 });
  await mutate({ action: 'board_move', id: 'one', stage: 'done', position: 0 });
  const item = (await f.g.run({ action: 'project_snapshot' })).board.items[0];
  const run = await f.start('acceptance', { itemId: 'one' });
  assert.equal(run.itemFingerprint, item.itemFingerprint);
  assert.match(f.calls[1].args[0].content, /board_accept/);
  assert.match(f.calls[1].args[0].content, /Do not fix source code/);
  assert.equal((await f.g.run({ action: 'project_snapshot' })).board.items[0].stage, 'done');
  await assert.rejects(
    operationInvoke(f.root, { action: 'start', kind: 'unknown', confirmed: true }, f.desktop),
    /Unknown/
  );
  await assert.rejects(operationInvoke(f.root, { action: 'list' }, {}), /unavailable/);
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
