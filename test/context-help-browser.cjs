'use strict';
// Actual loopback UI. Fixtures are explicit; no external resources or project writes from help.
module.exports = async ({ browser, screenshots }) => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const { Governance } = require('../build/plugin/core'), { startConsole } = require('../build/web/server');
  const root = await fs.realpath(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'context-help-')));
  const output = path.join(screenshots, 'context-help'); await fs.mkdir(output, { recursive: true });
  const contexts = [], errors = [], external = []; let app, shots = 0;
  const ready = p => p.waitForFunction(() => document.querySelector('#board-section').getAttribute('aria-busy') === 'false' && !document.querySelector('#refresh').disabled && document.querySelector('[data-context-help="graph-help"]'));
  const trigger = (p, id) => p.locator(`[data-context-help="${id}"]`);
  const closed = (p, id) => p.waitForFunction(id => !document.getElementById(id).matches(':popover-open'), id);
  const opened = (p, id) => p.waitForFunction(id => document.getElementById(id).matches(':popover-open'), id);
  const navigate = async (p, id) => { await p.locator(`.workspace-nav a[href="#${id}"]`).click(); await p.waitForFunction(id => document.documentElement.dataset.view === id, id); };
  const bounds = async (p, id) => { const r = await p.locator('#' + id).boundingBox(); assert.ok(r && r.x >= 11 && r.y >= 11 && r.x + r.width <= p.viewportSize().width - 11 && r.y + r.height <= p.viewportSize().height - 11, JSON.stringify(r)); };
  try {
    const g = new Governance(root); await g.run({ action: 'init' }); await g.run({ action: 'start', id: 'help-fixture', goal: 'Fixture for contextual help', criteria: ['Help is local'] });
    await fs.mkdir(path.join(root, 'docs')); await fs.writeFile(path.join(root, 'docs/demo.md'), '# Visible article\n\nThe content is more important than repeated interface explanations.');
    let s = await g.run({ action: 'architecture_design_snapshot' }); await g.run({ action: 'architecture_design_begin', expectedRevision: s.revision, reason: 'Explicit fixture' }); s = await g.run({ action: 'architecture_design_snapshot' });
    await g.run({ action: 'architecture_design_save', expectedRevision: s.revision, expectedDraft: s.draft.draftId, proposal: { title: 'Fixture diagram', document: 'Intent only', nodes: [{ id: 'a', title: 'Visible node', description: 'Fixture responsibility', files: [] }], edges: [] } });
    let project = await g.run({ action: 'project_snapshot' }); await g.run({ action: 'board_create', id: 'completed-fixture', title: 'Completed fixture', expectedRevision: project.revision });
    for (const stage of ['doing', 'done']) { project = await g.run({ action: 'project_snapshot' }); await g.run({ action: 'board_move', id: 'completed-fixture', stage, position: 0, expectedRevision: project.revision }); }
    const before = await Promise.all(['STATE.json', '.governance/board.json', '.governance/architecture-design.json'].map(file => fs.readFile(path.join(root, file))));
    app = await startConsole({ workspace: root });
    for (const language of ['zh-CN', 'en-US']) {
      const context = await browser.newContext({ locale: language, viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' }); contexts.push(context);
      const p = await context.newPage(); const calls = [];
      p.on('pageerror', e => errors.push(e.message)); p.on('request', r => { if (!r.url().startsWith(app.origin)) external.push(r.url()); if (r.url().endsWith('/api/invoke')) calls.push(r.postDataJSON()); });
      await p.goto(app.url); await ready(p);
      assert.equal(await p.locator('#local-console-copy').isVisible(), false);
      assert.equal(await p.locator('.board-column[data-stage="done"] .completed-summary:not([popover])').count(), 1, 'Counts remain, drag explanation no longer occupies a row');
      await navigate(p, 'architecture'); await p.locator('#show-design').click(); await p.waitForFunction(() => document.querySelectorAll('.architecture-node').length === 1);
      for (const id of ['graph-help', 'design-scope-note']) { assert.equal(await p.locator('#' + id).isVisible(), false); assert.equal(await trigger(p, id).isVisible(), true); }
      const count = calls.length;
      for (const dismiss of ['escape', 'outside']) {
        await p.evaluate(kind => { document.querySelector('[data-context-help="graph-help"]').dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' })); if (kind === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); else document.querySelector('#architecture-title').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }, dismiss);
        await p.waitForTimeout(350); assert.equal(await p.locator('#graph-help').isVisible(), false, `${dismiss} cancels pending hover before it opens`);
      }
      await trigger(p, 'graph-help').hover(); await opened(p, 'graph-help');
      assert.equal(await trigger(p, 'graph-help').getAttribute('aria-describedby'), 'graph-help'); assert.match(await trigger(p, 'graph-help').getAttribute('aria-label'), language === 'zh-CN' ? /^帮助：/ : /^Help:/);
      await p.locator('#graph-help').hover(); await p.waitForTimeout(180); assert.equal(await p.locator('#graph-help').isVisible(), true, 'Hoverable copy stays open while being read');
      await p.mouse.move(0, 0); await closed(p, 'graph-help');
      await trigger(p, 'graph-help').focus(); await opened(p, 'graph-help'); await p.keyboard.press('Escape'); await closed(p, 'graph-help');
      assert.equal(await trigger(p, 'graph-help').evaluate(n => document.activeElement === n), true, 'Escape preserves trigger focus');
      assert.equal(calls.length, count, 'Help never invokes the project API');
      for (const width of [320, 390, 768, 1440]) for (const theme of ['light', 'dark']) {
        await p.setViewportSize({ width, height: 1000 }); await p.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await p.waitForFunction(theme => document.documentElement.dataset.base === theme, theme);
        const beforeBox = await p.locator('#graph-viewport').boundingBox();
        await trigger(p, 'graph-help').click(); await opened(p, 'graph-help'); await bounds(p, 'graph-help');
        assert.deepEqual(await p.locator('#graph-viewport').boundingBox(), beforeBox, 'Explanation overlays, never pushes the visualization');
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await p.screenshot({ path: path.join(output, `${language}-${width}-${theme}.png`) }); shots++;
        await p.keyboard.press('Escape'); await closed(p, 'graph-help');
      }
      await trigger(p, 'graph-help').click(); await opened(p, 'graph-help'); await trigger(p, 'design-scope-note').click(); await opened(p, 'design-scope-note'); await closed(p, 'graph-help');
      await p.locator('#architecture-title').click(); await closed(p, 'design-scope-note');
      await trigger(p, 'graph-help').click(); await navigate(p, 'behaviors-section'); assert.equal(await p.locator('.context-help-popover:popover-open').count(), 0);
      await trigger(p, 'behavior-help').click(); await opened(p, 'behavior-help'); assert.equal(await p.locator('#behavior-help').textContent(), await p.evaluate(() => t('behaviorScope'))); await p.keyboard.press('Escape');
      await navigate(p, 'git-section'); await p.waitForFunction(() => document.querySelector('#git-history-view').getAttribute('aria-busy') === 'false');
      assert.equal(await p.locator('#git-history-help').isVisible(), false); await trigger(p, 'git-history-help').click(); await opened(p, 'git-history-help'); assert.match(await p.locator('#git-history-help').textContent(), /只读|Read-only/); await p.keyboard.press('Escape');
      await navigate(p, 'documents-section'); await p.waitForFunction(() => document.querySelector('[data-document="docs/demo.md"]'));
      const library = p.locator('.reader-library'); if (!await library.evaluate(n => n.open)) await library.locator('summary').click();
      await p.locator('[data-document="docs/demo.md"]').click(); await p.waitForFunction(() => document.querySelector('#documents-body h1')?.textContent === 'Visible article');
      const proseBefore = await p.locator('#documents-body').boundingBox(); await trigger(p, 'reader-help').click(); await opened(p, 'reader-help'); assert.deepEqual(await p.locator('#documents-body').boundingBox(), proseBefore);
      assert.match(await p.locator('#reader-help').textContent(), /HTML/); await p.keyboard.press('Escape');
      await context.setOffline(true); await p.waitForFunction(() => document.querySelector('#documents-refresh').disabled);
      assert.equal(await trigger(p, 'reader-help').isEnabled(), true); await trigger(p, 'reader-help').click(); await opened(p, 'reader-help'); assert.match(await p.locator('#documents-status').textContent(), /离线|Offline/); await p.keyboard.press('Escape'); await context.setOffline(false); await ready(p);
      await navigate(p, 'board-section'); await p.locator('#completed-history-open').click(); await p.locator('#completed-history-dialog').waitFor({ state: 'visible' });
      assert.equal(await p.locator('#completed-history-hint').isVisible(), false); await trigger(p, 'completed-history-hint').focus(); await opened(p, 'completed-history-hint'); await p.keyboard.press('Escape');
      assert.equal(await p.locator('#completed-history-dialog').evaluate(n => n.open), true, 'First Escape dismisses help, not its owning dialog'); await p.keyboard.press('Escape');
      await p.locator('[data-workitem="completed-fixture"]').click(); await trigger(p, 'item-checks-hint').click(); await opened(p, 'item-checks-hint'); assert.match(await p.locator('#item-checks-hint').textContent(), /检查|checks/i); await p.keyboard.press('Escape'); await p.locator('#item-close').click();
      await p.locator('#project-open').click(); assert.equal(await p.locator('[data-i18n="verificationHint"]').isVisible(), true, 'Consequences of writes are not hidden as help'); await p.locator('#project-close').click();
      await p.close();
    }
    const touch = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true }); contexts.push(touch); const p = await touch.newPage(); await p.goto(app.url); await ready(p); await navigate(p, 'architecture');
    const help = trigger(p, 'graph-help'); const size = await help.boundingBox(); assert.ok(size.width >= 44 && size.height >= 44);
    await help.tap(); await opened(p, 'graph-help'); await bounds(p, 'graph-help'); await p.locator('#architecture-title').tap(); await closed(p, 'graph-help');
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(await Promise.all(['STATE.json', '.governance/board.json', '.governance/architecture-design.json'].map(file => fs.readFile(path.join(root, file)))), before);
    console.log(`PASS contextual help: five pages/modal, no inline explanation rows or layout shift, hover/focus/Escape/outside/single-open, bilingual themes/320-1440 bounds, touch44px/offline/no API writes; ${shots} screenshots`);
  } finally { for (const context of contexts) await context.close(); await app?.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); }
};
