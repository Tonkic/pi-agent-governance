'use strict';
// A read-only commit DAG. Source text never becomes HTML, selectors, URLs or Git commands.
(() => {
    const host = document.getElementById('git-section');
    const copy = {
        en: { history: 'Commit history', managed: 'Managed workspaces', title: 'Every change, connected.', intro: 'Newest to oldest · real parent links · local history only', refresh: 'Refresh history', more: 'Load earlier commits', back: 'Back to commit graph', loading: 'Reading Git history…', choose: 'Select a commit to inspect its changes.', error: 'Could not read this snapshot. Refresh history before continuing.', offline: 'Offline · loaded history remains available. Reconnect and refresh for new reads.', empty: 'No commits yet', noRepo: 'This project is not a Git repository', noRepoHint: 'Open an existing local repository to explore its commits. Nothing is initialized here.', end: 'End of reachable history', earlier: 'Earlier commits have not been loaded yet', limited: 'Display limit reached · at most 5000 commits and 64 parallel lanes.', shallow: 'Shallow repository · older history may be missing.', root: 'Root', merge: 'Merge', detached: 'Detached HEAD', commits: 'commits loaded', detail: 'Commit details', author: 'Author', authored: 'Authored', committed: 'Committed', parents: 'Parents', files: 'Changed files', firstParent: 'Changes relative to the first parent; renames are shown as delete/add.', rootDiff: 'Initial commit · changes relative to an empty tree.', filesLimited: 'File list is limited to 500 entries.', bodyLimited: 'Commit message was shortened.', selectFile: 'Select a file to read its patch.', binary: 'Binary file · no text preview', restricted: 'Protected path or linked object · contents are not read', tooLarge: 'Patch exceeds the preview budget (128 KiB).', truncated: 'Preview is incomplete.', noFiles: 'No file changes relative to this parent.', noWrite: 'Read-only. No checkout, merge, reset, fetch or push.', snapshot: 'Loaded repository snapshot', refreshHint: 'Branches or HEAD may have changed. Refresh to read a new snapshot.' },
        zh: { history: '提交历史', managed: '受管工作区', title: '每次变更，都有来路。', intro: '上新下旧 · 真实父子连线 · 仅本地历史', refresh: '刷新历史', more: '加载更早提交', back: '返回提交图', loading: '正在读取 Git 历史…', choose: '选择一个提交，查看说明与文件变更。', error: '无法读取此快照，请刷新历史后重试。', offline: '离线 · 已加载历史仍可查看。恢复连接后刷新以读取新内容。', empty: '仓库还没有提交', noRepo: '此项目不是 Git 仓库', noRepoHint: '打开已有本地仓库即可查看历史；这里不会初始化仓库。', end: '已到达可达历史的起点', earlier: '还有更早的提交尚未加载', limited: '已达显示上限：最多5000提交、64条并行线。', shallow: '浅克隆仓库：更早历史可能缺失。', root: '起点', merge: '合并', detached: '分离的 HEAD', commits: '个已加载提交', detail: '提交详情', author: '作者', authored: '创作时间', committed: '提交时间', parents: '父提交', files: '文件变更', firstParent: '默认相对第一父提交比较；重命名以删除/新增展示。', rootDiff: '初始提交：相对空树比较。', filesLimited: '文件列表最多展示500项。', bodyLimited: '提交说明已截短。', selectFile: '选择文件以读取文本差异。', binary: '二进制文件，不提供文本预览', restricted: '受保护路径或链接对象，不读取内容', tooLarge: '差异超过预览预算（128 KiB）。', truncated: '当前预览不完整。', noFiles: '相对该父提交没有文件变化。', noWrite: '只读，不执行切换、合并、重置、拉取或推送。', snapshot: '已加载仓库快照', refreshHint: '分支或 HEAD 可能已变化，请刷新后读取新快照。' }
    };
    const w = () => copy[locale === 'zh-CN' ? 'zh' : 'en'];
    const make = (tag, text = '', cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
    const button = (text, id) => { const n = make('button', text); n.type = 'button'; n.id = id; return n; };
    const tabs = make('div', '', 'history-tabs');
    tabs.setAttribute('role', 'tablist');
    const historyTab = button('', 'git-history-tab'), managedTab = button('', 'git-managed-tab');
    historyTab.setAttribute('role', 'tab');
    managedTab.setAttribute('role', 'tab');
    tabs.append(historyTab, managedTab);
    const managed = make('div');
    managed.id = 'git-managed-view';
    managed.setAttribute('role', 'tabpanel');
    managed.setAttribute('aria-labelledby', managedTab.id);
    managed.hidden = true;
    managed.append(host.querySelector('.git-summary-row'), document.getElementById('git-tasks'));
    const pane = make('div', '', 'history-pane');
    pane.id = 'git-history-view';
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', historyTab.id);
    historyTab.setAttribute('aria-controls', pane.id);
    managedTab.setAttribute('aria-controls', managed.id);
    const toolbar = make('div', '', 'history-toolbar'), lead = make('div'), title = make('h3'), subtitle = make('p', '', 'muted'), refresh = button('', 'git-history-refresh');
    lead.append(title, subtitle);
    toolbar.append(lead, refresh);
    const status = make('p', '', 'history-status');
    status.id = 'git-history-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const graphPane = make('div');
    graphPane.id = 'git-history-graph-view';
    const summary = make('div', '', 'history-summary');
    summary.id = 'git-history-summary';
    const scroll = make('div', '', 'history-scroll');
    scroll.id = 'git-history-scroll';
    scroll.tabIndex = 0;
    const canvas = make('div', '', 'history-canvas');
    canvas.id = 'git-history-canvas';
    scroll.append(canvas);
    const footer = make('div', '', 'history-footer'), ending = make('p', '', 'muted'), more = button('', 'git-history-more');
    footer.append(ending, more);
    graphPane.append(summary, scroll, footer);
    const detail = make('section', '', 'history-detail');
    detail.id = 'git-history-detail';
    detail.hidden = true;
    const back = button('', 'git-history-back'), detailContent = make('div');
    detailContent.id = 'git-history-detail-content';
    detail.append(back, detailContent);
    const safety = make('p', '', 'hint');
    pane.append(toolbar, status, graphPane, detail, safety);
    host.append(tabs, pane, managed);
    let root = null, epoch = -1, generation = 0, listRequest = 0, detailRequest = 0, diffRequest = 0;
    let listLoading = false, detailLoading = false, diffLoading = false, attempted = false, tab = 'history';
    let data = null, commits = [], selected = '', origin = '', scrollY = 0, message = '', laneLimited = false;
    const details = new Map(), patches = new Map();
    const hash = (s) => typeof s === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(s);
    const remember = (cache, key, value, max) => { cache.delete(key); cache.set(key, value); while (cache.size > max)
        cache.delete(cache.keys().next().value); };
    const commitOK = (c) => c && hash(c.sha) && Array.isArray(c.parents) && c.parents.length <= 64 && c.parents.every(hash) && ['subject', 'authorName', 'authorEmail', 'authoredAt', 'committedAt'].every(k => typeof c[k] === 'string' && c[k].length <= 20000);
    const active = () => location.hash === '#git-section' && tab === 'history';
    const owns = (owner, project, gen) => epoch === owner && workspaceEpoch === owner && root === project && generation === gen;
    const current = (owner, project, gen) => owns(owner, project, gen) && snapshot?.workspace === project;
    function controls() {
        historyTab.disabled = managedTab.disabled = back.disabled = false;
        refresh.disabled = busy || !root || !snapshot || !navigator.onLine || listLoading;
        more.disabled = refresh.disabled || !data || data.nextOffset === null || laneLimited || commits.length >= 5000;
        more.hidden = !data || data.nextOffset === null || laneLimited || commits.length >= 5000;
        status.textContent = !navigator.onLine ? w().offline : !root ? w().choose : listLoading ? w().loading : message;
        pane.setAttribute('aria-busy', String(listLoading || detailLoading || diffLoading));
    }
    function switchTab(next) {
        tab = next;
        pane.hidden = next !== 'history';
        managed.hidden = next !== 'managed';
        historyTab.setAttribute('aria-selected', String(next === 'history'));
        managedTab.setAttribute('aria-selected', String(next === 'managed'));
        historyTab.tabIndex = next === 'history' ? 0 : -1;
        managedTab.tabIndex = next === 'managed' ? 0 : -1;
        context();
    }
    historyTab.addEventListener('click', () => switchTab('history'));
    managedTab.addEventListener('click', () => switchTab('managed'));
    tabs.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 'history' : event.key === 'End' ? 'managed' : tab === 'history' ? 'managed' : 'history';
        switchTab(next);
        (next === 'history' ? historyTab : managedTab).focus();
    } });
    function reset() {
        generation++;
        listRequest++;
        detailRequest++;
        diffRequest++;
        listLoading = detailLoading = diffLoading = attempted = false;
        data = null;
        commits = [];
        selected = origin = message = '';
        details.clear();
        patches.clear();
        canvas.replaceChildren();
        summary.replaceChildren();
        detailContent.replaceChildren();
        detail.hidden = true;
        graphPane.hidden = false;
        ending.textContent = '';
        scroll.scrollTop = scroll.scrollLeft = 0;
        controls();
    }
    // Slots are owned by a pending parent until that commit is visited. Edges are never inferred from dates.
    function layout() {
        const lanes = [], nodes = [], pending = new Map();
        let width = 1;
        const slot = () => { const free = lanes.indexOf(null); return free < 0 ? lanes.length : free; };
        for (let row = 0; row < commits.length; row++) {
            const c = commits[row];
            let lane = lanes.indexOf(c.sha);
            if (lane < 0) {
                lane = slot();
                lanes[lane] = c.sha;
            }
            lanes[lane] = null;
            pending.delete(c.sha);
            for (let p = 0; p < c.parents.length; p++) {
                const parent = c.parents[p];
                if (!lanes.includes(parent)) {
                    const at = p === 0 && lanes[lane] === null ? lane : slot();
                    lanes[at] = parent;
                    pending.set(parent, at);
                }
            }
            width = Math.max(width, lanes.length, lane + 1);
            nodes.push({ commit: c, row, lane });
            if (width > 64)
                throw Error('Lane display limit');
        }
        return { nodes, pending, width };
    }
    function renderGraph() {
        const remembered = [scroll.scrollTop, scroll.scrollLeft];
        canvas.replaceChildren();
        summary.replaceChildren();
        laneLimited = false;
        if (!data)
            return;
        const count = make('span', `${commits.length} ${w().commits}`, 'badge');
        summary.append(count);
        if (data.head)
            summary.append(make('code', `HEAD ${data.head.slice(0, 8)}`));
        summary.append(make('span', data.branch || (data.head ? w().detached : '')));
        if (data.shallow)
            summary.append(make('span', w().shallow, 'history-warning'));
        if (!commits.length) {
            canvas.append(make('div', data.status === 'not-repository' ? w().noRepo : w().empty, 'history-empty'), make('p', w().noRepoHint, 'muted'));
            ending.textContent = '';
            controls();
            return;
        }
        let result;
        try {
            result = layout();
        }
        catch {
            laneLimited = true;
            canvas.append(make('p', w().limited, 'hint'));
            controls();
            return;
        }
        const { nodes, pending, width } = result, step = 24, rowHeight = 72, inset = 20, graphWidth = inset * 2 + width * step;
        const positions = new Map(nodes.map(n => [n.commit.sha, n]));
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('history-lines');
        svg.setAttribute('width', String(graphWidth));
        svg.setAttribute('height', String(commits.length * rowHeight));
        svg.setAttribute('aria-hidden', 'true');
        const element = (name, attrs) => { const n = document.createElementNS('http://www.w3.org/2000/svg', name); for (const [k, v] of Object.entries(attrs))
            n.setAttribute(k, v); return n; };
        for (const n of nodes)
            for (const parent of n.commit.parents) {
                const target = positions.get(parent), column = target?.lane ?? pending.get(parent);
                if (column === undefined)
                    continue;
                const x = inset + n.lane * step, y = n.row * rowHeight + 36, px = inset + column * step, py = target ? target.row * rowHeight + 36 : commits.length * rowHeight;
                if (target && target.row <= n.row)
                    throw Error('Invalid topological order');
                const path = element('path', { d: x === px ? `M${x},${y} V${py}` : `M${x},${y} C${x},${y + 24} ${px},${y + 24} ${px},${y + 40} V${py}`, class: `history-edge history-lane-${column % 6}`, 'data-child': n.commit.sha, 'data-parent': parent });
                if (!target)
                    path.setAttribute('stroke-dasharray', '4 4');
                svg.append(path);
            }
        const rows = make('ol', '', 'history-rows');
        for (const n of nodes) {
            const c = n.commit, li = make('li'), row = button('', '');
            row.className = 'history-commit';
            row.dataset.commit = c.sha;
            row.setAttribute('aria-pressed', String(selected === c.sha));
            row.style.paddingLeft = `${graphWidth + 12}px`;
            const top = make('span', '', 'history-row-top');
            top.append(make('strong', c.subject || c.sha.slice(0, 8)));
            if (c.sha === data.head)
                top.append(make('span', 'HEAD', 'history-ref history-head'));
            for (const ref of data.refs.filter(r => r.sha === c.sha))
                top.append(make('span', ref.name, `history-ref history-ref-${ref.kind}`));
            if (c.parents.length > 1)
                top.append(make('span', `${w().merge} · ${c.parents.length}`, 'history-ref'));
            if (!c.parents.length && !data.shallow)
                top.append(make('span', w().root, 'history-ref'));
            const meta = make('span', '', 'history-row-meta');
            meta.append(make('code', c.sha.slice(0, 8)), make('span', c.authorName), make('time', c.committedAt));
            row.append(top, meta);
            row.addEventListener('click', () => { void openCommit(c.sha); });
            li.append(row);
            rows.append(li);
            svg.append(element('circle', { cx: String(inset + n.lane * step), cy: String(n.row * rowHeight + 36), r: c.parents.length > 1 ? '6' : '4.5', class: `history-node history-lane-${n.lane % 6}${c.sha === data.head ? ' is-head' : ''}` }));
        }
        canvas.style.minWidth = `${Math.max(560, graphWidth + 380)}px`;
        canvas.append(svg, rows);
        ending.textContent = data.limited || commits.length >= 5000 ? w().limited : data.nextOffset !== null ? w().earlier : data.shallow ? w().shallow : w().end;
        scroll.scrollTop = remembered[0];
        scroll.scrollLeft = remembered[1];
        controls();
    }
    async function load(append = false) {
        if (!root || !snapshot || busy || !navigator.onLine || listLoading || append && commits.length >= 5000)
            return;
        const owner = epoch, project = root, gen = generation, request = ++listRequest;
        attempted = listLoading = true;
        message = '';
        controls();
        try {
            const offset = append ? data?.nextOffset : 0;
            if (offset === null || offset === undefined)
                return;
            const result = await invoke('governance.gitHistory', { action: 'list', offset, limit: 100, ...(append ? { revision: data.revision } : {}) });
            if (!current(owner, project, gen) || request !== listRequest)
                return;
            if (result.workspace !== project || !['ready', 'empty', 'not-repository'].includes(result.status) || typeof result.revision !== 'string' || !Array.isArray(result.commits) || result.commits.length > 200 || !result.commits.every(commitOK) || !Array.isArray(result.refs) || result.refs.length > 512 || result.refs.some(r => !hash(r.sha) || typeof r.name !== 'string' || r.name.length > 2048 || !['branch', 'remote', 'tag'].includes(r.kind)) || result.offset !== offset || result.nextOffset !== null && (!Number.isInteger(result.nextOffset) || result.nextOffset !== offset + result.commits.length || result.nextOffset <= offset || result.nextOffset > 5000))
                throw Error('Invalid history response');
            if (append && result.revision !== data.revision)
                throw Error('History changed');
            const combined = append ? commits.concat(result.commits) : result.commits;
            if (combined.length > 5000 || new Set(combined.map(c => c.sha)).size !== combined.length)
                throw Error('History budget');
            if (!append) {
                detailRequest++;
                diffRequest++;
                details.clear();
                patches.clear();
                selected = origin = '';
                graphPane.hidden = false;
                detail.hidden = true;
                detailContent.replaceChildren();
            }
            data = result;
            commits = combined;
            renderGraph();
        }
        catch {
            if (current(owner, project, gen) && request === listRequest)
                message = `${w().error} ${w().refreshHint}`;
        }
        finally {
            if (owns(owner, project, gen) && request === listRequest) {
                listLoading = false;
                controls();
            }
        }
    }
    function metaRow(label, value, target) { const row = make('div'); row.append(make('dt', label), make('dd', value)); target.append(row); }
    function renderDetail(c) {
        detailContent.replaceChildren();
        const h = make('h3', c.subject || c.sha.slice(0, 8));
        h.tabIndex = -1;
        h.id = 'git-commit-title';
        detailContent.append(h, make('code', c.sha, 'history-sha'));
        const meta = make('dl', '', 'history-detail-meta');
        metaRow(w().author, `${c.authorName} <${c.authorEmail}>`, meta);
        metaRow(w().authored, c.authoredAt, meta);
        metaRow(w().committed, c.committedAt, meta);
        detailContent.append(meta);
        const parents = make('div', '', 'history-parents');
        parents.append(make('span', w().parents));
        for (const parent of c.parents) {
            const link = button(parent.slice(0, 8), '');
            link.dataset.parent = parent;
            link.addEventListener('click', () => { void openCommit(parent); });
            parents.append(link);
        }
        detailContent.append(parents, make('pre', c.body, 'history-message'));
        if (c.bodyTruncated)
            detailContent.append(make('p', w().bodyLimited, 'hint'));
        detailContent.append(make('p', c.comparisonParent ? `${w().firstParent} ${c.comparisonParent.slice(0, 8)}` : w().rootDiff, 'muted'));
        const changes = make('div', '', 'history-changes'), filePane = make('section', '', 'history-files'), fileList = make('div');
        fileList.id = 'git-commit-files';
        filePane.append(make('h4', `${w().files} · ${c.files.length}`), fileList);
        const preview = make('section', '', 'history-preview'), patchTitle = make('h4', w().selectFile), patchStatus = make('p', '', 'muted'), patch = make('pre', '', 'history-patch');
        patch.id = 'git-commit-patch';
        patch.tabIndex = 0;
        patchStatus.setAttribute('role', 'status');
        preview.append(patchTitle, patchStatus, patch);
        for (const file of c.files) {
            const row = button('', '');
            row.className = 'history-file';
            row.dataset.gitFile = file.path;
            row.append(make('span', file.status, 'history-file-status'), make('span', file.path, 'history-file-path'), make('small', file.binary ? w().binary : `+${file.additions ?? '—'} −${file.deletions ?? '—'}`));
            row.addEventListener('click', () => { fileList.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === row))); void showPatch(c.sha, file.path, patchTitle, patchStatus, patch); });
            fileList.append(row);
        }
        if (!c.files.length)
            fileList.append(make('p', w().noFiles));
        if (c.filesTruncated)
            filePane.append(make('p', w().filesLimited, 'hint'));
        changes.append(filePane, preview);
        detailContent.append(changes);
        if (active())
            h.focus({ preventScroll: true });
    }
    async function openCommit(sha) {
        if (!data || !hash(sha))
            return;
        const cached = details.get(sha);
        if (!cached && (!navigator.onLine || busy))
            return;
        canvas.querySelectorAll('[data-commit]').forEach(n => n.setAttribute('aria-pressed', String(n.dataset.commit === sha)));
        if (detail.hidden) {
            origin = sha;
            scrollY = window.scrollY;
        }
        selected = sha;
        diffRequest++;
        diffLoading = false;
        const request = ++detailRequest;
        const owner = epoch, project = root, gen = generation, revision = data.revision;
        graphPane.hidden = true;
        detail.hidden = false;
        detailLoading = true;
        detailContent.replaceChildren(make('p', w().loading));
        message = '';
        controls();
        try {
            const result = cached || await invoke('governance.gitHistory', { action: 'detail', sha, revision });
            if (!current(owner, project, gen) || request !== detailRequest || detail.hidden || data.revision !== revision)
                return;
            const c = result.commit;
            if (result.workspace !== project || result.revision !== revision || !commitOK(c) || c.sha !== sha || typeof c.body !== 'string' || c.body.length > 32768 || !Array.isArray(c.files) || c.files.length > 500 || c.files.some(f => typeof f.path !== 'string' || f.path.length > 4096 || typeof f.status !== 'string'))
                throw Error('Invalid commit response');
            remember(details, sha, result, 16);
            renderDetail(c);
        }
        catch {
            if (current(owner, project, gen) && request === detailRequest && !detail.hidden) {
                detailContent.replaceChildren(make('p', w().error, 'hint'));
                message = w().refreshHint;
            }
        }
        finally {
            if (owns(owner, project, gen) && request === detailRequest) {
                detailLoading = false;
                controls();
            }
        }
    }
    async function showPatch(sha, file, titleNode, notice, pre) {
        const key = `${sha}:${file}`, cached = patches.get(key);
        if (!cached && (!navigator.onLine || busy))
            return;
        const request = ++diffRequest, owner = epoch, project = root, gen = generation, revision = data.revision;
        titleNode.textContent = file;
        notice.textContent = w().loading;
        pre.replaceChildren();
        diffLoading = true;
        controls();
        try {
            const r = cached || await invoke('governance.gitHistory', { action: 'diff', sha, path: file, revision });
            if (!current(owner, project, gen) || request !== diffRequest || detail.hidden || selected !== sha || data.revision !== revision)
                return;
            if (r.workspace !== project || r.revision !== revision || r.sha !== sha || r.path !== file || !['text', 'binary', 'restricted', 'too-large'].includes(r.kind) || typeof r.patch !== 'string' || r.patch.length > 131072)
                throw Error('Invalid patch');
            remember(patches, key, r, 8);
            notice.textContent = r.kind === 'text' ? r.truncated ? w().truncated : '' : w()[r.kind === 'too-large' ? 'tooLarge' : r.kind];
            const lines = r.patch.split('\n');
            if (lines.length > 4000)
                pre.textContent = r.patch;
            else
                for (const line of lines)
                    pre.append(make('span', line + '\n', line.startsWith('+') && !line.startsWith('+++') ? 'patch-add' : line.startsWith('-') && !line.startsWith('---') ? 'patch-delete' : line.startsWith('@@') ? 'patch-hunk' : ''));
        }
        catch {
            if (current(owner, project, gen) && request === diffRequest && selected === sha)
                notice.textContent = w().error;
        }
        finally {
            if (owns(owner, project, gen) && request === diffRequest) {
                diffLoading = false;
                controls();
            }
        }
    }
    function goBack() {
        detailRequest++;
        diffRequest++;
        detailLoading = diffLoading = false;
        detail.hidden = true;
        graphPane.hidden = false;
        detailContent.replaceChildren();
        controls();
        const target = Array.from(canvas.querySelectorAll('[data-commit]')).find(n => n.dataset.commit === origin);
        target?.focus({ preventScroll: true });
        window.scrollTo({ top: scrollY, behavior: 'instant' });
    }
    back.addEventListener('click', goBack);
    host.addEventListener('keydown', e => { if (e.key === 'Escape' && !detail.hidden) {
        e.preventDefault();
        goBack();
    } });
    refresh.addEventListener('click', () => { void load(); });
    more.addEventListener('click', () => { void load(true); });
    function context() {
        if (epoch !== workspaceEpoch || snapshot?.workspace && snapshot.workspace !== root) {
            reset();
            epoch = workspaceEpoch;
            root = snapshot?.workspace || null;
        }
        if (!root && snapshot?.workspace) {
            root = snapshot.workspace;
            epoch = workspaceEpoch;
        }
        controls();
        if (active() && root && !attempted && !busy && navigator.onLine)
            void load();
    }
    function localize() { historyTab.textContent = w().history; managedTab.textContent = w().managed; title.textContent = w().title; subtitle.textContent = w().intro; refresh.textContent = w().refresh; more.textContent = w().more; back.textContent = w().back; safety.textContent = w().noWrite; scroll.setAttribute('aria-label', w().history); tabs.setAttribute('aria-label', w().history); controls(); }
    window.addEventListener('hashchange', context);
    window.addEventListener('git-history-context', context);
    window.addEventListener('git-history-reset', () => { reset(); });
    window.addEventListener('offline', () => { listRequest++; detailRequest++; diffRequest++; listLoading = detailLoading = diffLoading = false; controls(); });
    window.addEventListener('online', controls);
    window.addEventListener('pagehide', () => { reset(); root = null; });
    window.addEventListener('pageshow', context);
    localize();
    switchTab('history');
    void localeReady.then(() => { localize(); context(); });
})();
