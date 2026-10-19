'use strict';
module.exports = async ({ browser, screenshots }) => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), { execFileSync } = require('node:child_process');
  const { Governance } = require('../build/plugin/core'), { startConsole } = require('../build/web/server');
  const root = await fs.realpath(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'git-graph-browser-')));
  const g = new Governance(root), contexts = [], errors = [], requests = []; let app, shots = 0;
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=' + path.join(root, 'disabled-hooks'), '-c', 'commit.gpgSign=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const output = path.join(screenshots, 'git-history'); await fs.mkdir(output, { recursive: true });
  const ready = p => p.waitForFunction(() => !document.querySelector('#refresh').disabled);
  const loaded = p => p.waitForFunction(() => !document.querySelector('#git-history-refresh').disabled && document.querySelectorAll('[data-commit]').length > 0 && document.querySelector('#git-history-view').getAttribute('aria-busy') === 'false');
  const detailed = p => p.waitForFunction(() => !document.querySelector('#git-history-detail').hidden && document.querySelector('#git-commit-title') && document.querySelector('#git-history-view').getAttribute('aria-busy') === 'false');
  const shot = async (p, name) => { await p.screenshot({ path: path.join(output, name + '.png') }); shots++; };
  try {
    await g.run({ action: 'init' }); git('init', '-b', 'main'); git('config', 'user.name', 'Demo author'); git('config', 'user.email', 'demo@example.invalid');
    await fs.writeFile(path.join(root, 'plain.txt'), 'before\n'); git('add', '--', 'plain.txt'); git('commit', '-m', 'Initial demo / 初始提交'); const initial = git('rev-parse', 'HEAD');
    // An actual 104-commit chain makes pagination deterministic without 104 process launches.
    let stream = '';
    for (let i = 0; i < 104; i++) { const message = `Earlier change ${i}\n`; stream += `commit refs/heads/main\ncommitter Demo author <demo@example.invalid> ${1700000000 + i} +0000\ndata ${Buffer.byteLength(message)}\n${message}${i === 0 ? `from ${initial}\n` : ''}\n`; }
    execFileSync('git', ['fast-import', '--quiet'], { cwd: root, input: stream, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    git('checkout', '-b', 'feature/demo');
    await fs.writeFile(path.join(root, '中文 文件.txt'), 'feature content / 新增内容\n'); await fs.writeFile(path.join(root, 'binary.png'), Buffer.from([0, 1, 2, 3])); await fs.writeFile(path.join(root, '.env'), 'demo-only-value\n');
    git('add', '--', '中文 文件.txt', 'binary.png', '.env'); git('commit', '-m', 'Feature <img src=x onerror=alert(1)>'); const feature = git('rev-parse', 'HEAD');
    git('checkout', 'main'); await fs.writeFile(path.join(root, 'plain.txt'), 'after\n'); git('add', '--', 'plain.txt'); git('commit', '-m', 'Main improvement'); const mainParent = git('rev-parse', 'HEAD');
    git('merge', '--no-ff', 'feature/demo', '-m', 'Merge feature / 合并演示'); const merge = git('rev-parse', 'HEAD'); git('tag', 'demo-tag');
    const total = Number(git('rev-list', '--count', '--all')), beforeRefs = git('show-ref'), beforeState = await fs.readFile(path.join(root, 'STATE.json'));
    app = await startConsole({ workspace: root });
    for (const language of ['zh-CN', 'en-US']) {
      const context = await browser.newContext({ locale: language, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); contexts.push(context);
      const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('request', r => { requests.push({ url: r.url(), data: r.url().endsWith('/api/invoke') ? r.postDataJSON() : null }); });
      const historyReads = () => requests.filter(r => r.data?.channel === 'governance.gitHistory').length;
      const before = historyReads(); await p.goto(app.url); await ready(p); assert.equal(historyReads(), before, 'History is lazy');
      await p.locator('a[href="#git-section"]').click(); await loaded(p);
      assert.equal(await p.locator('#git-history-tab').getAttribute('aria-selected'), 'true'); assert.equal(await p.locator('[data-commit]').count(), 100);
      assert.equal(await p.locator('[data-commit]').first().getAttribute('data-commit'), merge);
      assert.match(await p.locator('[data-commit]').first().textContent(), /HEAD/); assert.match(await p.locator('[data-commit]').first().textContent(), /demo-tag/);
      assert.equal(await p.locator(`path[data-child="${merge}"][data-parent="${feature}"]`).count(), 1); assert.equal(await p.locator(`path[data-child="${merge}"][data-parent="${mainParent}"]`).count(), 1);
      assert.equal(await p.locator('#git-history-canvas img, #git-history-canvas script').count(), 0); assert.match(await p.locator('#git-history-canvas').textContent(), /<img src=x/);
      await p.locator('#git-history-more').click(); await loaded(p); assert.equal(await p.locator('[data-commit]').count(), total); assert.equal(await p.locator('[data-commit]').last().getAttribute('data-commit'), initial); assert.equal(await p.locator('#git-history-more').isVisible(), false);
      const scroll = p.locator('#git-history-scroll'); await scroll.evaluate(n => { n.scrollTop = 320; }); const position = await scroll.evaluate(n => n.scrollTop);
      const selected = p.locator('[data-commit]').nth(6), selectedSha = await selected.getAttribute('data-commit'); await selected.focus(); await p.keyboard.press('Enter'); await detailed(p);
      await p.locator('#git-history-back').click(); assert.equal(await p.evaluate(() => document.activeElement.dataset.commit), selectedSha); assert.equal(await scroll.evaluate(n => n.scrollTop), position);
      await scroll.evaluate(n => { n.scrollTop = 0; }); await p.locator('[data-commit]').first().click(); await detailed(p); assert.equal(await p.locator('.history-parents [data-parent]').count(), 2); assert.match(await p.locator('.history-sha').textContent(), new RegExp(merge));
      await p.locator('[data-git-file="中文 文件.txt"]').click(); await p.waitForFunction(() => document.querySelector('#git-commit-patch').textContent.includes('feature content')); assert.equal(await p.locator('.patch-add').count() > 0, true);
      await p.locator('[data-git-file="binary.png"]').click(); await p.waitForFunction(() => /Binary|二进制/.test(document.querySelector('.history-preview').textContent)); assert.equal(await p.locator('#git-commit-patch').textContent(), '');
      await p.locator('[data-git-file=".env"]').click(); await p.waitForFunction(() => /Protected|受保护/.test(document.querySelector('.history-preview').textContent)); assert.equal(await p.locator('#git-commit-patch').textContent(), '');
      for (const width of [390, 768, 1440]) for (const theme of ['light', 'dark']) {
        await p.setViewportSize({ width, height: 1000 }); await p.emulateMedia({ colorScheme: theme }); await p.waitForFunction(theme => document.documentElement.dataset.base === theme, theme);
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await shot(p, `${language}-${width}-${theme}-detail`);
        await p.locator('#git-history-back').click(); await scroll.evaluate(n => { n.scrollTop = 0; }); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await shot(p, `${language}-${width}-${theme}-graph`);
        await p.locator('[data-commit]').first().click(); await detailed(p);
      }
      await p.setViewportSize({ width: 1440, height: 1000 });
      await context.setOffline(true); const reads = historyReads(); await p.locator('#git-history-back').click(); await p.locator('[data-commit]').first().click(); await detailed(p); assert.equal(historyReads(), reads, 'Cached detail works offline without reads'); assert.match(await p.locator('#git-history-status').textContent(), /Offline|离线/);
      await context.setOffline(false); await p.waitForFunction(() => !document.querySelector('#git-history-refresh').disabled); assert.equal(historyReads(), reads, 'Reconnect does not replay reads'); await p.locator('#git-history-back').click();
      await p.locator('#git-managed-tab').focus(); await p.keyboard.press('Enter'); assert.equal(await p.locator('#git-summary').isVisible(), true); await p.keyboard.press('ArrowLeft'); assert.equal(await p.locator('#git-history-tab').getAttribute('aria-selected'), 'true'); assert.equal(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), true);
      // A detail response arriving after Back must not reopen the secondary page.
      let release, enter, finish; const held = new Promise(r => { enter = r; }), completed = new Promise(r => { finish = r; });
      await p.route('**/api/invoke', async route => { const r = route.request().postDataJSON(); if (r.channel === 'governance.gitHistory' && r.payload.action === 'detail') { const response = await route.fetch(); enter(); await new Promise(r => { release = r; }); try { await route.fulfill({ response }); } finally { finish(); } } else await route.continue(); });
      await p.locator('[data-commit]').nth(12).click(); await held; await p.locator('#git-history-back').click(); release(); await completed; await p.unroute('**/api/invoke'); assert.equal(await p.locator('#git-history-detail').isVisible(), false);
      // Failure preserves the loaded graph, and navigation never retries it automatically.
      let failures = 0; await p.route('**/api/invoke', route => { const r = route.request().postDataJSON(); if (r.channel === 'governance.gitHistory') { failures++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Controlled history failure' }) }); } return route.continue(); });
      await p.locator('#git-history-refresh').click(); await p.waitForFunction(() => !document.querySelector('#git-history-refresh').disabled); assert.match(await p.locator('#git-history-status').textContent(), /Refresh|刷新/); assert.equal(await p.locator('[data-commit]').count(), total);
      await p.locator('a[href="#board-section"]').click(); await p.locator('a[href="#git-section"]').click(); assert.equal(failures, 1); await p.unroute('**/api/invoke');
      await p.locator('#git-history-refresh').click(); await loaded(p); assert.equal(await p.locator('[data-commit]').count(), 100);
      // Explicit workspace epoch invalidation drops cached content and rejects a foreign result.
      await p.evaluate(() => { workspaceEpoch++; snapshot = { ...snapshot, workspace: 'foreign-fixture' }; window.dispatchEvent(new Event('git-history-context')); });
      await p.waitForFunction(() => document.querySelectorAll('[data-commit]').length === 0 && document.querySelector('#git-history-view').getAttribute('aria-busy') === 'false'); assert.equal(await p.locator('#git-history-detail-content').textContent(), '');
    }
    assert.deepEqual(errors, []); assert.equal(requests.some(r => !r.url.startsWith(app.origin)), false); assert.equal(requests.some(r => r.data?.channel === 'governance.gitHistory' && !['list', 'detail', 'diff'].includes(r.data.payload.action)), false);
    assert.equal(git('rev-parse', 'HEAD'), merge); assert.equal(git('show-ref'), beforeRefs); assert.deepEqual(await fs.readFile(path.join(root, 'STATE.json')), beforeState);
    console.log(`PASS Git commit graph: real branch/merge/tag/initial/${total} commits, paging, topology edges, safe details/diffs, return scroll/focus, keyboard/tabs, offline cache/errors/no replay/late response/epoch guards; ${shots} screenshots`);
  } finally { for (const context of contexts) await context.close(); await app?.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); }
};
