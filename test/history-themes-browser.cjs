'use strict';
// Independent completed-history visual checks; WS/AD behavior guards stay in browser.cjs.
module.exports = async ({ assert, historyPage, sendAppearance, capture }) => {
  for (const width of [390, 768, 1280]) for (const theme of ['light', 'dark']) {
    await historyPage.setViewportSize({ width, height: 1000 });
    await sendAppearance(historyPage, { base: theme });
    const bounds = await historyPage.locator('#completed-history-dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0);
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - width / 2) < 2, 'History modal is centered');
    assert.equal(await historyPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width === 390) assert.equal(await historyPage.locator('.completed-table-scroll').evaluate(el => el.scrollWidth > el.clientWidth), true);
    await capture(historyPage, `completed-history-${width}-${theme}`);
  }
};
