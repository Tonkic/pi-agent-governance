'use strict';
// Independent legacy UI compatibility scenarios; still awaited by the core browser run.
module.exports = async function legacyHistory({ page, first, snapshot, hostCalls, card, close, menu, confirm, capture, mutate, root, g, itemFingerprint, randomUUID, projectTool, settled, refresh, stateBefore }) {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
  await menu(page, first, '编辑');
  await page.locator('#workitem-blocker').fill('Needs approval');
  await page.locator('#workitem-save').click();
  await confirm(page);
  await menu(page, first, '移至已完成');
  await confirm(page);
  assert.match(await page.locator('#notice').textContent(), /blocker/);
  assert.equal((await snapshot()).board.items.find((i) => i.id === first).stage, 'doing');
  await menu(page, first, '编辑');
  await page.locator('#workitem-blocker').fill('');
  await page.locator('#workitem-save').click();
  await confirm(page);
  await menu(page, first, '移至已完成');
  await confirm(page);
  assert.equal((await snapshot()).board.items.find((i) => i.id === first).stage, 'done');
  assert.equal(await fs.readFile(path.join(root, 'STATE.json'), 'utf8'), stateBefore);
  // The browser checks above actually ran before done; no additional review form or Agent task.
  assert.equal((await snapshot()).board.items.find(i => i.id === first).acceptance ?? null, null);
  assert.equal(await page.locator('#accept-dialog, #accept-form, #item-human-review, #item-agent-review, .card-review-actions').count(), 0);
  assert.equal(await page.getByRole('button', { name: /^(人工验收|Agent 验收)$/ }).count(), 0);
  const callsBeforeDone = hostCalls.length;
  await card(page, first).click({ button: 'right' });
  assert.doesNotMatch(await page.locator('#item-menu').textContent(), /验收/);
  await page.keyboard.press('Escape');
  await card(page, first).click();
  assert.match(await page.locator('#item-checks h3').textContent(), /检查条件/);
  assert.equal(await page.locator('#item-history').isVisible(), false);
  await close(page);
  await menu(page, first, '移至正在进行');
  await confirm(page);
  assert.equal((await snapshot()).board.items.find(i => i.id === first).stage, 'doing');
  await menu(page, first, '移至已完成');
  await confirm(page);
  assert.equal((await snapshot()).board.items.find(i => i.id === first).stage, 'done');
  assert.equal(hostCalls.length, callsBeforeDone, 'Done/reopen does not launch an Agent');
  await capture(page, 'direct-done');

  // Seed an explicitly historical fixture on disk; read it through the actual backend.
  // This is old-format compatibility data, not current-run test evidence or a live review action.
  const legacyId = 'legacy-accepted';
  await mutate({ action: 'board_create', id: legacyId, title: 'Historical completed work', criteria: ['Historical fixture check'] });
  const legacyBoardPath = path.join(root, '.governance/board.json');
  const legacyBoard = JSON.parse(await fs.readFile(legacyBoardPath, 'utf8'));
  const legacyItem = legacyBoard.items.find(i => i.id === legacyId);
  legacyItem.stage = 'accepted';
  legacyItem.acceptance = { method: 'human', passed: true, valid: true,
    itemFingerprint: itemFingerprint(legacyItem), at: '2020-01-01T00:00:00.000Z',
    reviewer: 'Legacy fixture reviewer', conclusion: 'Archived fixture conclusion',
    evidence: 'Historical fixture only; not evidence for this test run' };
  await g.write('.governance/board.json', JSON.stringify(legacyBoard, null, 2) + '\n');
  const legacyRaw = await fs.readFile(legacyBoardPath, 'utf8');
  const legacyRevision = (await snapshot()).revision;
  await refresh(page);
  assert.equal(await page.locator(`[data-stage="done"] [data-workitem="${legacyId}"]`).count(), 1);
  assert.equal(await page.locator('[data-stage="accepted"]').count(), 0);
  assert.match(await card(page, legacyId).locator('.item-meta').textContent(), /已完成/);
  await card(page, legacyId).click();
  assert.match(await page.locator('#item-sheet-meta').textContent(), /已完成/);
  assert.equal(await page.locator('#item-history').evaluate(el => el.open), false);
  await page.locator('#item-history summary').click();
  assert.match(await page.locator('#item-history summary').textContent(), /历史检查记录.*旧版.*只读/);
  assert.match(await page.locator('#item-review-record').textContent(), /旧版人工验收记录.*Legacy fixture reviewer/);
  assert.match(await page.locator('#item-review-record').textContent(), /not evidence for this test run/);
  await capture(page, 'legacy-history');
  await close(page);
  await card(page, legacyId).click({ button: 'right' });
  assert.doesNotMatch(await page.locator('#item-menu').textContent(), /验收/);
  assert.equal(await page.locator('#item-menu').getByRole('menuitem', { name: '移至正在进行', exact: true }).count(), 1);
  await page.keyboard.press('Escape');
  await refresh(page);
  assert.equal(await fs.readFile(legacyBoardPath, 'utf8'), legacyRaw, 'Reading legacy history must not migrate/write board data');
  assert.equal((await snapshot()).revision, legacyRevision);

  // Old review sessions remain readable/open/status/cancel, but are never newly launched.
  const legacyRun = { id: randomUUID(), kind: 'acceptance', phase: 'running', workspace: root,
    taskId: 'overall', itemId: legacyId, sessionId: 'legacy-fixture-session',
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' };
  let historicalRuns = { version: 1, runs: [] };
  try { historicalRuns = JSON.parse(await fs.readFile(path.join(root, '.governance/operations.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  historicalRuns.runs.push(legacyRun);
  await g.write('.governance/operations.json', JSON.stringify(historicalRuns, null, 2) + '\n');
  const historyRaw = await fs.readFile(path.join(root, '.governance/operations.json'), 'utf8');
  const promptsBeforeHistory = hostCalls.filter(c => ['session/create', 'agent/prompt'].includes(c.operation)).length;
  await projectTool(page, 'operations-open');
  await settled(page);
  const historyRow = page.locator('.operation-run').filter({ hasText: '历史工作项验收（旧版）' });
  await historyRow.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await historyRow.count(), 1);
  assert.equal(await fs.readFile(path.join(root, '.governance/operations.json'), 'utf8'), historyRaw);
  await historyRow.getByRole('button', { name: '打开 Agent 会话', exact: true }).click();
  await settled(page);
  assert.equal(hostCalls.findLast(c => c.operation === 'session/open').args[0], 'legacy-fixture-session');
  await historyRow.getByRole('button', { name: '查看进度 / 结果', exact: true }).click();
  await settled(page);
  assert.match(await page.locator('#operation-result').textContent(), /Fixture analysis output/);
  await capture(page, 'legacy-agent-progress');
  await historyRow.getByRole('button', { name: '取消任务', exact: true }).click();
  await confirm(page);
  assert.equal(hostCalls.at(-1).operation, 'agent/abort');
  assert.equal(hostCalls.filter(c => ['session/create', 'agent/prompt'].includes(c.operation)).length, promptsBeforeHistory);
  assert.equal(await fs.readFile(legacyBoardPath, 'utf8'), legacyRaw, 'Legacy session management cannot change the board');
  await page.locator('#operations-close').click();
};
