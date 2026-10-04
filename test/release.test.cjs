'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decision, stable, compare, validatePolicy, permissionGuard, receiptGuard, execute } = require('../scripts/release-auto.cjs');
const { versionPayload, unwrap } = require('../scripts/plugin-center.cjs');
const policy = require('../scripts/release-policy.json');
const id = 'io.github.tonkic.agent-governance';
const sha = 'a'.repeat(40);
function status(extra = []) { return { pluginId: id, boundRepository: 'Tonkic/pi-agent-governance', state: 'active', versions: [{ version: '0.6.0', status: 'published', channel: 'stable', sourceRef: sha }, ...extra] }; }

test('release policy skips patches and unchanged versions; minor and major qualify numerically', () => {
  validatePolicy(policy);
  assert.equal(decision('0.6.1', status()).publish, false);
  assert.equal(decision('0.6.0', status()).publish, false);
  for (const version of ['0.7.0', '0.7.2', '1.0.0']) assert.equal(decision(version, status()).publish, true);
  assert.equal(compare('0.10.0', '0.9.0'), 1);
  assert.equal(decision('0.10.1', status([{ version: '0.10.0', status: 'published', channel: 'stable', sourceRef: sha }])).publish, false);
});
test('release policy rejects prereleases, invalid versions, downgrades and unknown identity', () => {
  for (const v of ['0.7.0-beta.1', '0.7.0+build', 'v1.0.0', '1.0', '01.0.0', '99999999999999999.0.0']) assert.throws(() => stable(v));
  assert.throws(() => decision('0.5.9', status()), /older/);
  assert.throws(() => decision('0.7.0', { ...status(), pluginId: 'other' }));
  assert.throws(() => decision('0.7.0', { ...status(), versions: [] }), /baseline/);
  assert.throws(() => validatePolicy({ ...policy, enabled: false }), /disabled/);
  assert.throws(() => validatePolicy({ ...policy, rule: 'every-patch' }), /approval/);
  assert.throws(() => validatePolicy({ ...policy, allowSupersede: true }), /approval/);
});
test('existing, pending and unknown remote versions cannot be overwritten or superseded', () => {
  assert.throws(() => decision('0.7.0', status([{ version: '0.7.0', status: 'rejected' }])), /exists/);
  for (const state of ['pending', 'approved', 'unknown']) assert.throws(() => decision('0.8.0', status([{ version: '0.7.0', status: state }])), /Pending/);
});
test('permissions and filesystem/network scope changes require fresh approval', () => {
  const base = { permissions: ['ui.panel'], net: { domains: ['example.com'] } };
  permissionGuard({ ...base }, base);
  assert.throws(() => permissionGuard({ ...base, permissions: ['ui.panel', 'new'] }, base), /approval/);
  assert.throws(() => permissionGuard({ ...base, fs: { write: true } }, base), /approval/);
  assert.throws(() => permissionGuard({ ...base, net: {} }, base), /approval/);
});
test('every release receipt check must pass and bind the exact source/package', () => {
  const checks = Object.fromEntries(['pluginCheck', 'pluginPack', 'i18n', 'diffReview', 'secretReview'].map(k => [k, { passed: true, evidence: 'Actual check log' }]));
  const receipt = { sourceRef: sha, packageSha256: 'hash', checks };
  receiptGuard(receipt, sha, 'hash');
  assert.throws(() => receiptGuard(receipt, 'b'.repeat(40), 'hash'));
  assert.throws(() => receiptGuard(receipt, sha, 'different'));
  for (const k of Object.keys(checks)) {
    assert.throws(() => receiptGuard({ ...receipt, checks: { ...checks, [k]: { passed: false, evidence: 'failed' } } }, sha, 'hash'));
    assert.throws(() => receiptGuard({ ...receipt, checks: { ...checks, [k]: { passed: true, evidence: '' } } }, sha, 'hash'));
  }
});
test('version submission maps pluginId and preserves host manifest fields without first-create fields', () => {
  const p = versionPayload({ id, repository: 'repo', readme: 'doc', sourceRef: sha, version: '0.7.0', ui: { entry: 'x' }, contributes: { commands: [] }, activationEvents: ['startup'], files: [], permissions: ['ui.panel'] });
  assert.equal(p.pluginId, id); assert.equal(p.sourceRef, sha);
  for (const key of ['id', 'repository', 'readme', 'confirmSupersede']) assert.equal(key in p, false);
  assert.deepEqual(p.ui, { entry: 'x' }); assert.deepEqual(p.activationEvents, ['startup']);
  assert.deepEqual(unwrap({ content: [{ type: 'text', text: '{"available":true}' }] }), { available: true });
  assert.throws(() => unwrap({ isError: true, content: [] }));
  assert.throws(() => unwrap({ content: [] }));
});
function operations(failAt) {
  const calls = [];
  const ops = Object.fromEntries(['preflight', 'checkRemote', 'push', 'markAttempt', 'submit', 'status'].map(key => [key, async () => { calls.push(key); if (key === failAt) throw Error(key); return { state: 'published' }; }]));
  return { calls, ops };
}
test('patch execution has no checks, push or submission side effects', async () => {
  const { calls, ops } = operations();
  await execute(decision('0.6.1', status()), ops);
  assert.deepEqual(calls, []);
});
test('automatic publication orders checks, push, durable marker, submission and status', async () => {
  const { calls, ops } = operations();
  assert.deepEqual(await execute(decision('0.7.0', status()), ops), { state: 'published' });
  assert.deepEqual(calls, ['preflight', 'checkRemote', 'push', 'checkRemote', 'markAttempt', 'submit', 'status']);
});
test('failed checks or persistence prevent submission; timeouts never retry mutations', async () => {
  for (const step of ['preflight', 'checkRemote', 'push', 'markAttempt', 'submit', 'status']) {
    const { calls, ops } = operations(step);
    await assert.rejects(execute({ publish: true }, ops), new RegExp(step));
    assert.ok(calls.filter(c => c === 'submit').length <= 1);
    if (['preflight', 'checkRemote', 'push', 'markAttempt'].includes(step)) assert.ok(!calls.includes('submit'));
    if (step === 'submit') assert.equal(calls.at(-1), 'submit');
  }
});
