'use strict';
// A read-only commit DAG. Source text never becomes HTML, selectors, URLs or Git commands.
(() => {
  const host = document.getElementById('git-section');
  const copy = {
    en: { history: 'Commit history', intro: 'Newest to oldest · real parent links · local history only', refresh: 'Refresh history', more: 'Load earlier commits', loading: 'Reading Git history…', choose: 'Select a commit to inspect its changes.', error: 'Could not read this snapshot. Refresh history before continuing.', offline: 'Offline · loaded history remains available. Reconnect and refresh for new reads.', empty: 'No commits yet', noRepo: 'This project is not a Git repository', noRepoHint: 'Open an existing local repository to explore its commits. Nothing is initialized here.', end: 'End of reachable history', earlier: 'Earlier commits have not been loaded yet', limited: 'Display limit reached · at most 5000 commits and 64 parallel lanes.', shallow: 'Shallow repository · older history may be missing.', commits: 'commits loaded', detail: 'Commit details', author: 'Author', authored: 'Authored', committed: 'Committed', parents: 'Parents', files: 'Changed files', firstParent: 'Changes relative to the first parent; renames are shown as delete/add.', rootDiff: 'Initial commit · changes relative to an empty tree.', filesLimited: 'File list is limited to 500 entries.', bodyLimited: 'Commit message was shortened.', selectFile: 'Select a file to read its patch.', binary: 'Binary file · no text preview', restricted: 'Protected path or linked object · contents are not read', tooLarge: 'Patch exceeds the preview budget (128 KiB).', truncated: 'Preview is incomplete.', noFiles: 'No file changes relative to this parent.', noWrite: 'Read-only. No checkout, merge, reset, fetch or push.', refreshHint: 'Branches or HEAD may have changed. Refresh to read a new snapshot.' },
    zh: { history: '提交历史', intro: '上新下旧 · 真实父子连线 · 仅本地历史', refresh: '刷新历史', more: '加载更早提交', loading: '正在读取 Git 历史…', choose: '选择一个提交，查看说明与文件变更。', error: '无法读取此快照，请刷新历史后重试。', offline: '离线 · 已加载历史仍可查看。恢复连接后刷新以读取新内容。', empty: '仓库还没有提交', noRepo: '此项目不是 Git 仓库', noRepoHint: '打开已有本地仓库即可查看历史；这里不会初始化仓库。', end: '已到达可达历史的起点', earlier: '还有更早的提交尚未加载', limited: '已达显示上限：最多5000提交、64条并行线。', shallow: '浅克隆仓库：更早历史可能缺失。', commits: '个已加载提交', detail: '提交详情', author: '作者', authored: '创作时间', committed: '提交时间', parents: '父提交', files: '文件变更', firstParent: '默认相对第一父提交比较；重命名以删除/新增展示。', rootDiff: '初始提交：相对空树比较。', filesLimited: '文件列表最多展示500项。', bodyLimited: '提交说明已截短。', selectFile: '选择文件以读取文本差异。', binary: '二进制文件，不提供文本预览', restricted: '受保护路径或链接对象，不读取内容', tooLarge: '差异超过预览预算（128 KiB）。', truncated: '当前预览不完整。', noFiles: '相对该父提交没有文件变化。', noWrite: '只读，不执行切换、合并、重置、拉取或推送。', refreshHint: '分支或 HEAD 可能已变化，请刷新后读取新快照。' }
  };
  const w = () => copy[locale === 'zh-CN' ? 'zh' : 'en'];
  const make = (tag: string, text = '', cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
  const button = (text: string, id: string) => { const n = make('button', text) as HTMLButtonElement; n.type = 'button'; n.id = id; return n; };
  const pane = make('div', '', 'history-pane'); pane.id = 'git-history-view';
  const toolbar = make('div', '', 'history-toolbar'), lead = make('div'), title = make('h3'), subtitle = make('p', '', 'muted'), refresh = button('', 'git-history-refresh'); lead.append(title, subtitle); toolbar.append(lead, refresh);
  const status = make('p', '', 'history-status'); status.id = 'git-history-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const graphPane = make('div'); graphPane.id = 'git-history-graph-view';
  const summary = make('div', '', 'history-summary'); summary.id = 'git-history-summary';
  const legend = make('div', '', 'history-legend'); legend.id = 'git-history-legend';
  const scroll = make('div', '', 'history-scroll'); scroll.id = 'git-history-scroll'; scroll.tabIndex = 0;
  const canvas = make('div', '', 'history-canvas'); canvas.id = 'git-history-canvas'; scroll.append(canvas);
  const tooltip = make('div', '', 'history-tooltip'); tooltip.id = 'git-history-tooltip'; tooltip.setAttribute('role', 'tooltip'); tooltip.hidden = true;
  const footer = make('div', '', 'history-footer'), ending = make('p', '', 'muted'), more = button('', 'git-history-more'); footer.append(ending, more); graphPane.append(summary, legend, scroll, footer);
  const detail = document.createElement('dialog'); detail.className = 'history-detail'; detail.id = 'git-history-detail'; detail.setAttribute('aria-labelledby', 'git-history-dialog-title');
  const heading = make('header', '', 'history-dialog-header'), dialogTitle = make('h2'); dialogTitle.id = 'git-history-dialog-title';
  const detailStatus = make('p', '', 'history-dialog-status'); detailStatus.setAttribute('role', 'status'); detailStatus.hidden = true;
  const back = button('', 'git-history-back'), detailContent = make('div', '', 'history-detail-body'); detailContent.id = 'git-history-detail-content'; heading.append(dialogTitle, back); detail.append(heading, detailStatus, detailContent);
  const safety = make('p', '', 'hint'); pane.append(toolbar, status, graphPane, safety); host.append(pane, tooltip, detail);
  const helpCopy = make('div'); helpCopy.id = 'git-history-help'; helpCopy.append(subtitle, safety); attachContextHelp(helpCopy, title, () => w().history);
  let root: string = null, epoch = -1, generation = 0, listRequest = 0, detailRequest = 0, diffRequest = 0;
  let listLoading = false, detailLoading = false, diffLoading = false, attempted = false;
  let data: any = null, commits: any[] = [], selected = '', origin = '', scrollY = 0, message = '', laneLimited = false;
  let graphPosition = [0, 0], tooltipOwner: HTMLButtonElement = null, lastWidth = 0, centered = false;
  let tooltipTimer: ReturnType<typeof setTimeout>;
  const words = () => locale === 'zh-CN' ? { close: '关闭详情', branches: '分支', fallback: '后备中轴', side: '侧线历史（无当前分支名）', branch: '分支归属', hover: '悬停或聚焦查看摘要 · 点击或 Enter 打开详情', refs: '当前引用', bounded: '主轴链达到读取上限' } : { close: 'Close details', branches: 'Branches', fallback: 'Fallback axis', side: 'Side history (no current branch name)', branch: 'Branch ancestry', hover: 'Hover or focus for summary · click or Enter for details', refs: 'Current refs', bounded: 'Axis chain reached its read limit' };
  const details = new Map<string, any>(), patches = new Map<string, any>();
  const hash = (s: unknown) => typeof s === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(s);
  const remember = (cache: Map<string, any>, key: string, value: any, max: number) => { cache.delete(key); cache.set(key, value); while (cache.size > max) cache.delete(cache.keys().next().value); };
  const commitOK = (c: any) => c && hash(c.sha) && Array.isArray(c.parents) && c.parents.length <= 64 && c.parents.every(hash) && ['subject', 'authorName', 'authorEmail', 'authoredAt', 'committedAt'].every(k => typeof c[k] === 'string' && c[k].length <= 20000);
  const active = () => location.hash === '#git-section';
  const owns = (owner: number, project: string, gen: number) => epoch === owner && workspaceEpoch === owner && root === project && generation === gen;
  const current = (owner: number, project: string, gen: number) => owns(owner, project, gen) && snapshot?.workspace === project;
  function controls() {
    back.disabled = false;
    refresh.disabled = busy || !root || !snapshot || !navigator.onLine || listLoading;
    more.disabled = refresh.disabled || !data || data.nextOffset === null || laneLimited || commits.length >= 5000;
    more.hidden = !data || data.nextOffset === null || laneLimited || commits.length >= 5000;
    status.textContent = !navigator.onLine ? w().offline : !root ? w().choose : listLoading ? w().loading : message;
    pane.setAttribute('aria-busy', String(listLoading || detailLoading || diffLoading));
    detailContent.setAttribute('aria-busy', String(detailLoading || diffLoading));
    detailStatus.textContent = !navigator.onLine ? w().offline : ''; detailStatus.hidden = navigator.onLine;
    canvas.querySelectorAll<HTMLButtonElement>('[data-commit]').forEach(n => n.setAttribute('aria-disabled', String((busy || !navigator.onLine) && !details.has(n.dataset.commit))));
    detailContent.querySelectorAll<HTMLButtonElement>('[data-git-file]').forEach(n => { n.disabled = busy || !navigator.onLine && !patches.has(`${selected}:${n.dataset.gitFile}`); });
    detailContent.querySelectorAll<HTMLButtonElement>('[data-parent]').forEach(n => { n.disabled = busy || !navigator.onLine && !details.has(n.dataset.parent); });
  }
  function hideTooltip() { clearTimeout(tooltipTimer); tooltip.hidden = true; tooltipOwner?.removeAttribute('aria-describedby'); tooltipOwner = null; }
  function leaveTooltip() { clearTimeout(tooltipTimer); tooltipTimer = setTimeout(() => { if (document.activeElement !== tooltipOwner) hideTooltip(); }, 120); }
  tooltip.addEventListener('pointerenter', () => clearTimeout(tooltipTimer)); tooltip.addEventListener('pointerleave', leaveTooltip);
  function placeTooltip() {
    if (!tooltipOwner || tooltip.hidden) return;
    const r = tooltipOwner.getBoundingClientRect(), bounds = scroll.getBoundingClientRect(), gap = 12;
    if (r.bottom < bounds.top || r.top > bounds.bottom || r.right < bounds.left || r.left > bounds.right) { hideTooltip(); return; }
    tooltip.style.maxHeight = `${Math.min(360, innerHeight - gap * 2)}px`;
    const box = tooltip.getBoundingClientRect(), right = r.right + gap, left = r.left - gap - box.width;
    const x = right + box.width <= innerWidth - gap ? right : left >= gap ? left : Math.max(gap, Math.min(innerWidth - box.width - gap, r.left));
    let y = Math.max(gap, Math.min(innerHeight - box.height - gap, r.top));
    if (x < r.right && x + box.width > r.left) {
      const below = innerHeight - r.bottom - gap * 2, above = r.top - gap * 2, useBelow = below >= Math.min(box.height, above);
      tooltip.style.maxHeight = `${Math.max(0, Math.min(360, useBelow ? below : above))}px`;
      y = useBelow ? r.bottom + gap : r.top - gap - tooltip.getBoundingClientRect().height;
    }
    tooltip.style.left = `${x}px`; tooltip.style.top = `${y}px`;
  }
  function showTooltip(node: HTMLButtonElement, c: any, membership: string, refs: any[]) {
    if (detail.open) return;
    hideTooltip(); tooltipOwner = node;
    tooltip.replaceChildren(make('strong', c.subject), make('code', c.sha), make('span', `${w().author}: ${c.authorName} <${c.authorEmail}>`), make('span', `${w().committed}: ${c.committedAt}`), make('span', `${words().refs}: ${refs.map(r => r.name).join(' · ') || '—'}`), make('span', `${words().branch}: ${membership}`));
    tooltip.hidden = false; node.setAttribute('aria-describedby', tooltip.id); placeTooltip();
  }
  function reset() {
    generation++; listRequest++; detailRequest++; diffRequest++; listLoading = detailLoading = diffLoading = attempted = false;
    hideTooltip(); if (detail.open) detail.close();
    data = null; commits = []; selected = origin = message = ''; centered = false; lastWidth = 0; details.clear(); patches.clear(); canvas.replaceChildren(); summary.replaceChildren(); legend.replaceChildren(); detailContent.replaceChildren(); ending.textContent = ''; scroll.scrollTop = scroll.scrollLeft = 0; controls();
  }
  const axisRefs = ['refs/heads/main', 'refs/heads/master', 'refs/remotes/origin/main', 'refs/remotes/origin/master'];
  const shortRef = (ref: string) => ref.replace(/^refs\/(heads|remotes|tags)\//, '');
  function mainline(result: any, loaded: any[]) {
    const chosen = axisRefs.map(name => result.refs.find(r => r.name === name)).find(Boolean), ref = chosen?.name || null, tip = chosen?.sha || result.head;
    const known = new Map(loaded.map(c => [c.sha, c])), supplied = result.mainline;
    if (supplied !== undefined) {
      if (!supplied || supplied.ref !== ref || supplied.tip !== tip || typeof supplied.truncated !== 'boolean' || !Array.isArray(supplied.commits) || supplied.commits.length > 5000 || !supplied.commits.every(hash) || new Set(supplied.commits).size !== supplied.commits.length || (tip ? supplied.commits[0] !== tip : supplied.commits.length !== 0)) throw Error('Invalid mainline');
      for (let i = 0; i < supplied.commits.length - 1; i++) { const c = known.get(supplied.commits[i]); if (c && c.parents[0] !== supplied.commits[i + 1]) throw Error('Invalid first-parent chain'); }
      const last = known.get(supplied.commits[supplied.commits.length - 1]);
      if (last?.parents.length && !supplied.truncated && !result.shallow) throw Error('Incomplete mainline');
      return { ...supplied, label: ref ? shortRef(ref) : 'HEAD' };
    }
    // Compatibility with an older reader: never guess from date, branch order or second parents.
    const chain: string[] = [], seen = new Set<string>(); let sha = tip;
    while (sha && !seen.has(sha) && chain.length < 5000) { chain.push(sha); seen.add(sha); sha = known.get(sha)?.parents[0]; }
    return { ref, tip, commits: chain, truncated: false, label: ref ? shortRef(ref) : 'HEAD' };
  }
  // Slot zero belongs exclusively to the actual first-parent chain. Pending parents own side slots.
  function layout() {
    const axis = mainline(data, commits), main = new Set<string>(axis.commits), lanes = new Map<string, number>(), nodes = [], known = new Map(commits.map(c => [c.sha, c]));
    let extent = 0;
    const free = () => { const used = new Set(lanes.values()); for (let i = 1; i <= 63; i++) { const n = Math.ceil(i / 2) * (i % 2 ? 1 : -1); if (!used.has(n)) return n; } throw Error('Lane display limit'); };
    for (let row = 0; row < commits.length; row++) {
      const c = commits[row], lane = main.has(c.sha) ? 0 : lanes.get(c.sha) ?? free(); lanes.delete(c.sha);
      for (let p = 0; p < c.parents.length; p++) { const parent = c.parents[p]; if (!main.has(parent) && !lanes.has(parent)) lanes.set(parent, p === 0 && lane !== 0 && !Array.from(lanes.values()).includes(lane) ? lane : free()); }
      extent = Math.max(extent, Math.abs(lane), ...Array.from(lanes.values()).map(Math.abs)); nodes.push({ commit: c, row, lane });
    }
    const memberships = new Map<string, Set<string>>();
    for (const ref of data.refs.filter(r => r.kind !== 'tag' && r.name !== axis.ref)) {
      const stack = [ref.sha], seen = new Set<string>();
      while (stack.length) { const sha = stack.pop(); if (seen.has(sha) || main.has(sha)) continue; seen.add(sha); const c = known.get(sha); if (!c) continue; if (!memberships.has(sha)) memberships.set(sha, new Set()); memberships.get(sha).add(shortRef(ref.name)); stack.push(...c.parents); }
    }
    return { nodes, pending: lanes, extent, axis, main, memberships };
  }
  const laneColor = (lane: number) => lane === 0 ? 0 : 1 + ((Math.abs(lane) * 2 - (lane > 0 ? 2 : 1)) % 5);
  function renderGraph() {
    hideTooltip(); const remembered = [scroll.scrollTop, scroll.scrollLeft], oldWidth = lastWidth; canvas.replaceChildren(); summary.replaceChildren(); legend.replaceChildren(); laneLimited = false;
    if (!data) return;
    summary.append(make('span', `${commits.length} ${w().commits}`, 'badge'), make('span', words().hover));
    if (data.shallow) summary.append(make('span', w().shallow, 'history-warning'));
    if (!commits.length) { canvas.style.minWidth = ''; canvas.append(make('div', data.status === 'not-repository' ? w().noRepo : w().empty, 'history-empty'), make('p', w().noRepoHint, 'muted')); ending.textContent = ''; controls(); return; }
    let result: ReturnType<typeof layout>;
    try { result = layout(); } catch { laneLimited = true; canvas.append(make('p', w().limited, 'hint')); controls(); return; }
    const { nodes, pending, extent, axis, main, memberships } = result, step = 64;
    canvas.style.minWidth = `${Math.max(640, (extent * step + 280) * 2)}px`;
    const graphWidth = canvas.clientWidth, center = graphWidth / 2; lastWidth = graphWidth; canvas.dataset.axis = String(center); canvas.dataset.axisRef = axis.ref || 'HEAD';
    const key = (text: string, color: number) => { const n = make('span', text, `history-key history-lane-${color}`); legend.append(n); };
    key(`${axis.label}${axis.ref !== 'refs/heads/main' ? ' · ' + words().fallback : ''}`, 0);
    const branches = make('span', words().branches, 'history-key history-branch-key');
    const swatch = make('span', '', 'history-branch-swatch'); swatch.setAttribute('aria-hidden', 'true');
    for (let color = 1; color <= 5; color++) swatch.append(make('i', '', `history-lane-${color}`));
    branches.prepend(swatch); legend.append(branches);
    if (axis.truncated) summary.append(make('span', words().bounded, 'history-warning'));
    const rows = make('ol', '', 'history-rows'), entries = [];
    for (const n of nodes) {
      const c = n.commit, li = make('li'), node = button('', ''), color = laneColor(n.lane), membership = main.has(c.sha) ? axis.label : Array.from(memberships.get(c.sha) || []).join(' · ') || words().side;
      const refs = data.refs.filter(r => r.sha === c.sha), identities = c.sha === data.head ? [{ name: 'HEAD', kind: 'head' }, ...refs] : refs;
      li.style.gridTemplateColumns = `${center + n.lane * step - 22}px 44px minmax(0, 1fr)`;
      node.className = `history-commit history-lane-${color}`; node.dataset.commit = c.sha; node.dataset.lane = String(n.lane); node.setAttribute('aria-label', `${w().detail}: ${c.sha} · ${c.subject}`); node.setAttribute('aria-haspopup', 'dialog'); node.setAttribute('aria-pressed', String(selected === c.sha));
      const dot = make('span', '', `history-dot${c.parents.length > 1 ? ' is-merge' : ''}${c.sha === data.head ? ' is-head' : ''}`); dot.setAttribute('aria-hidden', 'true'); node.append(dot);
      node.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') showTooltip(node, c, membership, identities); }); node.addEventListener('pointerleave', leaveTooltip);
      node.addEventListener('focus', () => showTooltip(node, c, membership, identities)); node.addEventListener('blur', hideTooltip); node.addEventListener('click', () => { void openCommit(c.sha); });
      node.addEventListener('keydown', e => { const next = e.key === 'ArrowDown' ? n.row + 1 : e.key === 'ArrowUp' ? n.row - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? nodes.length - 1 : -1; if (next >= 0 && next < nodes.length) { e.preventDefault(); rows.querySelectorAll<HTMLButtonElement>('[data-commit]')[next].focus(); } });
      const labels = make('div', '', 'history-endpoint'); for (const ref of identities.filter(r => r.kind === 'head' || r.name === axis.ref)) labels.append(make('span', ref.name === 'HEAD' ? 'HEAD' : shortRef(ref.name), `history-ref history-lane-${color}${ref.kind === 'head' ? ' history-head' : ''}`));
      li.append(node, labels); rows.append(li); entries.push({ ...n, li });
    }
    canvas.append(rows);
    const positions = new Map(entries.map(n => [n.commit.sha, { ...n, y: n.li.offsetTop + n.li.offsetHeight / 2 }]));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('history-lines'); svg.setAttribute('width', String(graphWidth)); svg.setAttribute('height', String(rows.offsetHeight)); svg.setAttribute('aria-hidden', 'true');
    for (const n of positions.values()) for (const parent of n.commit.parents) {
      const target = positions.get(parent), column = target?.lane ?? (main.has(parent) ? 0 : pending.get(parent)); if (column === undefined || target && target.row <= n.row) continue;
      const x = center + n.lane * step, y = n.y, px = center + column * step, py = target ? target.y : rows.offsetHeight;
      const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', x === px ? `M${x},${y} V${py}` : `M${x},${y} C${x},${y + 24} ${px},${y + 24} ${px},${Math.min(y + 48, py)} V${py}`); path.setAttribute('class', `history-edge history-lane-${laneColor(n.lane === 0 && column !== 0 ? column : n.lane)}`); path.setAttribute('data-child', n.commit.sha); path.setAttribute('data-parent', parent); if (!target) path.setAttribute('stroke-dasharray', '4 4'); svg.append(path);
    }
    canvas.prepend(svg); ending.textContent = data.limited || commits.length >= 5000 ? w().limited : data.nextOffset !== null ? w().earlier : data.shallow ? w().shallow : w().end;
    scroll.scrollTop = remembered[0]; scroll.scrollLeft = centered ? remembered[1] + (graphWidth - oldWidth) / 2 : (graphWidth - scroll.clientWidth) / 2; centered = true; controls();
  }
  async function load(append = false) {
    if (!root || !snapshot || busy || !navigator.onLine || listLoading || append && commits.length >= 5000) return;
    const owner = epoch, project = root, gen = generation, request = ++listRequest;
    attempted = listLoading = true; message = ''; controls();
    try {
      const offset = append ? data?.nextOffset : 0; if (offset === null || offset === undefined) return;
      const result: any = await invoke('governance.gitHistory', { action: 'list', offset, limit: 100, ...(append ? { revision: data.revision } : {}) });
      if (!current(owner, project, gen) || request !== listRequest) return;
      if (result.workspace !== project || !['ready', 'empty', 'not-repository'].includes(result.status) || typeof result.revision !== 'string' || !Array.isArray(result.commits) || result.commits.length > 200 || !result.commits.every(commitOK) || !Array.isArray(result.refs) || result.refs.length > 512 || result.refs.some(r => !hash(r.sha) || typeof r.name !== 'string' || r.name.length > 2048 || !['branch', 'remote', 'tag'].includes(r.kind)) || result.offset !== offset || result.nextOffset !== null && (!Number.isInteger(result.nextOffset) || result.nextOffset !== offset + result.commits.length || result.nextOffset <= offset || result.nextOffset > 5000)) throw Error('Invalid history response');
      if (result.head !== null && !hash(result.head)) throw Error('Invalid HEAD');
      if (append && result.revision !== data.revision) throw Error('History changed');
      const combined = append ? commits.concat(result.commits) : result.commits;
      if (combined.length > 5000 || new Set(combined.map(c => c.sha)).size !== combined.length) throw Error('History budget');
      const order = new Map(combined.map((c, index) => [c.sha, index]));
      if (combined.some((c, index) => c.parents.some(parent => order.has(parent) && order.get(parent) <= index))) throw Error('Invalid topological order');
      mainline(result, combined);
      if (!append) { detailRequest++; diffRequest++; details.clear(); patches.clear(); selected = origin = ''; if (detail.open) detail.close(); detailContent.replaceChildren(); }
      data = result; commits = combined; renderGraph();
    } catch { if (current(owner, project, gen) && request === listRequest) message = `${w().error} ${w().refreshHint}`; }
    finally { if (owns(owner, project, gen) && request === listRequest) { listLoading = false; controls(); } }
  }
  function metaRow(label: string, value: string, target: HTMLElement) { const row = make('div'); row.append(make('dt', label), make('dd', value)); target.append(row); }
  function renderDetail(c: any) {
    detailContent.replaceChildren(); const h = make('h3', c.subject || c.sha.slice(0, 8)); h.tabIndex = -1; h.id = 'git-commit-title'; detailContent.append(h, make('code', c.sha, 'history-sha'));
    const meta = make('dl', '', 'history-detail-meta'); metaRow(w().author, `${c.authorName} <${c.authorEmail}>`, meta); metaRow(w().authored, c.authoredAt, meta); metaRow(w().committed, c.committedAt, meta); detailContent.append(meta);
    const parents = make('div', '', 'history-parents'); parents.append(make('span', w().parents));
    for (const parent of c.parents) { const link = button(parent.slice(0, 8), ''); link.dataset.parent = parent; link.addEventListener('click', () => { void openCommit(parent); }); parents.append(link); }
    detailContent.append(parents, make('pre', c.body, 'history-message')); if (c.bodyTruncated) detailContent.append(make('p', w().bodyLimited, 'hint'));
    detailContent.append(make('p', c.comparisonParent ? `${w().firstParent} ${c.comparisonParent.slice(0, 8)}` : w().rootDiff, 'muted'));
    const changes = make('div', '', 'history-changes'), filePane = make('section', '', 'history-files'), fileList = make('div'); fileList.id = 'git-commit-files';
    filePane.append(make('h4', `${w().files} · ${c.files.length}`), fileList);
    const preview = make('section', '', 'history-preview'), patchTitle = make('h4', w().selectFile), patchStatus = make('p', '', 'muted'), patch = make('pre', '', 'history-patch'); patch.id = 'git-commit-patch'; patch.tabIndex = 0; patchStatus.setAttribute('role', 'status'); preview.append(patchTitle, patchStatus, patch);
    for (const file of c.files) {
      const row = button('', ''); row.className = 'history-file'; row.dataset.gitFile = file.path;
      row.append(make('span', file.status, 'history-file-status'), make('span', file.path, 'history-file-path'), make('small', file.binary ? w().binary : `+${file.additions ?? '—'} −${file.deletions ?? '—'}`));
      row.addEventListener('click', () => { fileList.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === row))); void showPatch(c.sha, file.path, patchTitle, patchStatus, patch); }); fileList.append(row);
    }
    if (!c.files.length) fileList.append(make('p', w().noFiles)); if (c.filesTruncated) filePane.append(make('p', w().filesLimited, 'hint'));
    changes.append(filePane, preview); detailContent.append(changes); if (active()) h.focus({ preventScroll: true });
  }
  async function openCommit(sha: string) {
    if (!data || !hash(sha)) return;
    const cached = details.get(sha); if (!cached && (!navigator.onLine || busy)) return;
    canvas.querySelectorAll<HTMLButtonElement>('[data-commit]').forEach(n => n.setAttribute('aria-pressed', String(n.dataset.commit === sha)));
    if (!detail.open) { origin = sha; scrollY = window.scrollY; graphPosition = [scroll.scrollTop, scroll.scrollLeft]; }
    selected = sha; diffRequest++; diffLoading = false; const request = ++detailRequest;
    const owner = epoch, project = root, gen = generation, revision = data.revision;
    hideTooltip(); detailLoading = true; detailContent.replaceChildren(make('p', w().loading)); message = ''; if (!detail.open) { detail.showModal(); back.focus({ preventScroll: true }); } detailContent.scrollTop = 0; controls();
    try {
      const result: any = cached || await invoke('governance.gitHistory', { action: 'detail', sha, revision });
      if (!current(owner, project, gen) || request !== detailRequest || !detail.open || data.revision !== revision) return;
      const c = result.commit;
      if (result.workspace !== project || result.revision !== revision || !commitOK(c) || c.sha !== sha || typeof c.body !== 'string' || c.body.length > 32768 || !Array.isArray(c.files) || c.files.length > 500 || c.files.some(f => typeof f.path !== 'string' || f.path.length > 4096 || typeof f.status !== 'string')) throw Error('Invalid commit response');
      remember(details, sha, result, 16); renderDetail(c);
    } catch { if (current(owner, project, gen) && request === detailRequest && detail.open) { detailContent.replaceChildren(make('p', w().error, 'hint')); message = w().refreshHint; } }
    finally { if (owns(owner, project, gen) && request === detailRequest) { detailLoading = false; controls(); } }
  }
  async function showPatch(sha: string, file: string, titleNode: HTMLElement, notice: HTMLElement, pre: HTMLElement) {
    const key = `${sha}:${file}`, cached = patches.get(key); if (!cached && (!navigator.onLine || busy)) { notice.textContent = !navigator.onLine ? w().offline : w().loading; return; }
    const request = ++diffRequest, owner = epoch, project = root, gen = generation, revision = data.revision;
    titleNode.textContent = file; notice.textContent = w().loading; pre.replaceChildren(); diffLoading = true; controls();
    try {
      const r: any = cached || await invoke('governance.gitHistory', { action: 'diff', sha, path: file, revision });
      if (!current(owner, project, gen) || request !== diffRequest || !detail.open || selected !== sha || data.revision !== revision) return;
      if (r.workspace !== project || r.revision !== revision || r.sha !== sha || r.path !== file || !['text', 'binary', 'restricted', 'too-large'].includes(r.kind) || typeof r.patch !== 'string' || r.patch.length > 131072) throw Error('Invalid patch');
      remember(patches, key, r, 8); notice.textContent = r.kind === 'text' ? r.truncated ? w().truncated : '' : w()[r.kind === 'too-large' ? 'tooLarge' : r.kind];
      const lines = r.patch ? r.patch.split('\n') : [];
      if (lines.length > 4000) pre.textContent = r.patch;
      else for (const line of lines) pre.append(make('span', line + '\n', line.startsWith('+') && !line.startsWith('+++') ? 'patch-add' : line.startsWith('-') && !line.startsWith('---') ? 'patch-delete' : line.startsWith('@@') ? 'patch-hunk' : ''));
    } catch { if (current(owner, project, gen) && request === diffRequest && selected === sha) notice.textContent = w().error; }
    finally { if (owns(owner, project, gen) && request === diffRequest) { diffLoading = false; controls(); } }
  }
  function goBack() {
    detailRequest++; diffRequest++; detailLoading = diffLoading = false; if (detail.open) detail.close(); detailContent.replaceChildren(); controls();
    const target = Array.from(canvas.querySelectorAll<HTMLButtonElement>('[data-commit]')).find(n => n.dataset.commit === origin); target?.focus({ preventScroll: true }); scroll.scrollTop = graphPosition[0]; scroll.scrollLeft = graphPosition[1]; window.scrollTo({ top: scrollY, behavior: 'instant' });
  }
  back.addEventListener('click', goBack); detail.addEventListener('cancel', e => { e.preventDefault(); goBack(); });
  let backdrop = false;
  const outside = (e: PointerEvent) => { const r = detail.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
  detail.addEventListener('pointerdown', e => { backdrop = e.target === detail && outside(e); });
  detail.addEventListener('pointerup', e => { if (backdrop && e.target === detail && outside(e)) goBack(); backdrop = false; });
  pane.addEventListener('keydown', e => { if (e.key === 'Escape') hideTooltip(); });
  const scrollTooltip = () => { if (tooltipOwner === document.activeElement) placeTooltip(); else hideTooltip(); };
  scroll.addEventListener('scroll', scrollTooltip, { passive: true }); window.addEventListener('scroll', scrollTooltip, { passive: true }); window.addEventListener('resize', hideTooltip);
  new ResizeObserver(() => { if (data && commits.length && canvas.clientWidth !== lastWidth && active()) renderGraph(); }).observe(scroll);
  refresh.addEventListener('click', () => { void load(); }); more.addEventListener('click', () => { void load(true); });
  function context() {
    if (epoch !== workspaceEpoch || snapshot?.workspace && snapshot.workspace !== root) { reset(); epoch = workspaceEpoch; root = snapshot?.workspace || null; }
    if (!root && snapshot?.workspace) { root = snapshot.workspace; epoch = workspaceEpoch; }
    if (!active()) { hideTooltip(); if (detail.open) goBack(); }
    controls(); if (active() && root && !attempted && !busy && navigator.onLine) void load();
  }
  function localize() { title.textContent = w().history; subtitle.textContent = w().intro; refresh.textContent = w().refresh; more.textContent = w().more; dialogTitle.textContent = w().detail; back.textContent = words().close; safety.textContent = w().noWrite; scroll.setAttribute('aria-label', w().history); controls(); }
  window.addEventListener('hashchange', context); window.addEventListener('git-history-context', context); window.addEventListener('git-history-reset', () => { reset(); });
  window.addEventListener('offline', () => { listRequest++; detailRequest++; diffRequest++; listLoading = detailLoading = diffLoading = false; if (detail.open && !detailContent.querySelector('#git-commit-title')) detailContent.replaceChildren(make('p', w().offline, 'hint')); controls(); });
  window.addEventListener('online', controls); window.addEventListener('pagehide', () => { reset(); root = null; }); window.addEventListener('pageshow', context);
  localize(); void localeReady.then(() => { localize(); context(); });
})();
