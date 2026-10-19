'use strict';
module.exports = async ({ browser, screenshots }) => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const { Governance } = require('../build/plugin/core'), { startConsole } = require('../build/web/server');
  const root = await fs.realpath(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'behaviors083-')));
  const output = path.join(screenshots, 'behavior-page'); await fs.mkdir(output, { recursive: true });
  const g = new Governance(root), contexts = [], errors = [], external = []; let app, shots = 0;
  const ready = p => p.waitForFunction(() => !document.querySelector('#refresh').disabled && document.querySelector('#board-section').getAttribute('aria-busy') === 'false');
  const loaded = p => p.waitForFunction(() => document.documentElement.dataset.view === 'behaviors-section' && !document.querySelector('#behavior-refresh').disabled && document.querySelector('#behaviors-section').getAttribute('aria-busy') === 'false');
  const writeProse = async label => g.write('docs/behavior-demo.md', `# Demo only\n\n### UI-083 — ${label}\n\nReadable specification / 可读行为说明。\n<img src="https://remote.invalid/pixel" onerror="window.behaviorXss=1">\n[external](https://remote.invalid/)\n`);
  try {
    await g.run({ action: 'init' }); await writeProse('Demo specification'); await g.write('src/example.ts', 'export const example = 1;\n');
    await g.write('docs/behavior-bindings.json', JSON.stringify({ version: 1, behaviors: [{ id: 'UI-083', document: 'docs/behavior-demo.md', cases: ['demo-case'], files: ['src/example.ts'] }] }));
    const before = await fs.readFile(path.join(root, 'STATE.json')); app = await startConsole({ workspace: root });
    for (const language of ['zh-CN', 'en-US']) {
      const context = await browser.newContext({ locale: language, viewport: { width: 1280, height: 1000 } }); contexts.push(context);
      const p = await context.newPage(); let reads = 0;
      p.on('pageerror', e => errors.push(e.message)); p.on('request', r => { if (!r.url().startsWith(app.origin)) external.push(r.url()); if (r.url().endsWith('/api/invoke') && r.postDataJSON()?.channel === 'governance.behaviors') reads++; });
      await p.goto(app.url); await ready(p); assert.equal(reads, 0, 'No behavior read before the page is selected');
      await p.locator('#nav-behaviors').click(); await loaded(p); assert.equal(reads, 1);
      assert.equal(await p.locator('#nav-behaviors').getAttribute('aria-current'), 'page'); assert.equal(await p.locator('#page-title').textContent(), language === 'zh-CN' ? '行为文档' : 'Behavior docs');
      assert.equal(await p.locator('#behavior-docs-dialog').count(), 0); assert.equal(await p.locator('#board-section').isVisible(), false);
      assert.match(await p.locator('.behavior-prose').textContent(), /<img src=/); assert.equal(await p.locator('#behavior-docs-content img, #behavior-docs-content a, #behavior-docs-content script').count(), 0); assert.equal(await p.evaluate(() => window.behaviorXss), undefined);
      assert.equal(await p.locator('.behavior-status').getAttribute('data-result'), 'unverified');
      await p.locator('.behavior-document summary').click(); assert.match(await p.locator('.behavior-document pre').textContent(), /demo-case/); await p.locator('.behavior-document summary').click();
      for (const width of [320, 390, 768, 1672]) for (const theme of ['light', 'dark']) {
        await p.setViewportSize({ width, height: 1000 }); await p.emulateMedia({ colorScheme: theme });
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Behavior prose/evidence never overflow the page');
        await p.screenshot({ path: path.join(output, `${language}-${width}-${theme}.png`) }); shots++;
      }
      await p.locator('a[href="#board-section"]').click(); await p.waitForFunction(() => document.documentElement.dataset.view === 'board-section');
      await p.goBack(); await loaded(p); assert.equal(reads, 1, 'History reuses the current page data'); await p.goForward(); await ready(p);
      await p.locator('#nav-behaviors').click(); await loaded(p); await p.reload(); await ready(p); await loaded(p); assert.equal(reads, 2, 'Reload on direct hash loads its own data');
      const offlineReads = reads; await context.setOffline(true); await p.waitForFunction(() => document.querySelector('#behavior-refresh').disabled);
      assert.match(await p.locator('#behavior-docs-status').textContent(), /Offline|离线/); assert.match(await p.locator('.behavior-prose').textContent(), /Readable specification/);
      await context.setOffline(false); await loaded(p); assert.equal(reads, offlineReads, 'No automatic replay on reconnect');
      let errorsSeen = 0;
      await p.route('**/api/invoke', route => { if (route.request().postDataJSON()?.channel === 'governance.behaviors') { errorsSeen++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Controlled behavior read error' }) }); } return route.continue(); });
      await p.locator('#behavior-refresh').click(); await loaded(p); assert.match(await p.locator('#behavior-docs-status').textContent(), /Controlled behavior read error/); assert.match(await p.locator('.behavior-prose').textContent(), /Readable specification/);
      await p.locator('a[href="#board-section"]').click(); await p.locator('#nav-behaviors').click(); await loaded(p); assert.equal(errorsSeen, 1, 'Errors do not retry on navigation'); await p.unroute('**/api/invoke');
      await p.locator('#behavior-refresh').click(); await loaded(p); assert.equal(await p.locator('#behavior-docs-status').textContent(), '');
      let release, entered, finished; const held = new Promise(resolve => { entered = resolve; }), completed = new Promise(resolve => { finished = resolve; }); let first = true;
      await p.route('**/api/invoke', async route => { if (route.request().postDataJSON()?.channel === 'governance.behaviors' && first) { first = false; const response = await route.fetch(); entered(); await new Promise(resolve => { release = resolve; }); try { await route.fulfill({ response }); } finally { finished(); } return; } return route.continue(); });
      await p.locator('#behavior-refresh').click(); await held;
      try {
        assert.equal(await p.locator('#refresh').isDisabled(), false, 'Read-only page does not globally lock navigation/refresh');
        await writeProse('New current data'); await p.locator('#refresh').click(); await ready(p); await loaded(p);
        assert.match(await p.locator('.behavior-document h3').textContent(), /New current data/);
      } finally { release(); await completed; }
      await p.unroute('**/api/invoke'); await loaded(p); assert.match(await p.locator('.behavior-document h3').textContent(), /New current data/);
      await writeProse('Demo specification');
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(await fs.readFile(path.join(root, 'STATE.json')), before);
    console.log(`PASS behavior primary page: lazy/direct hash/reload/history, readonly safe prose and evidence, responsive bilingual themes, offline cache/no replay/error/manual retry, global refresh supersedes late response; ${shots} screenshots: ${output}`);
  } finally { for (const context of contexts) await context.close(); await app?.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); }
};
