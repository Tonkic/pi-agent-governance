'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { Governance } = require('../plugin/runtime/core');
const {
  behaviorContract,
  behaviorState,
  validateEvidence,
  evidenceFile
} = require('../plugin/runtime/behaviors');
async function withLock(g, fn) {
  const until = Date.now() + 5000;
  for (;;) {
    try {
      return await g.locked(fn);
    } catch (error) {
      if (!String(error.message).startsWith('Governance busy;') || Date.now() >= until) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
function makeEvidence(contract, report, runId, suitePassed, workspace, sourceCommit, workingTree) {
  const cases =
    report?.version === 1 && report.runId === runId && Array.isArray(report.cases)
      ? report.cases
      : [];
  const evidence = {
    version: 1,
    workspace,
    contractFingerprint: contract.fingerprint,
    sourceCommit,
    workingTree,
    at: new Date().toISOString(),
    environment: 'isolated-browser',
    phase: 'completed',
    suitePassed: suitePassed === true && report?.completed === true && report.runId === runId,
    cases
  };
  validateEvidence(evidence);
  return evidence;
}
async function runVerification(
  root,
  run = (file, env) => {
    const result = spawnSync(process.execPath, [file], {
      cwd: root,
      env,
      stdio: 'inherit',
      timeout: 180000
    });
    return result.status === 0 && !result.error;
  }
) {
  const g = new Governance(root);
  const contract = await withLock(g, () => behaviorContract(g));
  if (!contract) throw Error('Configure docs/behavior-bindings.json first');
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const sourceCommit = git('rev-parse', 'HEAD').trim();
  // Mark a working-tree snapshot honestly; a base SHA is not proof of dirty contents.
  const workingTree = Boolean(
    git(
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--',
      'docs/behavior-bindings.json',
      ...Object.keys(contract.fingerprints)
    ).trim()
  );
  const temp = path.resolve(process.env.PI_SCRATCH_DIR || os.tmpdir());
  await fs.mkdir(temp, { recursive: true });
  const runId = randomUUID(),
    reportFile = path.join(temp, `behavior-report-${runId}.json`);
  const checkLock = await g.safe('.governance/behavior-check.lock');
  await fs.mkdir(path.dirname(checkLock), { recursive: true });
  await fs.mkdir(checkLock).catch((error) => {
    if (error.code === 'EEXIST')
      throw Error('Behavior check already active; inspect an abandoned lock before recovery');
    throw error;
  });
  try {
    await withLock(g, async () => {
      const fresh = await behaviorContract(g);
      if (
        fresh?.fingerprint !== contract.fingerprint ||
        git('rev-parse', 'HEAD').trim() !== sourceCommit
      )
        throw Error('Content changed before verification; no test started');
      const pending = {
        ...makeEvidence(contract, null, runId, false, g.root, sourceCommit, workingTree),
        phase: 'running'
      };
      await g.write(evidenceFile, JSON.stringify(pending, null, 2) + '\n');
    });
    let suitePassed = false;
    try {
      suitePassed = await run(path.join(root, 'test/browser.cjs'), {
        ...process.env,
        PI_BEHAVIOR_REPORT: reportFile,
        PI_BEHAVIOR_RUN: runId
      });
    } catch {
      suitePassed = false;
    }
    let report = null;
    try {
      const stat = await fs.lstat(reportFile);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 100000)
        throw Error('Unsafe behavior report');
      report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
    } catch {
      report = null;
      suitePassed = false;
    }
    let evidence;
    try {
      evidence = makeEvidence(
        contract,
        report,
        runId,
        suitePassed,
        g.root,
        sourceCommit,
        workingTree
      );
    } catch {
      evidence = makeEvidence(contract, null, runId, false, g.root, sourceCommit, workingTree);
    }
    await withLock(g, async () => {
      const fresh = await behaviorContract(g);
      if (
        fresh?.fingerprint !== contract.fingerprint ||
        git('rev-parse', 'HEAD').trim() !== sourceCommit
      )
        throw Error(
          'Document, sources, tests or HEAD changed during verification; no evidence replaced'
        );
      await g.write(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
    });
    const states = behaviorState(contract, evidence, g.root);
    console.log(
      JSON.stringify(
        {
          sourceCommit,
          workingTree,
          environment: evidence.environment,
          behaviors: states.map((item) => ({ id: item.id, status: item.status, cases: item.cases }))
        },
        null,
        2
      )
    );
    return states.every((item) => item.status === 'passed');
  } finally {
    try {
      await fs.rm(reportFile, { force: true });
    } finally {
      await fs.rmdir(checkLock);
    }
  }
}
module.exports = { makeEvidence, runVerification };
if (require.main === module)
  runVerification(path.resolve(__dirname, '..'))
    .then((passed) => {
      if (!passed) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
