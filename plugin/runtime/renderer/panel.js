'use strict';
const $ = (id) => document.getElementById(id);
let snapshot = null, busy = false, edited = false;
let projectSnapshot = null, editingItem = null, draggedItem = null;
const dirtyForms = new Set();
function discardWarning(submitted) {
    const names = {
        'progress-form': t('draftProgress'),
        'start-form': t('draftTask'),
        'workitem-form': t('draftItem'),
        'accept-form': t('draftReview')
    };
    const drafts = [...dirtyForms].filter((id) => id !== submitted).map((id) => names[id] || id);
    return drafts.length ? t('discard', drafts.join(' / ')) : '';
}
const boardStages = ['todo', 'doing', 'done', 'accepted'];
const boardLabels = new Proxy({}, { get: (_, key) => t(key) });
const labels = new Proxy({}, { get: (_, key) => (copy[locale][key] ? t(key) : String(key)) });
const text = (id, value) => {
    $(id).textContent = value ?? '';
};
const lines = (id) => $(id)
    .value.split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
function notify(message, error = false) {
    text('notice-message', message);
    $('notice').classList.toggle('error', error);
}
function lock(value) {
    busy = value;
    document
        .querySelectorAll('main button, main input, main textarea, #item-sheet button, #item-sheet input, #item-sheet textarea, .action-dialog button, .action-dialog input, .action-dialog textarea, .action-dialog select')
        .forEach((el) => {
        el.disabled = value;
    });
    $('workitem-blocker').disabled = value || !editingItem;
    for (const id of ['workitem-save', 'item-edit', 'initialize'])
        $(id).disabled = value || !navigator.onLine;
    document
        .querySelectorAll('#project-dialog button[type="submit"], #accept-form button[type="submit"]')
        .forEach((button) => {
        button.disabled = value || !navigator.onLine;
    });
    $('board-new').disabled =
        value ||
            !snapshot?.state ||
            !projectSnapshot ||
            !!projectSnapshot.boardError ||
            !navigator.onLine;
    document.querySelectorAll('[data-workitem]').forEach((card) => {
        card.draggable = !value && !searchQuery && navigator.onLine;
    });
    document.querySelectorAll('.column-add').forEach((button) => {
        button.disabled = value || !snapshot?.state || !navigator.onLine;
    });
    for (const id of ['analysis-start', 'architecture-analyze'])
        $(id).disabled = value || !snapshot?.state?.task || !projectSnapshot || !navigator.onLine;
    document
        .querySelectorAll('.review-button, #item-human-review, #item-agent-review')
        .forEach((button) => {
        button.disabled = value || !navigator.onLine;
    });
}
async function invoke(channel, payload = {}) {
    if (!window.pluginBridge?.invoke)
        throw Error(t('staticPreview'));
    const response = await window.pluginBridge.invoke(channel, payload);
    if (!response?.ok)
        throw Error(response?.error || t('invalidResponse'));
    return response.result;
}
function list(id, values) {
    $(id).replaceChildren(...(values?.length ? values : [t('none')]).map((value) => {
        const li = document.createElement('li');
        li.textContent = value;
        return li;
    }));
}
function render(data) {
    snapshot = data;
    const s = data.state;
    const status = s ? labels[s.status] || s.status : t('uninitialized');
    const criteriaCount = s?.criteria?.length || 0;
    const blockerCount = s?.blocked?.length || 0;
    text('workspace', data.workspace);
    text('status', status);
    text('status-metric', status);
    $('status').dataset.state = s?.status || 'uninitialized';
    text('criteria-count', criteriaCount);
    text('criteria-state', t('count', criteriaCount));
    text('blocked-count', blockerCount);
    text('task-id', s?.task || 'STATE');
    text('goal', s?.goal || (s ? t('noTask') : t('establish')));
    text('current', s?.current || t('initFirst'));
    list('criteria', s?.criteria);
    list('scope', s?.scope);
    list('constraints', s?.constraints);
    $('followup').hidden = !s?.followUp;
    text('followup', s?.followUp ? t('followup', s.followUp.id) : '');
    $('uninitialized').hidden = !!s;
    $('start-form').hidden = !s || !!s.task;
    $('progress-form').hidden = !s?.task;
    text('editor-title', s?.task ? t('updateProgress') : s ? t('createTask') : t('init'));
    $('edit-current').value = s?.current || '';
    $('edit-next').value = (s?.next || []).join('\n');
    $('edit-blocked').value = (s?.blocked || []).join('\n');
    for (const key of ['id', 'goal', 'criteria', 'scope', 'constraints']) {
        const v = s?.followUp?.[key];
        $(`new-${key}`).value = Array.isArray(v) ? v.join('\n') : v || '';
    }
    edited = false;
}
function renderGit(g) {
    if (snapshot && g.workspace !== snapshot.workspace)
        throw Error(t('switched'));
    text('git-summary', t('gitSummary', (g.head || '').slice(0, 12), g.dirty ? t('dirty') : t('clean'), g.tasks.length));
    $('git-tasks').replaceChildren();
    if (!g.tasks.length) {
        text('git-tasks', t('noGitTasks'));
        return;
    }
    for (const task of g.tasks) {
        const card = document.createElement('article');
        card.className = 'git-task';
        const rows = [
            ['h3', `${task.id} · ${task.role === 'coordinator' ? t('coordinator') : t('worker')}`],
            ['p', task.goal],
            [
                'p',
                `${labels[task.status] || task.status} · ${task.dirty ? t('dirty') : t('clean')} · ${task.verificationValid ? t('valid') : t('invalid')}`
            ],
            ['p', t('branch', task.branch)],
            ['p', task.worktree, 'path'],
            ['p', t('scopeValue', (task.allowedPaths || []).join(' / '))]
        ];
        if (task.error)
            rows[2] = ['p', t('unavailable')];
        if (task.error)
            rows.push(['p', t('readFailed', task.error)]);
        if (task.pendingMerge || task.mergeInProgress)
            rows.push(['p', t('incompleteMerge')]);
        for (const [tag, value, cls] of rows) {
            const el = document.createElement(tag);
            el.textContent = value || '';
            if (cls)
                el.className = cls;
            card.append(el);
        }
        $('git-tasks').append(card);
    }
}
async function load() {
    snapshot = null;
    dirtyForms.clear();
    if ($('accept-dialog').open)
        $('accept-dialog').close();
    $('accept-form').reset();
    projectSnapshot = null;
    resetWorkitem();
    $('workitem-form').hidden = true;
    if ($('item-sheet').open)
        $('item-sheet').close();
    closeItemMenu(false);
    stopLongPress();
    draggedItem = null;
    longPressConsumed = null;
    $('board-empty').hidden = true;
    $('board-section').setAttribute('aria-busy', 'true');
    $('board-columns').replaceChildren();
    text('board-status', t('boardLoading'));
    notify(t('workspaceLoading'));
    try {
        render(await invoke('governance.snapshot'));
        text('updated', t('updated', new Date().toLocaleTimeString(locale)));
        notify(t('synced'));
    }
    catch (error) {
        notify(error.message, true);
        for (const id of ['uninitialized', 'start-form', 'progress-form'])
            $(id).hidden = true;
        text('workspace', t('disconnected'));
    }
    text('git-summary', t('gitLoading'));
    $('git-tasks').replaceChildren();
    if (snapshot) {
        try {
            const data = await invoke('governance.project');
            if (data.workspace !== snapshot.workspace)
                throw Error(t('switched'));
            projectSnapshot = data;
            if (data.boardError)
                notify(t('boardError', data.boardError), true);
            renderBoard();
        }
        catch (error) {
            text('board-status', t('boardReadError', error.message));
            notify(t('boardReadError', error.message), true);
        }
    }
    else
        text('board-status', t('boardDisconnected'));
    renderProjectGraph();
    // Project content is useful before slow Git commands settle. Keep new controls locked.
    if (busy)
        lock(true);
    try {
        renderGit(await invoke('governance.git'));
    }
    catch (error) {
        text('git-summary', t('gitError', error.message));
    }
    $('board-section').setAttribute('aria-busy', 'false');
}
function confirmWrite(description) {
    const dialog = $('confirm-dialog');
    text('confirm-description', description);
    text('confirm-workspace', snapshot?.workspace || '');
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {
        once: true
    }));
}
async function mutate(args, description) {
    if (busy || !snapshot)
        return;
    if (!navigator.onLine) {
        notify(t('offlineNotice'), true);
        return;
    }
    lock(true);
    try {
        if (!(await confirmWrite(description +
            discardWarning(args.action === 'progress'
                ? 'progress-form'
                : args.action === 'start'
                    ? 'start-form'
                    : undefined))))
            return;
        if (!navigator.onLine) {
            notify(t('offlineNotice'), true);
            return;
        }
        await invoke('governance.mutate', { args, revision: snapshot.revision, confirmed: true });
        await load();
    }
    catch (error) {
        notify(t('noRetry', error.message), true);
    }
    finally {
        lock(false);
    }
}
$('refresh').addEventListener('click', async () => {
    if (busy)
        return;
    if (edited) {
        notify(t('unsaved'));
        edited = false;
        return;
    }
    lock(true);
    try {
        await load();
    }
    finally {
        lock(false);
    }
});
for (const form of document.querySelectorAll('main form, #project-dialog form, #workitem-form, #accept-form'))
    form.addEventListener('input', () => {
        edited = true;
        dirtyForms.add(form.id);
    });
$('initialize').addEventListener('click', () => mutate({ action: 'init' }, t('initConfirm')));
$('start-form').addEventListener('submit', (event) => {
    event.preventDefault();
    mutate({
        action: 'start',
        id: $('new-id').value.trim(),
        goal: $('new-goal').value.trim(),
        criteria: lines('new-criteria'),
        scope: lines('new-scope'),
        constraints: lines('new-constraints')
    }, t('startConfirm'));
});
$('progress-form').addEventListener('submit', (event) => {
    event.preventDefault();
    mutate({
        action: 'progress',
        current: $('edit-current').value.trim(),
        next: lines('edit-next'),
        blocked: lines('edit-blocked')
    }, t('progressConfirm'));
});
let graphView = 'architecture';
function renderProjectGraph() {
    let graph = null, message = '';
    const s = snapshot?.state;
    text('graph-warning', '');
    $('graph-warning').hidden = true;
    if (graphView === 'workflow') {
        text('architecture-title', t('workflow'));
        text('graph-source', t('workflowSource'));
        text('graph-overview', t('workflowOverview'));
        if (!snapshot)
            message = t('stateError');
        else if (!s)
            message = t('notInitialized');
        else {
            const phases = ['idle', 'working', 'verified', 'ready'];
            graph = {
                nodes: phases.map((id) => ({
                    id,
                    title: labels[id],
                    current: s.status === id,
                    files: ['STATE.json'],
                    description: id === s.status
                        ? t('phaseDetails', s.current || '', (s.blocked || []).join(' / ') || t('none'), s.verification ? t('recorded') : t('noRecord'), s.followUp ? t('approved', s.followUp.id) : '')
                        : {
                            idle: t('phaseIdle'),
                            working: t('phaseWorking'),
                            verified: t('phaseVerified'),
                            ready: t('phaseReady')
                        }[id]
                })),
                edges: [
                    { from: 'idle', to: 'working', label: 'start' },
                    { from: 'working', to: 'verified', label: 'verify' },
                    { from: 'verified', to: 'ready', label: 'gate / close(knowledge)' },
                    { from: 'ready', to: 'idle', label: 'close / archive' },
                    { from: 'verified', to: 'working', label: t('intentChange') },
                    { from: 'ready', to: 'working', label: t('intentChange') }
                ]
            };
        }
    }
    else {
        text('architecture-title', t('architecture'));
        graph = projectSnapshot?.architecture;
        message = projectSnapshot?.architectureError
            ? t('architectureError', projectSnapshot.architectureError)
            : !projectSnapshot
                ? t('graphReadError')
                : !graph
                    ? t('noGraph')
                    : '';
        text('graph-source', graph
            ? t('graphSource', graph.title, graph.source, graph.updatedAt, graph.staleFiles?.length ? t('sourceChanged', graph.staleFiles.join(' / ')) : '')
            : t('persistedOnly'));
        text('graph-overview', graph?.title || t('coreModules'));
        const stale = graph?.staleFiles || [];
        text('graph-warning', stale.length ? t('stale', stale.join(' / ')) : '');
        $('graph-warning').hidden = !stale.length;
    }
    text('graph-empty', message);
    $('graph-empty').hidden = !message;
    text('graph-count', t('graphCount', graph?.nodes?.length || 0, graph?.edges?.length || 0));
    $('show-architecture').setAttribute('aria-pressed', String(graphView === 'architecture'));
    $('show-workflow').setAttribute('aria-pressed', String(graphView === 'workflow'));
    window.dispatchEvent(new CustomEvent('project-graph', { detail: graph }));
}
$('show-architecture').addEventListener('click', () => {
    graphView = 'architecture';
    renderProjectGraph();
});
$('show-workflow').addEventListener('click', () => {
    graphView = 'workflow';
    renderProjectGraph();
});
const pageIds = ['board-section', 'architecture', 'git-section'];
function highlightNavigation() {
    const requested = location.hash.slice(1);
    const active = pageIds.includes(requested) ? requested : 'board-section';
    const pageTitles = {
        architecture: 'navArchitecture',
        'board-section': 'navBoard',
        'git-section': 'navGit'
    };
    text('page-title', t(pageTitles[active]));
    for (const id of pageIds)
        $(id).hidden = id !== active;
    if (requested === 'task-section')
        openProjectControls();
    document.querySelectorAll('.workspace-nav a').forEach((link) => {
        if (link.hash === `#${active}`)
            link.setAttribute('aria-current', 'page');
        else
            link.removeAttribute('aria-current');
    });
    if (active === 'architecture')
        window.dispatchEvent(new Event('resize'));
}
window.addEventListener('hashchange', () => {
    closeItemMenu(false);
    stopLongPress();
    highlightNavigation();
});
highlightNavigation();
// Read theme colors, never inject a contributed stylesheet into the panel.
const themeColors = {
    '--ds-bg-primary': '--bg',
    '--ds-bg-secondary': '--surface',
    '--ds-bg-tertiary': '--subtle',
    '--ds-bg-sidebar': '--sidebar',
    '--ds-text-primary': '--text',
    '--ds-text-muted': '--muted',
    '--ds-border-default': '--line',
    '--ds-accent': '--accent',
    '--ds-error': '--error'
};
const systemAppearance = matchMedia('(prefers-color-scheme: dark)');
let lastAppearance = {}, appearanceRevision = 0;
let paletteMode = 'pebrel';
try {
    if (localStorage.getItem('governance-palette') === 'host')
        paletteMode = 'host';
}
catch {
    /* Storage can be disabled by the host. */
}
function contributedColors(css) {
    const colors = {};
    if (typeof css !== 'string' || css.length > 256 * 1024)
        return colors;
    try {
        const sheet = new CSSStyleSheet();
        // Imports and all non-color rules are ignored; this sheet is never adopted.
        sheet.replaceSync(css.replace(/\/\*[\s\S]*?\*\//g, ''));
        const variables = {};
        const priorities = {};
        for (const rule of Array.from(sheet.cssRules)) {
            if (!(rule instanceof CSSStyleRule))
                continue;
            const selectors = rule.selectorText
                .split(',')
                .map((s) => s.trim())
                .filter((s) => /^:root(?:\[data-(?:theme|plugin-theme)=(?:"[^"\r\n]+"|'[^'\r\n]+'|[\w:-]+)\])*$/.test(s) && document.documentElement.matches(s));
            if (!selectors.length)
                continue;
            const specificity = Math.max(...selectors.map((s) => (s.match(/\[/g) || []).length));
            for (const name of Array.from(rule.style)) {
                const priority = specificity + (rule.style.getPropertyPriority(name) === 'important' ? 10000 : 0);
                if (/^--[a-z][a-z0-9-]*$/.test(name) && priority >= (priorities[name] ?? -1)) {
                    variables[name] = rule.style.getPropertyValue(name).trim();
                    priorities[name] = priority;
                }
            }
        }
        let expansions = 0;
        const resolve = (value, seen = []) => {
            if (++expansions > 256 || value.length > 2048 || seen.length > 8)
                throw Error('Color alias budget exceeded');
            const result = value.replace(/var\((--[a-z][a-z0-9-]*)(?:,\s*([^()]+))?\)/g, (_, name, fallback) => seen.includes(name) ? '' : resolve(variables[name] || fallback || '', [...seen, name]));
            if (result.length > 2048)
                throw Error('Color value budget exceeded');
            return result;
        };
        for (const [name, target] of Object.entries(themeColors)) {
            const value = resolve(variables[name] || '');
            // CSS color syntax only; reject URLs, expressions, unresolved vars and declarations.
            if (value &&
                !/[;{}@]|url\s*\(|var\s*\(|expression\s*\(/i.test(value) &&
                /^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklab|oklch|lab|lch|color|color-mix)\([\s\S]*\)|[a-z]+)$/i.test(value) &&
                !/^(?:inherit|initial|unset|revert|currentcolor|transparent)$/i.test(value) &&
                CSS.supports('color', value)) {
                colors[target] = value;
            }
        }
    }
    catch {
        /* Unsupported/invalid custom CSS keeps the built-in palette. */
    }
    return colors;
}
const appearance = (value = {}) => {
    lastAppearance = value || {};
    // System-media changes update the palette but do not invalidate the initial host read.
    const root = document.documentElement;
    const base = value?.base === 'light' || value?.base === 'dark'
        ? value.base
        : systemAppearance.matches
            ? 'dark'
            : 'light';
    root.dataset.base = base;
    root.dataset.theme = base;
    root.dataset.palette = paletteMode;
    text('palette-label', t(paletteMode === 'pebrel' ? 'paletteIndependent' : 'paletteHost'));
    $('palette-toggle').setAttribute('aria-pressed', String(paletteMode === 'pebrel'));
    if (value?.pluginTheme?.id)
        root.dataset.pluginTheme = String(value.pluginTheme.id);
    else
        delete root.dataset.pluginTheme;
    for (const target of Object.values(themeColors))
        root.style?.removeProperty(target);
    if (paletteMode === 'host' && value?.pluginTheme?.base === base) {
        for (const [target, color] of Object.entries(contributedColors(value.pluginTheme.css)))
            root.style.setProperty(target, color);
    }
};
$('palette-toggle').addEventListener('click', () => {
    paletteMode = paletteMode === 'pebrel' ? 'host' : 'pebrel';
    try {
        localStorage.setItem('governance-palette', paletteMode);
    }
    catch {
        /* This session still changes when persistence is unavailable. */
    }
    appearance(lastAppearance);
});
appearance();
systemAppearance.addEventListener?.('change', () => {
    if (!['light', 'dark'].includes(lastAppearance.base))
        appearance(lastAppearance);
});
window.pluginBridge?.on?.('appearance:changed', (value) => {
    appearanceRevision++;
    appearance(value);
});
const initialAppearanceRevision = appearanceRevision;
window.pluginBridge
    ?.invoke('app.getAppearance')
    .then((value) => {
    if (appearanceRevision === initialAppearanceRevision)
        appearance(value);
})
    .catch(() => { });
let selectedItem = null, itemOrigin = null, searchQuery = '';
let menuOrigin = null, longPress = null;
let longPressConsumed = null;
function itemById(id) {
    return projectSnapshot?.board?.items.find((item) => item.id === id);
}
function resetWorkitem() {
    dirtyForms.delete('workitem-form');
    editingItem = null;
    edited = dirtyForms.size > 0;
    $('workitem-form').reset();
    $('workitem-id').readOnly = false;
    $('workitem-blocker').disabled = true;
    $('workitem-form').hidden = true;
    text('workitem-save', t('saveChanges'));
}
function closeItemMenu(restore = true) {
    $('item-menu').hidden = true;
    if (restore && menuOrigin?.isConnected)
        menuOrigin.focus();
}
async function allowItemSwitch() {
    if (busy)
        return false;
    if (!dirtyForms.has('workitem-form'))
        return true;
    lock(true);
    try {
        return !!(await confirmWrite(t('switchDraft')));
    }
    finally {
        lock(false);
    }
}
async function openItem(id = null, edit = false, origin) {
    if (!id &&
        (!snapshot?.state || !projectSnapshot || projectSnapshot.boardError || !navigator.onLine))
        return;
    if (!(await allowItemSwitch()))
        return;
    const item = id ? itemById(id) : null;
    if (id && !item)
        return;
    resetWorkitem();
    closeItemMenu(false);
    selectedItem = id;
    itemOrigin = origin || document.activeElement;
    $('item-guidance').hidden = true;
    $('item-read').hidden = !item || edit;
    $('item-acceptance').hidden = !item || edit;
    text('item-sheet-title', item ? item.title : t('newItem'));
    text('item-sheet-meta', item ? boardLabels[item.stage] : t('newItem'));
    if (item) {
        text('item-description', item.description || t('noDescription'));
        text('item-blocker', item.blocker);
        $('item-blocker').hidden = !item.blocker;
        text('item-record-id', item.id);
        text('item-record-task', item.taskId || t('none'));
        text('item-record-git', item.gitTaskId || t('none'));
        list('item-criteria', item.criteria);
        const r = item.acceptance;
        text('item-review-record', r
            ? t('reviewRecord', t(r.method === 'human' ? 'humanAcceptance' : 'agentAcceptance'), r.reviewer, t(r.valid ? 'reviewValid' : 'reviewInvalid'), r.at, r.conclusion, r.evidence)
            : t('noReview'));
        $('item-human-review').hidden = $('item-agent-review').hidden = item.stage !== 'done';
    }
    if (edit || !item) {
        editingItem = item?.id || null;
        $('workitem-id').value = item?.id || `item-${crypto.randomUUID().slice(0, 8)}`;
        $('workitem-title').value = item?.title || '';
        $('workitem-description').value = item?.description || '';
        $('workitem-criteria').value = (item?.criteria || []).join('\n');
        $('workitem-blocker').value = item?.blocker || '';
        $('workitem-blocker').disabled = !item;
        $('blocker-field').hidden = !item;
        $('workitem-form').hidden = false;
        text('workitem-save', t(item ? 'saveChanges' : 'createItem'));
    }
    if (!$('item-sheet').open)
        $('item-sheet').show();
    (edit || !item ? $('workitem-title') : $('item-edit')).focus();
    lock(busy);
    if (!edit && item && !navigator.onLine)
        $('item-back').focus();
    return true;
}
async function closeItemSheet() {
    if (!(await allowItemSwitch()))
        return;
    resetWorkitem();
    $('item-sheet').close();
    const target = itemOrigin?.isConnected && !itemOrigin.closest('[hidden]')
        ? itemOrigin
        : document.querySelector(`[data-workitem="${selectedItem}"]`);
    (target && !target.closest('[hidden]')
        ? target
        : document.querySelector('.workspace-nav a[aria-current="page"]') || $('board-new')).focus();
}
async function writeWorkitem(args) {
    if (busy || !snapshot || !projectSnapshot || projectSnapshot.boardError)
        return;
    if (!navigator.onLine) {
        notify(t('offlineNotice'), true);
        return;
    }
    const revision = projectSnapshot.revision;
    lock(true);
    try {
        if (!(await confirmWrite(t('itemConfirm', args.id, args.stage ? ` → ${boardLabels[args.stage]}` : '') +
            discardWarning(args.action === 'board_accept'
                ? 'accept-form'
                : args.action === 'board_move'
                    ? undefined
                    : 'workitem-form'))))
            return;
        if (!navigator.onLine) {
            notify(t('offlineNotice'), true);
            return;
        }
        await invoke('governance.workitem', { args, revision, confirmed: true });
        await load();
        if (projectSnapshot && !projectSnapshot.boardError)
            notify(t('itemSaved'));
        document.querySelector(`[data-workitem="${args.id}"]`)?.focus();
    }
    catch (error) {
        notify(t('itemError', error.message), true);
    }
    finally {
        lock(false);
    }
}
function moveWorkitem(id, stage, position) {
    return writeWorkitem({ action: 'board_move', id, stage, position });
}
function menuActions(item) {
    const all = projectSnapshot.board.items;
    const siblings = all.filter((i) => i.stage === item.stage);
    const index = siblings.findIndex((i) => i.id === item.id);
    const actions = [
        { label: t('itemDetails'), run: () => openItem(item.id, false, menuOrigin) },
        { label: t('edit'), run: () => openItem(item.id, true, menuOrigin) },
        {
            label: t('guideAgent'),
            run: async () => {
                await openItem(item.id, false, menuOrigin);
                if (selectedItem === item.id)
                    showGuidance();
            }
        }
    ];
    if (item.stage === 'done') {
        actions.push({ label: t('humanAcceptance'), run: () => openHumanReview(item.id, menuOrigin) });
        actions.push({ label: t('agentAcceptance'), run: () => startOperation('acceptance', item.id) });
    }
    if (index > 0)
        actions.push({ label: t('moveUp'), run: () => moveWorkitem(item.id, item.stage, index - 1) });
    if (index < siblings.length - 1)
        actions.push({ label: t('moveDown'), run: () => moveWorkitem(item.id, item.stage, index + 1) });
    for (const stage of boardStages.filter((s) => s !== 'accepted' && Math.abs(boardStages.indexOf(s) - boardStages.indexOf(item.stage)) === 1))
        actions.push({
            label: t('moveTo', boardLabels[stage]),
            run: () => moveWorkitem(item.id, stage, all.filter((i) => i.stage === stage).length)
        });
    return actions;
}
function openItemMenu(item, origin, x, y) {
    if (busy || !navigator.onLine)
        return;
    menuOrigin = origin;
    const menu = $('item-menu');
    menu.replaceChildren();
    for (const action of menuActions(item)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.role = 'menuitem';
        button.textContent = action.label;
        button.addEventListener('click', () => {
            closeItemMenu();
            void action.run();
        });
        menu.append(button);
    }
    const rect = origin.getBoundingClientRect();
    menu.hidden = false;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x ?? rect.left, innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y ?? rect.bottom, innerHeight - bounds.height - 8))}px`;
    menu.querySelector('button').focus();
}
function showGuidance() {
    const item = itemById(selectedItem);
    if (!item)
        return;
    $('item-guidance').hidden = false;
    $('agent-brief').value = t('guidanceBrief', snapshot.workspace, item.id, item.title, item.description, item.blocker || t('none'));
    text('brief-status', '');
    $('agent-brief').focus();
    $('agent-brief').select();
}
function stopLongPress() {
    if (longPress)
        clearTimeout(longPress);
    longPress = null;
}
function renderBoard() {
    const data = projectSnapshot;
    closeItemMenu(false);
    stopLongPress();
    draggedItem = null;
    $('board-columns').replaceChildren();
    $('board-empty').hidden = true;
    $('board-new').disabled = busy || !snapshot?.state || !!data?.boardError || !navigator.onLine;
    if (!data || data.boardError) {
        text('board-status', data?.boardError ? t('boardError', data.boardError) : t('boardDisconnected'));
        return;
    }
    const matches = (item) => !searchQuery ||
        [item.title, item.description, item.blocker, item.id].some((s) => s?.toLocaleLowerCase().includes(searchQuery));
    const matchCount = data.board.items.filter(matches).length;
    text('board-status', searchQuery ? t('searchCount', matchCount) : '');
    $('board-empty').hidden = !searchQuery || matchCount > 0;
    for (const stage of boardStages) {
        const column = document.createElement('section');
        column.className = 'board-column';
        column.dataset.stage = stage;
        const all = data.board.items.filter((item) => item.stage === stage);
        const items = all.filter(matches);
        const header = document.createElement('header');
        const heading = document.createElement('h3');
        heading.textContent = boardLabels[stage];
        const count = document.createElement('span');
        count.className = 'column-count';
        count.textContent = String(items.length);
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'column-add';
        add.textContent = '+';
        add.setAttribute('aria-label', t('newItem'));
        add.disabled = busy || !snapshot?.state || !navigator.onLine;
        add.addEventListener('click', () => {
            void openItem(null, true, add);
        });
        header.append(heading, count);
        if (stage === 'todo')
            header.append(add);
        column.append(header);
        column.addEventListener('dragover', (event) => {
            if (draggedItem && !busy && !searchQuery) {
                event.preventDefault();
                column.classList.add('drop-target');
            }
        });
        column.addEventListener('dragleave', (event) => {
            if (!column.contains(event.relatedTarget))
                column.classList.remove('drop-target');
        });
        column.addEventListener('drop', (event) => {
            event.preventDefault();
            column.classList.remove('drop-target');
            const id = draggedItem;
            draggedItem = null;
            if (!id || busy || searchQuery)
                return;
            const target = event.target.closest('[data-workitem]');
            if (target?.dataset.workitem === id)
                return;
            const others = all.filter((item) => item.id !== id);
            const index = target ? others.findIndex((item) => item.id === target.dataset.workitem) : -1;
            void moveWorkitem(id, stage, index < 0 ? others.length : index);
        });
        for (const item of items) {
            const card = document.createElement('article');
            card.className = 'workitem';
            card.dataset.workitem = item.id;
            card.dataset.blocked = String(!!item.blocker);
            card.tabIndex = 0;
            card.draggable = !searchQuery && !busy && navigator.onLine;
            card.setAttribute('aria-label', item.title);
            card.setAttribute('aria-haspopup', 'menu');
            const title = document.createElement('h4');
            title.textContent = item.title;
            const content = document.createElement('p');
            content.className = 'item-excerpt';
            content.textContent = item.description;
            const meta = document.createElement('div');
            meta.className = 'item-meta';
            const status = document.createElement('span');
            status.textContent = item.blocker ? t('blocked') : boardLabels[item.stage];
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'item-more';
            more.textContent = '···';
            more.disabled = busy || !navigator.onLine;
            more.setAttribute('aria-label', t('itemActionsFor', item.title));
            more.setAttribute('aria-haspopup', 'menu');
            more.addEventListener('click', (event) => {
                event.stopPropagation();
                openItemMenu(item, more);
            });
            meta.append(status, more);
            card.append(title);
            if (item.description)
                card.append(content);
            card.append(meta);
            if (item.stage === 'done') {
                const actions = document.createElement('div');
                actions.className = 'card-review-actions';
                for (const [key, run] of [
                    ['humanAcceptance', () => openHumanReview(item.id, card)],
                    ['agentAcceptance', () => startOperation('acceptance', item.id)]
                ]) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'review-button';
                    button.textContent = t(key);
                    button.disabled = busy || !navigator.onLine;
                    button.addEventListener('click', (event) => {
                        event.stopPropagation();
                        void run();
                    });
                    actions.append(button);
                }
                card.append(actions);
            }
            card.addEventListener('click', (event) => {
                if (event.target.closest('button'))
                    return;
                if (longPressConsumed?.id === item.id && Date.now() < longPressConsumed.until) {
                    longPressConsumed = null;
                    return;
                }
                void openItem(item.id, false, card);
            });
            card.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                stopLongPress();
                openItemMenu(item, card, event.clientX, event.clientY);
            });
            card.addEventListener('keydown', (event) => {
                if (event.target.closest('button'))
                    return;
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault();
                    openItemMenu(item, card);
                }
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void openItem(item.id, false, card);
                }
            });
            let pressX = 0, pressY = 0;
            card.addEventListener('pointerdown', (event) => {
                stopLongPress();
                longPressConsumed = null;
                if (event.pointerType === 'mouse' ||
                    event.button !== 0 ||
                    event.target.closest('button'))
                    return;
                pressX = event.clientX;
                pressY = event.clientY;
                longPress = setTimeout(() => {
                    if (!card.isConnected || busy)
                        return;
                    longPressConsumed = { id: item.id, until: Infinity };
                    openItemMenu(item, card, pressX, pressY);
                }, 500);
            });
            card.addEventListener('pointermove', (event) => {
                if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > 8)
                    stopLongPress();
            });
            for (const event of ['pointerup', 'pointercancel', 'pointerleave'])
                card.addEventListener(event, stopLongPress);
            card.addEventListener('dragstart', (event) => {
                stopLongPress();
                closeItemMenu(false);
                if (busy ||
                    searchQuery ||
                    !navigator.onLine ||
                    (longPressConsumed?.id === item.id && Date.now() < longPressConsumed.until)) {
                    event.preventDefault();
                    return;
                }
                draggedItem = item.id;
                event.dataTransfer.setData('text/plain', item.id);
                event.dataTransfer.effectAllowed = 'move';
                card.classList.add('dragging');
            });
            card.addEventListener('dragend', () => {
                draggedItem = null;
                card.classList.remove('dragging');
                document
                    .querySelectorAll('.drop-target')
                    .forEach((el) => el.classList.remove('drop-target'));
            });
            column.append(card);
        }
        if (!items.length) {
            const empty = document.createElement('p');
            empty.className = 'column-empty';
            empty.textContent = t(searchQuery ? 'noResults' : 'emptyColumn');
            column.append(empty);
        }
        $('board-columns').append(column);
    }
}
$('board-new').addEventListener('click', () => {
    void openItem(null, true, $('board-new'));
});
$('board-search').addEventListener('input', () => {
    searchQuery = $('board-search').value.trim().toLocaleLowerCase();
    if (projectSnapshot)
        renderBoard();
});
$('search-clear').addEventListener('click', () => {
    $('board-search').value = '';
    searchQuery = '';
    renderBoard();
    $('board-search').focus();
});
for (const id of ['item-back', 'item-close', 'workitem-cancel'])
    $(id).addEventListener('click', () => {
        void closeItemSheet();
    });
$('item-sheet').addEventListener('cancel', (event) => {
    event.preventDefault();
    void closeItemSheet();
});
$('item-edit').addEventListener('click', () => {
    void openItem(selectedItem, true, itemOrigin);
});
$('item-guide').addEventListener('click', showGuidance);
$('brief-copy').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText($('agent-brief').value);
        text('brief-status', t('guidanceCopied'));
    }
    catch {
        text('brief-status', t('selectToCopy'));
        $('agent-brief').focus();
        $('agent-brief').select();
    }
});
$('item-menu').addEventListener('keydown', (event) => {
    const buttons = Array.from($('item-menu').querySelectorAll('button'));
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        buttons[event.key === 'Home'
            ? 0
            : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        closeItemMenu();
    }
});
document.addEventListener('pointerdown', (event) => {
    if (!$('item-menu').hidden && !$('item-menu').contains(event.target))
        closeItemMenu(false);
});
window.addEventListener('resize', () => closeItemMenu(false));
document.addEventListener('pointerup', () => {
    if (longPressConsumed)
        longPressConsumed.until = Date.now() + 1200;
});
document.addEventListener('pointercancel', () => {
    longPressConsumed = null;
    stopLongPress();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' &&
        $('item-sheet').open &&
        !$('confirm-dialog').open &&
        !['project-dialog', 'accept-dialog', 'operations-dialog'].some((id) => $(id).open) &&
        $('item-menu').hidden) {
        event.preventDefault();
        void closeItemSheet();
        return;
    }
    if (event.key === '/' &&
        !event.target.closest('input, textarea, [contenteditable]') &&
        !$('item-sheet').open &&
        !$('confirm-dialog').open) {
        event.preventDefault();
        location.hash = '#board-section';
        highlightNavigation();
        $('board-search').focus();
    }
});
window.addEventListener('offline', () => {
    closeItemMenu(false);
    notify(t('offlineNotice'), true);
    if (projectSnapshot)
        renderBoard();
    lock(busy);
});
window.addEventListener('online', () => {
    notify(t('onlineNotice'));
    if (projectSnapshot)
        renderBoard();
    lock(busy);
});
$('workitem-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void writeWorkitem({
        action: editingItem ? 'board_update' : 'board_create',
        id: editingItem || $('workitem-id').value,
        title: $('workitem-title').value.trim(),
        description: $('workitem-description').value,
        criteria: lines('workitem-criteria'),
        ...(editingItem ? { blocker: $('workitem-blocker').value } : {})
    });
});
lock(true);
localeReady
    .then(() => {
    highlightNavigation();
    appearance(lastAppearance);
    return load();
})
    .finally(() => lock(false));
let reviewingItem = null;
function openProjectControls() {
    closeItemMenu(false);
    if (!$('project-dialog').open)
        $('project-dialog').showModal();
}
$('project-open').addEventListener('click', openProjectControls);
$('project-close').addEventListener('click', () => {
    if (!busy)
        $('project-dialog').close();
});
async function openHumanReview(id, origin) {
    if (!navigator.onLine || !(await openItem(id, false, origin)))
        return;
    const item = itemById(id);
    if (!item || item.stage !== 'done')
        return;
    if (dirtyForms.has('accept-form')) {
        lock(true);
        try {
            if (!(await confirmWrite(t('switchDraft'))))
                return;
        }
        finally {
            lock(false);
        }
    }
    reviewingItem = { id, fingerprint: item.itemFingerprint };
    $('accept-form').reset();
    dirtyForms.delete('accept-form');
    text('accept-item-title', item.title);
    $('accept-criteria').replaceChildren(...(item.criteria || []).map((criterion) => {
        const label = document.createElement('label');
        label.className = 'criterion-check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.required = true;
        label.append(box, document.createTextNode(criterion));
        return label;
    }));
    $('accept-dialog').showModal();
    $('accept-reviewer').focus();
}
async function closeHumanReview() {
    if (busy)
        return;
    if (dirtyForms.has('accept-form')) {
        lock(true);
        try {
            if (!(await confirmWrite(t('switchDraft'))))
                return;
        }
        finally {
            lock(false);
        }
    }
    $('accept-dialog').close();
    $('accept-form').reset();
    dirtyForms.delete('accept-form');
    edited = dirtyForms.size > 0;
}
$('accept-close').addEventListener('click', closeHumanReview);
$('accept-dialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    void closeHumanReview();
});
$('accept-result').addEventListener('change', () => {
    $('accept-criteria')
        .querySelectorAll('input')
        .forEach((box) => {
        box.required = $('accept-result').value === 'pass';
    });
});
$('accept-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!reviewingItem)
        return;
    void writeWorkitem({
        action: 'board_accept',
        id: reviewingItem.id,
        expectedItem: reviewingItem.fingerprint,
        passed: $('accept-result').value === 'pass',
        reviewer: $('accept-reviewer').value.trim(),
        conclusion: $('accept-conclusion').value.trim(),
        evidence: $('accept-evidence').value.trim(),
        accepted: Array.from($('accept-criteria').querySelectorAll('input')).map((box) => box.checked)
    });
});
$('item-human-review').addEventListener('click', () => {
    void openHumanReview(selectedItem, itemOrigin);
});
$('item-agent-review').addEventListener('click', () => {
    void startOperation('acceptance', selectedItem);
});
const operationLabel = (kind) => kind === 'architecture'
    ? 'architectureTask'
    : kind === 'acceptance'
        ? 'acceptanceTask'
        : 'analysis';
async function startOperation(kind, itemId) {
    if (busy || !projectSnapshot || !snapshot?.state?.task || !navigator.onLine)
        return;
    const revision = projectSnapshot.revision;
    lock(true);
    try {
        if (!(await confirmWrite(t('operationConfirm', t(operationLabel(kind))))))
            return;
        if (!navigator.onLine) {
            notify(t('offlineNotice'), true);
            return;
        }
        await invoke('governance.operation', {
            action: 'start',
            kind,
            itemId,
            revision,
            confirmed: true
        });
        notify(t('operationStarted'));
        if (!$('operations-dialog').open)
            $('operations-dialog').showModal();
        await loadOperations();
    }
    catch (error) {
        notify(t('operationError', error.message), true);
    }
    finally {
        lock(false);
    }
}
async function operationAction(action, id) {
    if (busy)
        return;
    lock(true);
    try {
        if (['cancel', 'resolve'].includes(action) &&
            !(await confirmWrite(t(action === 'resolve' ? 'resolveOperationConfirm' : 'operationCancelConfirm'))))
            return;
        const data = await invoke('governance.operation', {
            action,
            id,
            confirmed: ['cancel', 'resolve'].includes(action)
        });
        if (action === 'status')
            text('operation-result', JSON.stringify({ phase: data.run.phase, runtime: data.runtime, session: data.session }, null, 2).slice(0, 20000));
        await loadOperations();
    }
    catch (error) {
        text('operations-notice', t('operationError', error.message));
    }
    finally {
        lock(false);
    }
}
async function loadOperations() {
    try {
        const data = await invoke('governance.operation', { action: 'list' });
        if (snapshot && data.workspace !== snapshot.workspace)
            throw Error(t('switched'));
        $('operation-runs').replaceChildren();
        text('operations-notice', data.runs.length ? t('progressHintReal') : t('noOperations'));
        for (const run of [...data.runs].reverse()) {
            const row = document.createElement('article');
            row.className = 'operation-run';
            const heading = document.createElement('h3');
            heading.textContent = `${t(operationLabel(run.kind))} · ${labels[run.phase]}`;
            const note = document.createElement('p');
            note.textContent = `${run.updatedAt}${run.error ? ' · ' + run.error : ''}`;
            row.append(heading, note);
            if (run.sessionId)
                for (const [key, action] of [
                    ['inspectResult', 'status'],
                    ['openSession', 'open'],
                    ...(['creating', 'created', 'running', 'unknown'].includes(run.phase)
                        ? [['cancelOperation', 'cancel']]
                        : [])
                ]) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.textContent = t(key);
                    button.disabled = busy;
                    button.addEventListener('click', () => {
                        void operationAction(action, run.id);
                    });
                    row.append(button);
                }
            if (!run.sessionId && ['creating', 'created', 'unknown'].includes(run.phase)) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = t('resolveOperation');
                button.disabled = busy;
                button.addEventListener('click', () => {
                    void operationAction('resolve', run.id);
                });
                row.append(button);
            }
            $('operation-runs').append(row);
        }
    }
    catch (error) {
        text('operations-notice', t('operationError', error.message));
    }
}
$('analysis-start').addEventListener('click', () => {
    void startOperation('analysis');
});
$('architecture-analyze').addEventListener('click', () => {
    void startOperation('architecture');
});
$('operations-open').addEventListener('click', () => {
    if (busy)
        return;
    if (!$('operations-dialog').open)
        $('operations-dialog').showModal();
    text('operation-result', '');
    void loadOperations();
});
$('operations-refresh').addEventListener('click', () => {
    if (!busy)
        void loadOperations();
});
$('operations-close').addEventListener('click', () => {
    if (!busy)
        $('operations-dialog').close();
});
