'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { Governance } = require('../plugin/runtime/core');
const {
  behaviorContract,
  behaviorSnapshot,
  behaviorState,
  evidenceFile,
  textHash
} = require('../plugin/runtime/behaviors');
const { makeEvidence, runVerification } = require('../scripts/check-behaviors.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'behaviors-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const g = new Governance(root);
  await g.run({ action: 'init' });
  await fs.mkdir(path.join(root, 'docs'));
  await fs.mkdir(path.join(root, 'src'));
  const prose =
    '# 用户说明\n\n### WS-001 — 切换项目\n\n面板显示新项目，旧请求不改变新项目。\n\n## 限制\n不是实际宿主验收。\n';
  const bindings = {
    version: 1,
    behaviors: [
      {
        id: 'WS-001',
        document: 'docs/workspace.md',
        cases: ['switch', 'late'],
        files: ['src/app.ts']
      }
    ]
  };
  await fs.writeFile(path.join(root, 'docs/workspace.md'), prose);
  await fs.writeFile(path.join(root, 'docs/behavior-bindings.json'), JSON.stringify(bindings));
  await fs.writeFile(path.join(root, 'src/app.ts'), 'export const app = 1;\n');
  const contract = await behaviorContract(g);
  const report = {
    version: 1,
    runId: 'run',
    completed: true,
    cases: [
      { id: 'switch', status: 'passed' },
      { id: 'late', status: 'passed' }
    ]
  };
  const evidence = makeEvidence(contract, report, 'run', true, root, 'a'.repeat(40), false);
  return { root, g, prose, bindings, contract, report, evidence };
}
test('human prose is read safely and current evidence never changes task or documents', async (t) => {
  const f = await fixture(t),
    state = await f.g.read('STATE.json');
  const unverified = await behaviorSnapshot(f.g);
  assert.equal(unverified.behaviors[0].status, 'unverified');
  assert.match(unverified.behaviors[0].prose, /面板显示新项目/);
  assert.doesNotMatch(unverified.behaviors[0].prose, /不是实际宿主/);
  await f.g.write(evidenceFile, JSON.stringify(f.evidence));
  const passed = await behaviorSnapshot(f.g);
  assert.equal(passed.behaviors[0].status, 'passed');
  assert.equal(passed.behaviors[0].environment, 'isolated-browser');
  assert.equal(await f.g.read('STATE.json'), state);
  assert.equal(await f.g.read('docs/workspace.md'), f.prose);
  await fs.appendFile(path.join(f.root, 'docs/workspace.md'), '\n改变了说明\n');
  assert.equal((await behaviorSnapshot(f.g)).behaviors[0].status, 'stale');
});
test('failed, missing, skipped, foreign and changed-source evidence cannot be green', async (t) => {
  const f = await fixture(t);
  const status = (evidence) => behaviorState(f.contract, evidence, f.root)[0].status;
  assert.equal(status({ ...f.evidence, suitePassed: false }), 'failed');
  assert.equal(status({ ...f.evidence, cases: f.evidence.cases.slice(0, 1) }), 'incomplete');
  assert.equal(
    status({ ...f.evidence, cases: [{ id: 'switch', status: 'skipped' }, f.evidence.cases[1]] }),
    'incomplete'
  );
  assert.equal(
    status({ ...f.evidence, cases: [{ id: 'switch', status: 'failed' }, f.evidence.cases[1]] }),
    'failed'
  );
  assert.equal(status({ ...f.evidence, workspace: f.root + '-other' }), 'stale');
  await f.g.write(evidenceFile, JSON.stringify(f.evidence));
  await fs.appendFile(path.join(f.root, 'src/app.ts'), '// implementation changed\n');
  assert.equal((await behaviorSnapshot(f.g)).behaviors[0].status, 'stale');
});
test('CRLF normalization keeps the same contract while substantive changes invalidate it', async (t) => {
  const f = await fixture(t);
  for (const file of ['docs/workspace.md', 'src/app.ts'])
    await f.g.write(file, (await f.g.read(file)).replace(/\n/g, '\r\n'));
  assert.equal((await behaviorContract(f.g)).fingerprint, f.contract.fingerprint);
  assert.equal(textHash('hello\r\n'), textHash('hello\n'));
});
test('malformed bindings, unsafe paths, unbound headings and corrupt evidence fail closed', async (t) => {
  const f = await fixture(t);
  f.bindings.behaviors[0].files = ['src/../../secret'];
  await f.g.write('docs/behavior-bindings.json', JSON.stringify(f.bindings));
  await assert.rejects(behaviorContract(f.g), /Unsafe path/);
  f.bindings.behaviors[0].files = ['src/app.ts'];
  await f.g.write('docs/behavior-bindings.json', JSON.stringify(f.bindings));
  await f.g.write('docs/workspace.md', f.prose + '\n### WS-999 — 未绑定\n声明\n');
  await assert.rejects(behaviorContract(f.g), /no test binding/);
  await f.g.write('docs/workspace.md', f.prose);
  await f.g.write(evidenceFile, '{bad');
  await assert.rejects(behaviorSnapshot(f.g), SyntaxError);
  assert.throws(
    () =>
      behaviorState(
        f.contract,
        { ...f.evidence, cases: [f.evidence.cases[0], f.evidence.cases[0]] },
        f.root
      ),
    /duplicate/
  );
});
test('absent project configuration is read-only and never a fake plugin behavior fallback', async (t) => {
  const f = await fixture(t);
  await fs.unlink(path.join(f.root, 'docs/behavior-bindings.json'));
  const before = await f.g.read('STATE.json');
  assert.deepEqual(await behaviorSnapshot(f.g), {
    workspace: f.root,
    behaviors: [],
    configured: false
  });
  assert.equal(await f.g.read('STATE.json'), before);
});
test('completion, run ownership and suite result are all required before generating pass evidence', async (t) => {
  const f = await fixture(t);
  for (const [report, exit] of [
    [{ ...f.report, completed: false }, true],
    [{ ...f.report, runId: 'old' }, true],
    [f.report, false],
    [null, true]
  ]) {
    const evidence = makeEvidence(f.contract, report, 'run', exit, f.root, 'a'.repeat(40), true);
    assert.equal(evidence.suitePassed, false);
    assert.equal(behaviorState(f.contract, evidence, f.root)[0].status, 'failed');
  }
});
test('verification replaces old pass on failure and refuses source changes during the run', async (t) => {
  const f = await fixture(t);
  for (const args of [
    ['init'],
    ['config', 'user.name', 'Fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
    ['add', '.'],
    ['commit', '-m', 'fixture']
  ])
    execFileSync('git', args, { cwd: f.root, stdio: 'ignore' });
  const run = async (_file, env) => {
    await fs.writeFile(
      env.PI_BEHAVIOR_REPORT,
      JSON.stringify({ ...f.report, runId: env.PI_BEHAVIOR_RUN })
    );
    return true;
  };
  assert.equal(await runVerification(f.root, run), true);
  assert.equal(
    await runVerification(f.root, async (_file, env) => {
      await fs.writeFile(env.PI_BEHAVIOR_REPORT, '{malformed');
      return true;
    }),
    false
  );
  assert.equal((await behaviorSnapshot(f.g)).behaviors[0].status, 'failed');
  let release, entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const pending = runVerification(f.root, async (_file, env) => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    return run(_file, env);
  });
  await ready;
  assert.equal((await behaviorSnapshot(f.g)).behaviors[0].status, 'checking');
  await assert.rejects(runVerification(f.root, run), /already active/);
  release();
  assert.equal(await pending, true);
  assert.equal((await behaviorSnapshot(f.g)).behaviors[0].status, 'passed');
  assert.equal(await runVerification(f.root, async () => false), false);
  assert.equal((await behaviorSnapshot(f.g)).behaviors[0].status, 'failed');
  const prior = await f.g.read(evidenceFile);
  await assert.rejects(
    runVerification(f.root, async (file, env) => {
      await fs.appendFile(path.join(f.root, 'src/app.ts'), '// concurrent edit\n');
      return run(file, env);
    }),
    /changed during verification/
  );
  assert.notEqual(await f.g.read(evidenceFile), prior);
  assert.equal(JSON.parse(await f.g.read(evidenceFile)).phase, 'running');
  assert.equal((await behaviorSnapshot(f.g)).behaviors[0].status, 'stale');
});

test('a failed rerun overlapping a panel read must replace the previous pass', async (t) => {
  const f = await fixture(t);
  for (const args of [
    ['init'],
    ['config', 'user.name', 'Fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
    ['add', '.'],
    ['commit', '-m', 'fixture']
  ])
    execFileSync('git', args, { cwd: f.root, stdio: 'ignore' });
  await f.g.write(evidenceFile, JSON.stringify(f.evidence));
  let reader, result;
  try {
    result = await runVerification(f.root, async () => {
      let entered;
      const ready = new Promise((resolve) => {
        entered = resolve;
      });
      reader = f.g.locked(async () => {
        entered();
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
      await ready;
      return false;
    });
  } finally {
    await reader;
  }
  assert.equal(result, false);
  assert.equal((await behaviorSnapshot(f.g)).behaviors[0].status, 'failed');
});
