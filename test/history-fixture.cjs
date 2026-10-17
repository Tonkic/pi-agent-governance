'use strict';
// Independent completed-history seed data; all rendering and WS/AD assertions stay in browser.cjs.
module.exports = async ({ root, Governance, fs, path, itemFingerprint }) => {
  const historyGovernance = new Governance(root);
  await historyGovernance.run({ action: 'init' });
  await historyGovernance.run({ action: 'start', id: 'history', goal: 'Completed history fixture', criteria: ['History stays intact'] });
  const historySnapshot = () => historyGovernance.run({ action: 'project_snapshot' });
  for (let index = 0; index < 10; index++) {
    await historyGovernance.run({ action: 'board_create', id: `history-${index}`,
      title: index === 0 ? 'Older <img src=x onerror=alert(1)> record' : `Completed fixture ${index}`,
      description: `History fixture ${index}`, criteria: [`criterion-${index}`, 'Second check'],
      architectureImpact: index % 2 ? 'affects' : 'none', expectedRevision: (await historySnapshot()).revision });
  }
  const historyBoardPath = path.join(root, '.governance/board.json');
  const historyBoard = JSON.parse(await fs.readFile(historyBoardPath, 'utf8'));
  const dates = ['2019-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', '2022-01-01T00:00:00.000Z',
    '2024-01-01T00:00:00.000Z', '2023-01-01T00:00:00.000Z'];
  historyBoard.updatedAt = '2030-01-01T00:00:00.000Z';
  historyBoard.items.forEach((item, index) => {
    item.stage = index === 9 ? 'doing' : index === 5 ? 'accepted' : 'done';
    if (index < dates.length) item.completedAt = dates[index];
    if (index === 5) item.acceptance = { method: 'human', passed: true, valid: true,
      itemFingerprint: itemFingerprint(item), at: '2021-01-01T00:00:00.000Z',
      reviewer: 'Historical fixture', conclusion: 'Old record', evidence: 'Fixture only', criteria: item.criteria };
  });
  await historyGovernance.write('.governance/board.json', JSON.stringify(historyBoard, null, 2) + '\n');
  const historyRaw = await fs.readFile(historyBoardPath, 'utf8'), historyRevision = (await historySnapshot()).revision;
  return { historySnapshot, historyBoardPath, historyRaw, historyRevision };
};
