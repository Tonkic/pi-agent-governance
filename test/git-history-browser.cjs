'use strict';
module.exports = async ({ browser, screenshots }) => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), { execFileSync } = require('node:child_process');
  const { Governance } = require('../build/plugin/core'), { startConsole } = require('../build/web/server');
  const root = require('node:fs').realpathSync.native(await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'git-graph-browser-')));
  const g = new Governance(root), contexts = [], errors = [], requests = []; let app, shots = 0;
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=' + path.join(root, 'disabled-hooks'), '-c', 'commit.gpgSign=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const output = path.join(screenshots, 'git-history'); await fs.mkdir(output, { recursive: true });
  const ready = p => p.waitForFunction(() => !document.querySelector('#refresh').disabled);
  const loaded = p => p.waitForFunction(() => !document.querySelector('#git-history-refresh').disabled && document.querySelectorAll('[data-commit]').length > 0 && document.querySelector('#git-history-view').getAttribute('aria-busy') === 'false');
  const detailed = p => p.waitForFunction(() => document.querySelector('#git-history-detail').open && document.querySelector('#git-commit-title') && document.querySelector('#git-history-view').getAttribute('aria-busy') === 'false');
  const closed = p => p.waitForFunction(() => !document.querySelector('#git-history-detail').open);
  const shot = async (p, name) => { if (process.env.GIT_HISTORY_SCREENSHOTS === '0') return; await p.screenshot({ path: path.join(output, name + '.png') }); shots++; };
  const geometry = async p => p.evaluate(() => {
    const canvas = document.querySelector('#git-history-canvas'), cr = canvas.getBoundingClientRect();
    return { width: cr.width, axis: Number(canvas.dataset.axis), nodes: [...canvas.querySelectorAll('[data-commit]')].map(n => { const r = n.getBoundingClientRect(); return { sha: n.dataset.commit, lane: Number(n.dataset.lane), x: r.x + r.width / 2 - cr.x, width: r.width, height: r.height, text: n.textContent }; }) };
  });
  try {
    await g.run({ action: 'init' }); git('init', '-b', 'main'); git('config', 'user.name', 'Demo author'); git('config', 'user.email', 'demo@example.invalid');
    await fs.writeFile(path.join(root, 'plain.txt'), 'before\n'); git('add', '--', 'plain.txt'); git('commit', '-m', 'Initial demo / 初始提交'); const initial = git('rev-parse', 'HEAD');
    // Actual Git demo data: 104 fast-import commits, a real branch and a two-parent merge (108 total).
    let stream = '';
    for (let i = 0; i < 104; i++) { const message = `Earlier change ${i}\n`; stream += `commit refs/heads/main\ncommitter Demo author <demo@example.invalid> ${1700000000 + i} +0000\ndata ${Buffer.byteLength(message)}\n${message}${i === 0 ? `from ${initial}\n` : ''}\n`; }
    execFileSync('git', ['fast-import', '--quiet'], { cwd: root, input: stream, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    git('checkout', '-b', 'feature/demo');
    await fs.writeFile(path.join(root, '中文 文件.txt'), 'feature content / 新增内容\n'); await fs.writeFile(path.join(root, 'binary.png'), Buffer.from([0, 1, 2, 3])); await fs.writeFile(path.join(root, '.env'), 'demo-only-value\n');
    git('add', '--', '中文 文件.txt', 'binary.png', '.env'); git('commit', '-m', 'Feature <img src=x onerror=alert(1)>'); const feature = git('rev-parse', 'HEAD');
    git('checkout', 'main'); await fs.writeFile(path.join(root, 'plain.txt'), 'after\n'); git('add', '--', 'plain.txt'); git('commit', '-m', 'Main improvement'); const mainParent = git('rev-parse', 'HEAD');
    git('merge', '--no-ff', 'feature/demo', '-m', 'Merge feature / 合并演示'); const merge = git('rev-parse', 'HEAD'); git('tag', 'demo-tag');
    const total = Number(git('rev-list', '--count', '--all')), mainline = git('rev-list', '--first-parent', 'main').split('\n'), beforeRefs = git('show-ref'), beforeState = await fs.readFile(path.join(root, 'STATE.json'));
    assert.equal(total, 108); app = await startConsole({ workspace: root });
    for (const language of ['zh-CN', 'en-US']) {
      const context = await browser.newContext({ locale: language, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); contexts.push(context);
      const p = await context.newPage(); p.setDefaultTimeout(15000); p.on('pageerror', e => errors.push(e.message)); p.on('request', r => { requests.push({ url: r.url(), data: r.url().endsWith('/api/invoke') ? r.postDataJSON() : null }); });
      const historyReads = () => requests.filter(r => r.data?.channel === 'governance.gitHistory').length;
      const before = historyReads(); await p.goto(app.url); await ready(p); assert.equal(historyReads(), before, 'History is lazy');
      await p.locator('a[href="#git-section"]').click(); await loaded(p);
      assert.equal(await p.locator('#git-managed-tab, #git-managed-view, #git-summary, #git-tasks, .history-tabs').count(), 0);
      assert.equal(await p.locator('[data-commit]').count(), 100); assert.equal(await p.locator('[data-commit]').first().getAttribute('data-commit'), merge);
      assert.equal(await p.locator('.history-endpoint').first().textContent(), 'HEADmain');
      assert.equal(await p.locator('.history-ref').count(), 2, 'Only HEAD and the actual axis tip have permanent labels');
      assert.equal(await p.locator('#git-history-legend .history-key').count(), 2);
      assert.match(await p.locator('#git-history-legend').textContent(), /main.*(?:Branches|分支)/); assert.doesNotMatch(await p.locator('#git-history-legend').textContent(), /feature\/demo|demo-tag/);
      assert.equal(await p.locator(`path[data-child="${merge}"][data-parent="${feature}"]`).count(), 1); assert.equal(await p.locator(`path[data-child="${merge}"][data-parent="${mainParent}"]`).count(), 1);
      const firstGeometry = await geometry(p);
      assert.equal(firstGeometry.axis, firstGeometry.width / 2);
      for (const n of firstGeometry.nodes) { assert.equal(n.text, '', 'Nodes have no permanent subject/SHA/author/date text'); assert.equal(n.width, 44); assert.equal(n.height, 44); if (mainline.includes(n.sha)) assert.equal(n.x, firstGeometry.axis); }
      assert.notEqual(firstGeometry.nodes.find(n => n.sha === feature).x, firstGeometry.axis);
      // All edge endpoints correspond to real parents, not ordering/date-based invented links.
      const actualEdges = git('rev-list', '--all', '--parents').split('\n').flatMap(line => { const [child, ...parents] = line.split(' '); return parents.map(parent => child + ':' + parent); });
      for (const edge of await p.locator('path[data-child]').evaluateAll(nodes => nodes.map(n => n.dataset.child + ':' + n.dataset.parent))) assert.equal(actualEdges.includes(edge), true);
      const hovered = p.locator(`[data-commit="${feature}"]`), readsBeforeHover = historyReads(); await hovered.hover();
      assert.equal(await p.locator('#git-history-tooltip').isVisible(), true); assert.equal(await hovered.getAttribute('aria-describedby'), 'git-history-tooltip');
      assert.match(await p.locator('#git-history-tooltip').textContent(), /<img src=x onerror=alert\(1\)>/); assert.match(await p.locator('#git-history-tooltip').textContent(), /Demo author/); assert.match(await p.locator('#git-history-tooltip').textContent(), /feature\/demo/);
      assert.equal(await p.locator('#git-history-tooltip img, #git-history-tooltip script').count(), 0); assert.equal(historyReads(), readsBeforeHover, 'Hover uses loaded metadata, never another invoke');
      await hovered.focus(); await p.keyboard.press('Escape'); assert.equal(await p.locator('#git-history-tooltip').isVisible(), false);
      await p.locator('#git-history-more').click(); await loaded(p); assert.equal(await p.locator('[data-commit]').count(), total); assert.equal(await p.locator('[data-commit]').last().getAttribute('data-commit'), initial); assert.equal(await p.locator('#git-history-more').isVisible(), false);
      const paged = await geometry(p); assert.equal(paged.axis, firstGeometry.axis); for (const n of paged.nodes.filter(n => mainline.includes(n.sha))) assert.equal(n.x, paged.axis);
      assert.equal(await p.locator('#git-history-legend .history-key').count(), 2, 'Pagination cannot grow the legend');
      const scroll = p.locator('#git-history-scroll'); await scroll.evaluate(n => { n.scrollTop = 320; });
      const selected = p.locator('[data-commit]').nth(6), selectedSha = await selected.getAttribute('data-commit'); await p.keyboard.press('Tab'); await selected.focus();
      assert.equal(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), true);
      const position = await scroll.evaluate(n => [n.scrollTop, n.scrollLeft]), windowPosition = await p.evaluate(() => scrollY);
      await p.keyboard.press('Enter'); await detailed(p);
      assert.equal(await p.locator('#git-history-detail').evaluate(n => n instanceof HTMLDialogElement && n.matches(':modal')), true);
      assert.equal(await p.locator('#git-history-graph-view').isVisible(), true, 'Modal does not replace or hide the graph');
      for (let i = 0; i < 8; i++) { await p.keyboard.press('Tab'); assert.equal(await p.evaluate(() => document.querySelector('#git-history-detail').contains(document.activeElement) || document.activeElement === document.body), true, 'Native modal excludes every background control (browser chrome may own focus)'); }
      await p.locator('#git-history-refresh').evaluate(n => n.focus()); assert.notEqual(await p.evaluate(() => document.activeElement.id), 'git-history-refresh', 'Native modal makes background controls inert');
      await p.keyboard.press('Escape'); await closed(p); assert.equal(await p.evaluate(() => document.activeElement.dataset.commit), selectedSha); assert.deepEqual(await scroll.evaluate(n => [n.scrollTop, n.scrollLeft]), position); assert.equal(await p.evaluate(() => scrollY), windowPosition);
      await p.keyboard.press('ArrowDown'); assert.equal(await p.evaluate(() => document.activeElement.dataset.commit), await p.locator('[data-commit]').nth(7).getAttribute('data-commit'));
      await scroll.evaluate(n => { n.scrollTop = 0; }); await p.locator('[data-commit]').first().click(); await detailed(p); assert.equal(await p.locator('.history-parents [data-parent]').count(), 2); assert.match(await p.locator('.history-sha').textContent(), new RegExp(merge));
      await p.locator('[data-git-file="中文 文件.txt"]').click(); await p.waitForFunction(() => document.querySelector('#git-commit-patch').textContent.includes('feature content')); assert.equal(await p.locator('.patch-add').count() > 0, true); assert.match(await p.locator('#git-commit-patch').textContent(), /新增内容/);
      await p.locator('[data-git-file="binary.png"]').click(); await p.waitForFunction(() => /Binary|二进制/.test(document.querySelector('.history-preview').textContent)); assert.equal(await p.locator('#git-commit-patch').textContent(), '');
      await p.locator('[data-git-file=".env"]').click(); await p.waitForFunction(() => /Protected|受保护/.test(document.querySelector('.history-preview').textContent)); assert.equal(await p.locator('#git-commit-patch').textContent(), '');
      for (const width of [390, 768, 1440]) for (const theme of ['light', 'dark']) {
        await p.setViewportSize({ width, height: 1000 }); await p.emulateMedia({ colorScheme: theme }); await p.waitForFunction(theme => document.documentElement.dataset.base === theme, theme);
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await p.locator('#git-history-detail').evaluate(n => n.scrollWidth <= n.clientWidth && n.getBoundingClientRect().left >= 0 && n.getBoundingClientRect().right <= innerWidth), true);
        assert.equal(await p.locator('#git-history-detail-content').evaluate(n => getComputedStyle(n).overflowY === 'auto'), true); await shot(p, `${language}-${width}-${theme}-detail`);
        await p.locator('#git-history-back').click(); await closed(p); await scroll.evaluate(n => { n.scrollTop = 0; }); await p.locator('#git-history-refresh').focus();
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const currentGeometry = await geometry(p); assert.equal(currentGeometry.axis, currentGeometry.width / 2); for (const n of currentGeometry.nodes.filter(n => mainline.includes(n.sha))) assert.equal(n.x, currentGeometry.axis);
        assert.equal(await p.locator('#git-history-legend .history-key').count(), 2); assert.equal(await p.locator('#git-history-legend').evaluate(n => n.getBoundingClientRect().height <= 44), true, 'Quiet legend fits one row on mobile');
        assert.equal(await p.locator('[data-commit]').first().evaluate(n => getComputedStyle(n).animationName === 'none' && getComputedStyle(n).transitionDuration === '0s'), true); await shot(p, `${language}-${width}-${theme}-graph`);
        const summaryReads = historyReads(); await p.locator('[data-commit]').first().focus();
        assert.match(await p.locator('#git-history-tooltip').textContent(), /demo-tag/, 'Hidden tags remain available on focus');
        assert.equal(await p.evaluate(() => { const tip = document.querySelector('#git-history-tooltip'), node = document.activeElement, t = tip.getBoundingClientRect(), n = node.getBoundingClientRect(); return !tip.hidden && t.left >= 0 && t.right <= innerWidth && t.top >= 0 && t.bottom <= innerHeight && (t.right <= n.left || t.left >= n.right || t.bottom <= n.top || t.top >= n.bottom); }), true, 'Tooltip stays on-screen without covering its trigger'); assert.equal(historyReads(), summaryReads);
        await p.locator('[data-commit]').first().click(); await detailed(p);
      }
      await p.setViewportSize({ width: 1440, height: 1000 }); await p.locator('#git-history-back').click(); await closed(p);
      await p.locator('[data-commit]').first().click(); await detailed(p); await p.mouse.click(2, 2); await closed(p); assert.equal(await p.evaluate(() => document.activeElement.dataset.commit), merge, 'Backdrop close restores the trigger');
      await context.setOffline(true); const reads = historyReads(); await p.locator('[data-commit]').nth(20).focus(); await p.keyboard.press('Enter'); assert.equal(await p.locator('#git-history-detail').isVisible(), false); assert.equal(historyReads(), reads); assert.equal(await p.locator('[data-commit]').nth(20).getAttribute('aria-disabled'), 'true');
      await p.locator('[data-commit]').first().click(); await detailed(p); assert.equal(historyReads(), reads, 'Cached detail works offline without reads'); assert.match(await p.locator('#git-history-status').textContent(), /Offline|离线/); assert.match(await p.locator('.history-dialog-status').textContent(), /Offline|离线/);
      await context.setOffline(false); await p.waitForFunction(() => !document.querySelector('#git-history-refresh').disabled); assert.equal(historyReads(), reads, 'Reconnect does not replay reads'); await p.locator('#git-history-back').click(); await closed(p);
      // A detail response arriving after modal close must not reopen it.
      let release, enter, finish; const held = new Promise(r => { enter = r; }), completed = new Promise(r => { finish = r; });
      await p.route('**/api/invoke', async route => { const r = route.request().postDataJSON(); if (r.channel === 'governance.gitHistory' && r.payload.action === 'detail') { const response = await route.fetch(); enter(); await new Promise(r => { release = r; }); try { await route.fulfill({ response }); } finally { finish(); } } else await route.continue(); });
      await p.locator('[data-commit]').nth(12).click(); await held; await p.keyboard.press('Escape'); await closed(p); release(); await completed; await p.unroute('**/api/invoke'); assert.equal(await p.locator('#git-history-detail').isVisible(), false);
      // Hold a patch, close, then reopen another cached detail: stale patch cannot populate it.
      let releasePatch, enterPatch, finishPatch; const patchHeld = new Promise(r => { enterPatch = r; }), patchDone = new Promise(r => { finishPatch = r; });
      await scroll.evaluate(n => { n.scrollTop = 0; }); await p.locator(`[data-commit="${feature}"]`).click(); await detailed(p);
      await p.route('**/api/invoke', async route => { const r = route.request().postDataJSON(); if (r.channel === 'governance.gitHistory' && r.payload.action === 'diff') { const response = await route.fetch(); enterPatch(); await new Promise(r => { releasePatch = r; }); try { await route.fulfill({ response }); } finally { finishPatch(); } } else await route.continue(); });
      await p.locator('[data-git-file="中文 文件.txt"]').click(); await patchHeld; await p.locator('#git-history-back').click(); await closed(p); await p.locator('[data-commit]').first().click(); await detailed(p); releasePatch(); await patchDone; await p.unroute('**/api/invoke'); assert.equal(await p.locator('#git-commit-patch').textContent(), ''); assert.equal(await p.locator('.history-sha').textContent(), merge); await p.locator('#git-history-back').click(); await closed(p);
      // Failure preserves the loaded graph, and navigation never retries automatically.
      let failures = 0; await p.route('**/api/invoke', route => { const r = route.request().postDataJSON(); if (r.channel === 'governance.gitHistory') { failures++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Controlled history failure' }) }); } return route.continue(); });
      await p.locator('#git-history-refresh').click(); await p.waitForFunction(() => !document.querySelector('#git-history-refresh').disabled); assert.match(await p.locator('#git-history-status').textContent(), /Refresh|刷新/); assert.equal(await p.locator('[data-commit]').count(), total);
      await p.locator('a[href="#board-section"]').click(); await p.locator('a[href="#git-section"]').click(); assert.equal(failures, 1); await p.unroute('**/api/invoke');
      // Explicitly exercise new metadata AND the older-reader fallback without changing the repository.
      let mode = 'metadata';
      await p.route('**/api/invoke', async route => {
        const r = route.request().postDataJSON(); if (r.channel !== 'governance.gitHistory' || r.payload.action !== 'list') return route.continue();
        const response = await route.fetch(), body = await response.json(), result = body.result;
        result.mainline = { ref: 'refs/heads/main', tip: merge, commits: mainline, truncated: false };
        if (mode === 'fallback') delete result.mainline;
        if (mode === 'master') { result.refs = result.refs.map(ref => ref.name === 'refs/heads/main' ? { ...ref, name: 'refs/heads/master' } : ref); result.mainline.ref = 'refs/heads/master'; }
        if (mode === 'head') { result.refs = result.refs.filter(ref => ref.name !== 'refs/heads/main'); result.mainline.ref = null; }
        if (mode === 'remote') { result.refs = result.refs.map(ref => ref.name === 'refs/heads/main' ? { ...ref, name: 'refs/remotes/origin/main', kind: 'remote' } : ref); result.mainline.ref = 'refs/remotes/origin/main'; }
        if (mode === 'unlabeled') result.refs = result.refs.filter(ref => ref.name !== 'refs/heads/feature/demo');
        // Controlled alternative-ref demo snapshot. Every commit and parent remains from actual Git.
        if (mode === 'both-sides') { result.refs = result.refs.map(ref => ref.name === 'refs/heads/main' ? { ...ref, sha: initial } : ref); result.mainline = { ref: 'refs/heads/main', tip: initial, commits: [initial], truncated: false }; }
        if (mode === 'crowded') result.refs.push(...Array.from({ length: 40 }, (_, i) => ({ name: `refs/heads/agent/demo-${i}`, kind: 'branch', sha: i % 2 ? feature : mainParent })));
        if (mode === 'invalid') result.mainline.commits = [merge, feature]; // Real second parent is not main's first parent.
        await route.fulfill({ response, json: body });
      });
      for (const next of ['metadata', 'fallback', 'master', 'remote', 'head', 'unlabeled', 'crowded', 'both-sides']) {
        mode = next; await p.locator('#git-history-refresh').click(); await loaded(p); assert.equal(await p.locator('[data-commit]').count(), 100);
        const shape = await geometry(p);
        if (next !== 'both-sides') for (const n of shape.nodes.filter(n => mainline.includes(n.sha))) assert.equal(n.x, shape.axis);
        if (['master', 'remote', 'head'].includes(next)) { assert.match(await p.locator('#git-history-legend').textContent(), /Fallback|后备/); assert.equal(await p.locator('#git-history-canvas').getAttribute('data-axis-ref'), next === 'master' ? 'refs/heads/master' : next === 'remote' ? 'refs/remotes/origin/main' : 'HEAD'); }
        assert.equal(await p.locator('#git-history-legend .history-key').count(), 2, 'Ref count and ancestry combinations never add legend rows');
        assert.doesNotMatch(await p.locator('#git-history-legend').textContent(), /agent\/|feature\/demo|demo-tag/);
        if (next === 'unlabeled') { await p.locator(`[data-commit="${feature}"]`).focus(); assert.match(await p.locator('#git-history-tooltip').textContent(), /Side history|侧线历史/); assert.doesNotMatch(await p.locator('#git-history-tooltip').textContent(), /feature\/demo/); }
        if (next === 'crowded') { assert.equal(await p.locator('.history-ref').count(), 2); const reads = historyReads(); await p.locator(`[data-commit="${feature}"]`).focus(); const text = await p.locator('#git-history-tooltip').textContent(); assert.match(text, /agent\/demo-1\b/); assert.match(text, /agent\/demo-39\b/); assert.equal(historyReads(), reads); }
        if (next === 'both-sides') { assert.equal(shape.nodes.some(n => n.x < shape.axis), true); assert.equal(shape.nodes.some(n => n.x > shape.axis), true); assert.notEqual(shape.nodes[0].lane, 0, 'HEAD is not falsely promoted to main'); await p.locator('#git-history-more').click(); await loaded(p); const all = await geometry(p); assert.equal(all.axis, shape.axis); assert.equal(all.nodes.find(n => n.sha === initial).x, all.axis); }
      }
      mode = 'invalid'; await p.locator('#git-history-refresh').click(); await loaded(p); assert.match(await p.locator('#git-history-status').textContent(), /Refresh|刷新/); assert.equal(await p.locator('[data-commit]').count(), total); await p.unroute('**/api/invoke');
      await p.locator('#git-history-refresh').click(); await loaded(p);
      // Project switch closes the loading modal and rejects its held old-project detail response.
      let releaseEpoch, enterEpoch, finishEpoch; const epochHeld = new Promise(r => { enterEpoch = r; }), epochDone = new Promise(r => { finishEpoch = r; });
      await p.route('**/api/invoke', async route => { const r = route.request().postDataJSON(); if (r.channel === 'governance.gitHistory' && r.payload.action === 'detail') { const response = await route.fetch(); enterEpoch(); await new Promise(r => { releaseEpoch = r; }); try { await route.fulfill({ response }); } finally { finishEpoch(); } } else await route.continue(); });
      await p.locator('[data-commit]').nth(14).click(); await epochHeld;
      await p.evaluate(() => { workspaceEpoch++; snapshot = { ...snapshot, workspace: 'foreign-fixture' }; window.dispatchEvent(new Event('git-history-context')); }); releaseEpoch(); await epochDone; await p.unroute('**/api/invoke');
      await p.waitForFunction(() => document.querySelectorAll('[data-commit]').length === 0 && document.querySelector('#git-history-view').getAttribute('aria-busy') === 'false'); assert.equal(await p.locator('#git-history-detail-content').textContent(), ''); await closed(p);
    }
    const touch = await browser.newContext({ locale: 'en-US', hasTouch: true, viewport: { width: 390, height: 844 } }); contexts.push(touch); const phone = await touch.newPage(); phone.on('pageerror', e => errors.push(e.message)); phone.on('request', r => requests.push({ url: r.url(), data: r.url().endsWith('/api/invoke') ? r.postDataJSON() : null }));
    await phone.goto(app.url); await ready(phone); await phone.locator('a[href="#git-section"]').tap(); await loaded(phone); await phone.locator('[data-commit]').first().tap(); await detailed(phone); assert.equal(await phone.locator('#git-history-tooltip').isVisible(), false); await phone.locator('#git-history-back').tap(); await closed(phone);
    assert.deepEqual(errors, []);
    assert.equal(requests.some(r => !r.url.startsWith(app.origin)), false, 'No external resources');
    assert.equal(requests.some(r => r.data?.channel === 'governance.git'), false, 'Removed managed UI never queries governance.git');
    assert.equal(requests.some(r => r.data?.channel === 'governance.gitHistory' && !['list', 'detail', 'diff'].includes(r.data.payload.action)), false, 'No Git writes');
    assert.equal(git('rev-parse', 'HEAD'), merge); assert.equal(git('show-ref'), beforeRefs); assert.deepEqual(await fs.readFile(path.join(root, 'STATE.json')), beforeState);
    console.log(`PASS Git graph: actual ${total}-commit DAG/paging, fixed centered main axis, safe zero-query tooltip, refs/ancestry, native modal/close/Escape/focus/scroll/trap, Chinese diff/binary/restricted, offline/no replay/held detail+patch/epoch guards, validated mainline + fallback; ${shots} screenshots`);
  } finally { for (const context of contexts) await context.close(); await app?.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); }
};
