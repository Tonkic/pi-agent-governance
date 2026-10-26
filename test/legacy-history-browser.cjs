'use strict';
// Independent legacy UI compatibility scenarios; still awaited by the core browser run.
module.exports = async function legacyHistory({ page, first, snapshot, hostCalls, card, close, menu, confirm, capture, mutate, root, g, itemFingerprint, randomUUID, projectTool, settled, refresh, stateBefore }) {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
  assert.equal(await page.locator('#accept-dialog, #accept-form, #item-human-review, #item-agent-review, .card-review-actions, #item-menu, #workitem-form').count(), 0);
  await card(page, first).click();
  assert.match(await page.locator('#item-checks h3').textContent(), /检查条件/);
  assert.equal(await page.locator('#item-history').isVisible(), false);
  await close(page);

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
  assert.equal(await page.locator('#item-menu').count(), 0);
  await refresh(page);
  assert.equal(await fs.readFile(legacyBoardPath, 'utf8'), legacyRaw, 'Reading legacy history must not migrate/write board data');
  assert.equal((await snapshot()).revision, legacyRevision);

  // Legacy operation records are retained on disk, not exposed as browser controls.
  const legacyRun = { id: randomUUID(), kind: 'acceptance', phase: 'running', workspace: root,
    taskId: 'overall', itemId: legacyId, sessionId: 'legacy-fixture-session',
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' };
  await g.write('.governance/operations.json', JSON.stringify({ version: 1, runs: [legacyRun] }) + '\n');
  const historyRaw = await fs.readFile(path.join(root, '.governance/operations.json'), 'utf8');
  await refresh(page);
  assert.equal(await page.locator('#operations-open, #operations-dialog, .operation-run').count(), 0);
  assert.equal(await fs.readFile(path.join(root, '.governance/operations.json'), 'utf8'), historyRaw);
  assert.equal(await fs.readFile(legacyBoardPath, 'utf8'), legacyRaw);
};
