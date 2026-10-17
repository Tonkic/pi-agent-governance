'use strict';
const $ = (id) => document.getElementById(id);
let snapshot = null, busy = false, edited = false;
let projectSnapshot = null, editingItem = null, draggedItem = null;
const dirtyForms = new Set();
let launchContext = null, launchModels = [], launchSessions = [], launchModelsReady = false, launchLoading = false, launchRequest = 0;
let workspaceEpoch = 0, loadRevision = 0, observedWorkspace = null;
const retainedDrafts = new Map();
const impactLabel = (value) => value === 'affects' ? 'impactAffects' : value === 'none' ? 'impactNone' : 'impactUnassessed';
function discardWarning(submitted) {
    const names = {
        'progress-form': t('draftProgress'),
        'start-form': t('draftTask'),
        'workitem-form': t('draftItem'),
        'design-begin-form': t('designTitle'),
        'design-confirm-form': t('designReview')
    };
    const drafts = [...dirtyForms].filter((id) => id !== submitted).map((id) => names[id] || id);
    return drafts.length ? t('discard', drafts.join(' / ')) : '';
}
const boardStages = ['todo', 'doing', 'done'];
// Old snapshots remain readable without migrating their persisted record.
const effectiveStage = (item) => item.stage === 'accepted' ? 'done' : item.stage;
// Dates are display-only: never synthesize completion from the board update time.
function completedDate(item) {
    const timestamp = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
    if (timestamp(item.completedAt))
        return { value: item.completedAt, time: Date.parse(item.completedAt), legacy: false };
    if (timestamp(item.acceptance?.at))
        return { value: item.acceptance.at, time: Date.parse(item.acceptance.at), legacy: true };
    return null;
}
function completedItems(items) {
    return items.filter(item => effectiveStage(item) === 'done')
        .map((item, index) => ({ item, index, date: completedDate(item) }))
        .sort((a, b) => (b.date?.time ?? -Infinity) - (a.date?.time ?? -Infinity) || a.index - b.index)
        .map(entry => entry.item);
}
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
        .querySelectorAll('main button, main input, main textarea, #item-sheet button, #item-sheet input, #item-sheet textarea, #item-sheet select, .action-dialog button, .action-dialog input, .action-dialog textarea, .action-dialog select')
        .forEach((el) => {
        el.disabled = value;
    });
    $('workitem-blocker').disabled = value || !editingItem;
    for (const id of ['workitem-save', 'item-edit', 'initialize'])
        $(id).disabled = value || !snapshot || !navigator.onLine;
    $('initialize-workspace').disabled = value || !snapshot || !navigator.onLine;
    $('architecture-check').disabled = value || !projectSnapshot?.architecture || !navigator.onLine;
    document
        .querySelectorAll('#project-dialog button[type="submit"]')
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
    for (const id of ['analysis-start', 'architecture-analyze', 'documentation-start'])
        $(id).disabled = value || !snapshot?.state?.task || !projectSnapshot || !navigator.onLine;
    document.querySelectorAll('[data-operation-write]').forEach((button) => {
        button.disabled = value || !navigator.onLine;
    });
    // History is a local, read-only view and remains usable while writes are locked/offline.
    const historyButton = $('completed-history-open');
    if (historyButton)
        historyButton.disabled = !projectSnapshot?.board || !!projectSnapshot.boardError;
    if ($('workitem-form').hidden && !dirtyForms.has('workitem-form')) {
        $('item-back').disabled = $('item-close').disabled = false;
    }
    updateLaunchControls();
    updateItemNavigation();
    updateDesignControls();
}
async function invoke(channel, payload = {}) {
    if (!window.pluginBridge?.invoke)
        throw Error(t('staticPreview'));
    const owner = workspaceEpoch;
    const bound = channel !== 'governance.snapshot' && snapshot?.workspace;
    let response;
    try {
        response = await window.pluginBridge.invoke(channel, { ...payload, ...(bound ? { workspace: bound } : {}) });
    }
    catch (error) {
        if (owner !== workspaceEpoch)
            throw Object.assign(Error(t('switched')), { stale: true });
        throw error;
    }
    if (owner !== workspaceEpoch)
        throw Object.assign(Error(t('switched')), { stale: true });
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
// Read-only projections of already loaded snapshots. Never infer missing counts or dates.
function renderWorkbenchSummary(loading = false) {
    const workspace = snapshot?.workspace;
    text('summary-workspace-name', workspace ? workspace.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || workspace : '—');
    text('summary-workspace-path', workspace || '—');
    text('summary-state', snapshot ? (snapshot.state ? labels[snapshot.state.status] || snapshot.state.status : t('uninitialized')) : '—');
    text('summary-task', snapshot?.state?.task || (snapshot ? t('noTask') : '—'));
    const items = projectSnapshot?.board && !projectSnapshot.boardError ? projectSnapshot.board.items : null;
    const counts = items ? boardStages.map(stage => items.filter(item => effectiveStage(item) === stage).length) : null;
    const total = items?.length;
    const percent = counts && total ? Math.round(counts[2] / total * 100) : counts ? 0 : null;
    for (const [id, value] of [
        ['summary-total', total], ['summary-doing', counts?.[1]], ['summary-done', counts?.[2]],
        ['summary-impact', items?.filter(item => item.architectureImpact === 'affects').length],
        ['summary-todo', counts?.[0]], ['summary-doing-count', counts?.[1]], ['summary-done-count', counts?.[2]]
    ])
        text(id, value == null ? '—' : String(value));
    text('summary-percent', percent == null ? '—' : `${percent}%`);
    $('summary-ring').style.setProperty('--completion', `${percent ?? 0}%`);
    $('summary-ring').setAttribute('aria-label', percent == null ? t('summaryUnavailable') : t('summaryRatio', percent, counts[2], total));
    text('summary-availability', loading ? t('reading') : !items ? t('summaryUnavailable') : !navigator.onLine ? t('summaryOffline') : !total ? t('summaryEmpty') : t('summaryLoaded'));
    $('workbench-metrics').setAttribute('aria-busy', String(loading));
}
function render(data) {
    snapshot = data;
    observedWorkspace = data.workspace;
    $('initialize-workspace').hidden = !!data.state;
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
    renderWorkbenchSummary(true);
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
async function load(checkSources = false) {
    const owner = workspaceEpoch, request = ++loadRevision;
    const current = () => owner === workspaceEpoch && request === loadRevision;
    snapshot = null;
    resetDesign();
    $('initialize-workspace').hidden = true;
    dirtyForms.clear();
    launchRequest++;
    launchContext = null;
    clearLaunchChoices();
    if ($('launch-dialog').open)
        $('launch-dialog').close();
    resetCompletedHistory(false);
    projectSnapshot = null;
    renderWorkbenchSummary(true);
    resetWorkitem();
    $('workitem-form').hidden = true;
    if ($('item-sheet').open)
        $('item-sheet').close();
    closeItemMenu(false);
    stopLongPress();
    draggedItem = null;
    longPressConsumed = null;
    $('architecture-reminder').hidden = true;
    renderProjectGraph();
    $('board-empty').hidden = true;
    $('board-section').setAttribute('aria-busy', 'true');
    $('board-columns').replaceChildren();
    text('board-status', t('boardLoading'));
    text('git-summary', t('gitLoading'));
    $('git-tasks').replaceChildren();
    notify(t('workspaceLoading'));
    try {
        const data = await invoke('governance.snapshot');
        if (!current())
            return;
        render(data);
        text('updated', t('updated', new Date().toLocaleTimeString(locale)));
        notify(t('synced'));
    }
    catch (error) {
        if (!current())
            return;
        notify(error.message, true);
        for (const id of ['uninitialized', 'start-form', 'progress-form'])
            $(id).hidden = true;
        text('workspace', t('disconnected'));
    }
    if (snapshot) {
        try {
            const data = await invoke('governance.project', { checkSources });
            if (!current())
                return;
            if (data.workspace !== snapshot.workspace)
                throw Error(t('switched'));
            projectSnapshot = data;
            if (data.boardError)
                notify(t('boardError', data.boardError), true);
            renderBoard();
        }
        catch (error) {
            if (!current())
                return;
            text('board-status', t('boardReadError', error.message));
            notify(t('boardReadError', error.message), true);
        }
    }
    else
        text('board-status', t('boardDisconnected'));
    if (snapshot && current())
        await loadDesign(owner, current);
    if (!current())
        return;
    renderProjectGraph();
    if (busy)
        lock(true);
    try {
        const data = await invoke('governance.git');
        if (!current())
            return;
        renderGit(data);
    }
    catch (error) {
        if (!current())
            return;
        text('git-summary', t('gitError', error.message));
    }
    if (current()) {
        $('board-section').setAttribute('aria-busy', 'false');
        renderWorkbenchSummary();
    }
}
function confirmWrite(description) {
    const owner = workspaceEpoch;
    const dialog = $('confirm-dialog');
    text('confirm-description', description);
    text('confirm-workspace', snapshot?.workspace || '');
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => dialog.addEventListener('close', () => resolve(owner === workspaceEpoch && dialog.returnValue === 'confirm'), {
        once: true
    }));
}
async function mutate(args, description) {
    if (busy || !snapshot)
        return;
    const owner = workspaceEpoch, revision = snapshot.revision;
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
        if (owner !== workspaceEpoch)
            return;
        await invoke('governance.mutate', { args, revision, confirmed: true });
        await load();
    }
    catch (error) {
        if (owner !== workspaceEpoch)
            return;
        notify(t('noRetry', error.message), true);
    }
    finally {
        if (owner === workspaceEpoch)
            lock(false);
    }
}
$('refresh').addEventListener('click', async () => {
    if (busy)
        return;
    const owner = workspaceEpoch;
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
        if (owner === workspaceEpoch)
            lock(false);
    }
});
for (const form of document.querySelectorAll('main form, #project-dialog form, #workitem-form, #design-begin-form, #design-confirm-form'))
    form.addEventListener('input', () => {
        edited = true;
        dirtyForms.add(form.id);
    });
$('initialize').addEventListener('click', () => mutate({ action: 'init' }, t('initConfirm')));
$('initialize-workspace').addEventListener('click', () => mutate({ action: 'init' }, t('initConfirm')));
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
    text('graph-check-state', '');
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
    else if (graphView === 'design') {
        const view = designGraphView();
        graph = view.graph;
        message = view.message;
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
        text('graph-check-state', graph ? (graph.sourcesChecked ? t('sourcesChecked', graph.checkedAt) : t('sourcesUnchecked', graph.updatedAt)) : '');
        text('graph-warning', stale.length ? t('stale', stale.join(' / ')) : '');
        $('graph-warning').hidden = !stale.length;
    }
    text('graph-empty', message);
    $('graph-empty').hidden = !message;
    text('graph-count', t('graphCount', graph?.nodes?.length || 0, graph?.edges?.length || 0));
    $('show-architecture').setAttribute('aria-pressed', String(graphView === 'architecture'));
    $('show-workflow').setAttribute('aria-pressed', String(graphView === 'workflow'));
    renderDesign();
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
    document.querySelectorAll('[data-page-control]').forEach((control) => {
        control.hidden = control.dataset.pageControl !== active;
    });
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
$('nav-behaviors').addEventListener('click', () => $('behavior-docs-open').click());
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
let historyQuery = '', historyOwner = -1, historyOrigin = null;
let historyItemIds = null;
function resetCompletedHistory(resetSearch = true) {
    historyOwner = -1;
    historyItemIds = null;
    historyOrigin = null;
    if ($('completed-history-dialog').open)
        $('completed-history-dialog').close('cancel');
    $('completed-history-body').replaceChildren();
    if (resetSearch)
        historyQuery = $('completed-history-search').value = '';
}
function closeCompletedHistory(restore = true) {
    const valid = historyOwner === workspaceEpoch;
    $('completed-history-dialog').close();
    if (restore && valid)
        (historyOrigin?.isConnected ? historyOrigin : $('completed-history-open'))?.focus();
}
function renderCompletedHistory() {
    if (historyOwner !== workspaceEpoch || !projectSnapshot?.board || projectSnapshot.boardError)
        return;
    const all = completedItems(projectSnapshot.board.items);
    const items = all.filter(item => !historyQuery || [item.id, item.title, item.description,
        ...(item.criteria || []), t(impactLabel(item.architectureImpact)), completedDate(item)?.value]
        .some(value => value?.toLocaleLowerCase().includes(historyQuery)));
    text('completed-history-status', t('historyCount', items.length, all.length));
    $('completed-history-empty').hidden = items.length > 0;
    $('completed-history-body').replaceChildren(...items.map(item => {
        const row = document.createElement('tr');
        row.dataset.historyItem = item.id;
        const date = completedDate(item);
        const values = [item.title, date ? `${date.value}${date.legacy ? ' · ' + t('historicalDate') : ''}` : t('dateUnrecorded'),
            `${t('count', item.criteria?.length || 0)} · ${(item.criteria || []).join(' / ') || t('none')}`,
            t(impactLabel(item.architectureImpact))];
        for (const value of values) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
        }
        const action = document.createElement('td'), button = document.createElement('button');
        button.type = 'button';
        button.textContent = t('itemDetails');
        button.setAttribute('aria-label', t('historyDetailsFor', item.title));
        button.addEventListener('click', () => {
            if (historyOwner !== workspaceEpoch)
                return;
            historyItemIds = items.map(entry => entry.id);
            closeCompletedHistory(false);
            // The row is in a closed dialog: restore to the connected board opener, not the row.
            void openItem(item.id, false, $('completed-history-open') || historyOrigin);
        });
        action.append(button);
        row.append(action);
        return row;
    }));
}
function openCompletedHistory(origin) {
    if (!projectSnapshot?.board || projectSnapshot.boardError || document.querySelector('dialog[open]'))
        return;
    closeItemMenu(false);
    historyOwner = workspaceEpoch;
    historyOrigin = origin;
    historyItemIds = null;
    renderCompletedHistory();
    $('completed-history-dialog').showModal();
    $('completed-history-search').focus();
}
$('completed-history-search').addEventListener('input', () => {
    historyQuery = $('completed-history-search').value.trim().toLocaleLowerCase();
    renderCompletedHistory();
});
$('completed-history-close').addEventListener('click', () => closeCompletedHistory());
$('completed-history-dialog').addEventListener('cancel', event => {
    event.preventDefault();
    closeCompletedHistory();
});
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
async function allowItemSwitch(readOnly = false) {
    const owner = workspaceEpoch;
    if (busy)
        return readOnly && !dirtyForms.has('workitem-form');
    if (!dirtyForms.has('workitem-form'))
        return true;
    lock(true);
    try {
        return !!(await confirmWrite(t('switchDraft')));
    }
    finally {
        if (owner !== workspaceEpoch)
            return false;
        lock(false);
        if ($('item-sheet').open)
            ($('workitem-form').hidden ? $('item-edit') : $('workitem-title')).focus();
    }
}
async function openItem(id = null, edit = false, origin) {
    const owner = workspaceEpoch;
    if (!id &&
        (!snapshot?.state || !projectSnapshot || projectSnapshot.boardError || !navigator.onLine))
        return;
    if (!(await allowItemSwitch(!!id && !edit)) || owner !== workspaceEpoch)
        return;
    const item = id ? itemById(id) : null;
    if (id && !item)
        return;
    if (origin?.closest('[data-workitem]') || !id)
        historyItemIds = null;
    resetWorkitem();
    closeItemMenu(false);
    selectedItem = id;
    itemOrigin = origin || document.activeElement;
    $('item-guidance').hidden = true;
    $('item-read').hidden = !item || edit;
    $('item-checks').hidden = !item || edit;
    text('item-sheet-title', item ? item.title : t('newItem'));
    text('item-sheet-meta', item ? boardLabels[effectiveStage(item)] : t('newItem'));
    text('item-impact', `${t('architectureImpact')}: ${t(impactLabel(item?.architectureImpact))}`);
    if (item) {
        text('item-description', item.description || t('noDescription'));
        text('item-blocker', item.blocker);
        $('item-blocker').hidden = !item.blocker;
        text('item-record-id', item.id);
        text('item-record-task', item.taskId || t('none'));
        text('item-record-git', item.gitTaskId || t('none'));
        list('item-criteria', item.criteria);
        const r = item.acceptance;
        $('item-history').hidden = !r;
        $('item-history').open = false;
        text('item-review-record', r
            ? t('reviewRecord', t(r.method === 'human' ? 'legacyHuman' : 'legacyAgent'), r.reviewer, t(r.valid ? 'reviewValid' : 'reviewInvalid'), r.at, r.conclusion, r.evidence)
            : '');
    }
    if (edit || !item) {
        editingItem = item?.id || null;
        $('workitem-id').value = item?.id || `item-${crypto.randomUUID().slice(0, 8)}`;
        $('workitem-title').value = item?.title || '';
        $('workitem-description').value = item?.description || '';
        $('workitem-criteria').value = (item?.criteria || []).join('\n');
        $('workitem-impact').value = item?.architectureImpact || 'unassessed';
        $('workitem-blocker').value = item?.blocker || '';
        $('workitem-blocker').disabled = !item;
        $('blocker-field').hidden = !item;
        $('workitem-form').hidden = false;
        text('workitem-save', t(item ? 'saveChanges' : 'createItem'));
    }
    if (!$('item-sheet').open)
        $('item-sheet').showModal();
    (edit || !item ? $('workitem-title') : $('item-edit')).focus();
    lock(busy);
    if (!edit && item && !navigator.onLine)
        $('item-back').focus();
    updateItemNavigation();
    return true;
}
async function closeItemSheet() {
    if (!(await allowItemSwitch(true)))
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
    const owner = workspaceEpoch;
    lock(true);
    try {
        if (!(await confirmWrite(t('itemConfirm', args.id, args.stage ? ` → ${boardLabels[args.stage]}` : '') +
            discardWarning(args.action === 'board_move' ? undefined : 'workitem-form'))))
            return;
        if (owner !== workspaceEpoch)
            return;
        if (!navigator.onLine) {
            notify(t('offlineNotice'), true);
            return;
        }
        await invoke('governance.workitem', { args, revision, confirmed: true });
        await load();
        if (owner !== workspaceEpoch)
            return;
        if (projectSnapshot && !projectSnapshot.boardError)
            notify(t('itemSaved'));
        document.querySelector(`[data-workitem="${args.id}"]`)?.focus();
    }
    catch (error) {
        if (owner !== workspaceEpoch)
            return;
        notify(t('itemError', error.message), true);
    }
    finally {
        if (owner === workspaceEpoch)
            lock(false);
    }
}
function moveWorkitem(id, stage, position) {
    return writeWorkitem({ action: 'board_move', id, stage, position });
}
function menuActions(item) {
    const all = projectSnapshot.board.items;
    const stageNow = effectiveStage(item);
    const siblings = all.filter((i) => effectiveStage(i) === stageNow);
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
    if (stageNow !== 'done' && index > 0)
        actions.push({ label: t('moveUp'), run: () => moveWorkitem(item.id, stageNow, index - 1) });
    if (stageNow !== 'done' && index < siblings.length - 1)
        actions.push({ label: t('moveDown'), run: () => moveWorkitem(item.id, stageNow, index + 1) });
    for (const stage of boardStages.filter((s) => Math.abs(boardStages.indexOf(s) - boardStages.indexOf(stageNow)) === 1))
        actions.push({
            label: t('moveTo', boardLabels[stage]),
            run: () => moveWorkitem(item.id, stage, all.filter((i) => effectiveStage(i) === stage).length)
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
    $('agent-brief').value += '\n' + t('checks') + ':\n' + (item.criteria || []).join('\n');
    $('agent-brief').value += '\n' + t('impactGuidance', t(impactLabel(item.architectureImpact)));
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
    renderWorkbenchSummary();
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
    const affected = data.board.items.filter(item => item.taskId === snapshot?.state?.task && item.architectureImpact === 'affects' && effectiveStage(item) === 'done');
    text('architecture-reminder', affected.length ? t('architectureReminder', affected.length) : '');
    $('architecture-reminder').hidden = !affected.length;
    const matches = (item) => !searchQuery ||
        [item.title, item.description, item.blocker, item.id].some((s) => s?.toLocaleLowerCase().includes(searchQuery));
    const matchCount = data.board.items.filter(matches).length;
    text('board-status', searchQuery ? t('searchCount', matchCount) : '');
    $('board-empty').hidden = !searchQuery || matchCount > 0;
    for (const stage of boardStages) {
        const column = document.createElement('section');
        column.className = 'board-column';
        column.dataset.stage = stage;
        const all = data.board.items.filter((item) => effectiveStage(item) === stage);
        const matched = (stage === 'done' ? completedItems(all) : all).filter(matches);
        const items = stage === 'done' && !searchQuery ? matched.slice(0, 5) : matched;
        const header = document.createElement('header');
        const heading = document.createElement('h3');
        heading.textContent = boardLabels[stage];
        const count = document.createElement('span');
        count.className = 'column-count';
        count.textContent = String(stage === 'done' ? all.length : items.length);
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
        if (stage === 'done') {
            const summary = document.createElement('p'), history = document.createElement('button');
            summary.className = 'completed-summary';
            summary.textContent = t('recentCompleted', items.length, all.length);
            history.type = 'button';
            history.id = 'completed-history-open';
            history.textContent = t('viewAllCompleted', all.length);
            history.setAttribute('aria-haspopup', 'dialog');
            history.addEventListener('click', () => openCompletedHistory(history));
            const hint = document.createElement('p');
            hint.className = 'completed-summary';
            hint.textContent = t('completedDragHint');
            column.append(summary, history, hint);
        }
        column.addEventListener('dragover', (event) => {
            if (draggedItem && !busy && !searchQuery && navigator.onLine && !(stage === 'done' && effectiveStage(itemById(draggedItem)) === 'done')) {
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
            if (!id || busy || searchQuery || !navigator.onLine)
                return;
            // Recent completion order is not persisted order. Never reorder done against hidden cards.
            if (stage === 'done') {
                if (effectiveStage(itemById(id)) !== 'done')
                    void moveWorkitem(id, stage, all.length);
                return;
            }
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
            status.textContent = item.blocker ? t('blocked') : boardLabels[effectiveStage(item)];
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
            const tag = document.createElement('span');
            tag.className = 'architecture-tag';
            tag.dataset.impact = item.architectureImpact || 'unassessed';
            tag.textContent = t(impactLabel(item.architectureImpact));
            card.append(tag);
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
function displayedItemIds() {
    if (historyItemIds)
        return historyItemIds.filter(id => !!itemById(id));
    return Array.from(document.querySelectorAll('[data-workitem]')).map((card) => card.dataset.workitem);
}
function updateItemNavigation() {
    const ids = displayedItemIds(), index = ids.indexOf(selectedItem);
    $('item-previous').disabled = busy || index <= 0;
    $('item-next').disabled = busy || index < 0 || index >= ids.length - 1;
}
async function browseItem(direction) {
    if (busy)
        return;
    const ids = displayedItemIds(), index = ids.indexOf(selectedItem), id = ids[index + direction];
    if (index < 0 || !id)
        return;
    await openItem(id, false, historyItemIds ? $('completed-history-open') : document.querySelector(`[data-workitem="${id}"]`));
}
$('item-previous').addEventListener('click', () => {
    void browseItem(-1);
});
$('item-next').addEventListener('click', () => {
    void browseItem(1);
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
        !['project-dialog', 'operations-dialog', 'launch-dialog'].some((id) => $(id).open) &&
        $('item-menu').hidden) {
        event.preventDefault();
        void closeItemSheet();
        return;
    }
    if (event.key === '/' &&
        !event.target.closest('input, textarea, [contenteditable]') &&
        !$('item-sheet').open &&
        !$('completed-history-dialog').open &&
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
        architectureImpact: $('workitem-impact').value,
        ...(editingItem ? { blocker: $('workitem-blocker').value } : {})
    });
});
lock(true);
localeReady
    .then(async () => {
    const owner = workspaceEpoch;
    highlightNavigation();
    appearance(lastAppearance);
    await load();
    if (owner === workspaceEpoch)
        lock(false);
});
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
const operationLabel = (kind) => kind === 'design' ? 'designTask' :
    kind === 'architecture'
        ? 'architectureTask'
        : kind === 'acceptance'
            ? 'legacyAcceptanceTask'
            : kind === 'documentation'
                ? 'documentationTask'
                : 'analysis';
function launchOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
}
function selectedLaunchSession() {
    return launchSessions.find(row => 'existing:' + row.id === $('launch-session').value);
}
function updateLaunchControls() {
    const isNew = $('launch-session').value === 'new';
    $('launch-new-settings').hidden = !isNew;
    $('launch-session').disabled = busy || !launchContext;
    $('launch-start').disabled = busy || launchLoading || !launchContext || !navigator.onLine ||
        (isNew ? !launchModelsReady : !selectedLaunchSession());
    $('launch-model').disabled = busy || launchLoading || !isNew || !launchModelsReady;
    const model = launchModels.find((row) => row.key === $('launch-model').value);
    $('launch-thinking').disabled = $('launch-model').disabled || !model?.thinkingLevels.length;
}
function clearLaunchChoices() {
    launchSessions = [];
    launchModels = [];
    launchModelsReady = false;
    launchLoading = false;
    $('launch-session').replaceChildren(launchOption('', t('sessionPlaceholder')), launchOption('new', t('newSession')));
    $('launch-model').replaceChildren(launchOption('', t('hostDefault')));
    $('launch-thinking').replaceChildren(launchOption('', t('hostDefault')));
    $('launch-new-settings').hidden = true;
}
async function loadLaunchChoices(isNew = false) {
    const request = ++launchRequest;
    launchLoading = true;
    launchModelsReady = false;
    text('launch-status', t(isNew ? 'modelsLoading' : 'sessionsLoading'));
    updateLaunchControls();
    try {
        const data = await invoke('governance.operation', { action: isNew ? 'models' : 'sessions' });
        if (request !== launchRequest || !launchContext || !$('launch-dialog').open)
            return;
        if (data.workspace !== launchContext.workspace)
            throw Error(t('switched'));
        if (isNew) {
            if (!Array.isArray(data.models))
                throw Error(t('noModels'));
            launchModels = data.models;
            launchModelsReady = true;
            $('launch-model').replaceChildren(launchOption('', t('hostDefault')), ...launchModels.map(row => launchOption(row.key, `${row.providerName} · ${row.label}`)));
            updateThinkingChoices();
        }
        else {
            if (!Array.isArray(data.sessions) || data.sessions.some(row => !row || typeof row.id !== 'string' || !row.id || typeof row.title !== 'string') ||
                new Set(data.sessions.map(row => row.id)).size !== data.sessions.length)
                throw Error(t('noSessions'));
            launchSessions = data.sessions;
            $('launch-session').replaceChildren(launchOption('', t('sessionPlaceholder')), ...launchSessions.map(row => launchOption('existing:' + row.id, row.title)), launchOption('new', t('newSession')));
            if (launchSessions.length === 1)
                $('launch-session').value = 'existing:' + launchSessions[0].id;
            text('launch-status', t(launchSessions.length ? 'sessionsReady' : 'noSessions'));
        }
    }
    catch (error) {
        if (request !== launchRequest || !launchContext)
            return;
        if (isNew)
            launchModelsReady = false;
        text('launch-status', t(isNew ? 'modelOptionsError' : 'sessionsError', error.message));
    }
    finally {
        if (request === launchRequest) {
            launchLoading = false;
            updateLaunchControls();
        }
    }
}
function updateThinkingChoices() {
    const model = launchModels.find((row) => row.key === $('launch-model').value);
    $('launch-thinking').replaceChildren(launchOption('', t('hostDefault')), ...(model?.thinkingLevels || []).map((level) => launchOption(level, t(('thinking_' + level)))));
    text('launch-status', model && !model.thinkingLevels.length
        ? t('noThinking')
        : launchModels.length
            ? t('modelOptionsReady')
            : t('noModels'));
    updateLaunchControls();
}
function closeLaunch() {
    if (busy)
        return;
    launchRequest++;
    launchContext = null;
    clearLaunchChoices();
    $('launch-dialog').close();
    updateLaunchControls();
}
async function startOperation(kind) {
    if (!['analysis', 'architecture', 'documentation', 'design'].includes(kind))
        return;
    if (busy || !projectSnapshot || !snapshot?.state?.task || !navigator.onLine)
        return;
    if ($('launch-dialog').open)
        return;
    if (kind === 'design' && (!designSnapshot?.draft || designSnapshot.error || designSnapshot.draft.taskId !== snapshot.state.task))
        return;
    launchRequest++;
    launchContext = {
        kind,
        ...(kind === 'design' ? { designRevision: designSnapshot.revision } : {}),
        revision: projectSnapshot.revision,
        workspace: snapshot.workspace
    };
    clearLaunchChoices();
    text('launch-title', `${t('launchSettings')} · ${t(operationLabel(kind))}`);
    text('launch-scope', snapshot.workspace);
    text('launch-status', t('sessionsLoading'));
    $('launch-dialog').showModal();
    updateLaunchControls();
    $('launch-cancel').focus();
    await loadLaunchChoices();
}
$('launch-session').addEventListener('change', () => {
    launchRequest++;
    launchLoading = false;
    launchModels = [];
    launchModelsReady = false;
    $('launch-model').replaceChildren(launchOption('', t('hostDefault')));
    $('launch-thinking').replaceChildren(launchOption('', t('hostDefault')));
    if ($('launch-session').value === 'new')
        void loadLaunchChoices(true);
    else if (!launchSessions.length)
        void loadLaunchChoices();
    else {
        text('launch-status', t('sessionsReady'));
        updateLaunchControls();
    }
});
$('launch-model').addEventListener('change', updateThinkingChoices);
for (const id of ['launch-close', 'launch-cancel'])
    $(id).addEventListener('click', closeLaunch);
$('launch-dialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeLaunch();
});
$('launch-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || launchLoading || !launchContext || !navigator.onLine)
        return;
    const session = selectedLaunchSession();
    const isNew = $('launch-session').value === 'new';
    if (isNew ? !launchModelsReady : !session)
        return;
    const owner = workspaceEpoch;
    const context = { ...launchContext };
    const modelKey = $('launch-model').value, thinkingLevel = $('launch-thinking').disabled ? '' : $('launch-thinking').value;
    const model = launchModels.find((row) => row.key === modelKey);
    if (isNew && modelKey && !model)
        return;
    lock(true);
    try {
        const selectionLabel = !isNew ? t('existingSelection', session.title) : t('launchSelection', model ? `${model.providerName} · ${model.label}` : t('hostDefault'), thinkingLevel ? t(('thinking_' + thinkingLevel)) : t('hostDefault'));
        if (!(await confirmWrite(t('operationConfirm', t(operationLabel(context.kind))) + '\n' + selectionLabel)))
            return;
        if (owner !== workspaceEpoch)
            return;
        if (!navigator.onLine) {
            notify(t('offlineNotice'), true);
            return;
        }
        await invoke('governance.operation', {
            action: 'start',
            ...context,
            ...(isNew ? { sessionMode: 'new', ...(modelKey ? { modelKey } : {}), ...(thinkingLevel ? { thinkingLevel } : {}) }
                : { sessionMode: 'existing', sessionId: session.id }),
            confirmed: true
        });
        if (owner !== workspaceEpoch)
            return;
        launchRequest++;
        launchContext = null;
        clearLaunchChoices();
        $('launch-dialog').close();
        notify(t('operationStarted'));
        if (!$('operations-dialog').open)
            $('operations-dialog').showModal();
        await loadOperations();
    }
    catch (error) {
        if (owner !== workspaceEpoch)
            return;
        text('launch-status', t('operationError', error.message));
        notify(t('operationError', error.message), true);
    }
    finally {
        if (owner !== workspaceEpoch)
            return;
        lock(false);
        if ($('launch-dialog').open)
            ($('launch-start').disabled ? $('launch-cancel') : $('launch-start')).focus();
    }
});
async function operationAction(action, id) {
    const write = ['cancel', 'resolve'].includes(action);
    const offlineWrite = () => {
        if (!write || navigator.onLine)
            return false;
        notify(t('offlineNotice'), true);
        return true;
    };
    if (busy || offlineWrite())
        return;
    const owner = workspaceEpoch;
    lock(true);
    try {
        if (write &&
            !(await confirmWrite(t(action === 'resolve' ? 'resolveOperationConfirm' : 'operationCancelConfirm'))))
            return;
        if (owner !== workspaceEpoch || offlineWrite())
            return;
        const data = await invoke('governance.operation', {
            action,
            id,
            confirmed: write
        });
        if (action === 'status')
            text('operation-result', JSON.stringify({ phase: data.run.phase, runtime: data.runtime, session: data.session }, null, 2).slice(0, 20000));
        await loadOperations();
    }
    catch (error) {
        if (owner !== workspaceEpoch)
            return;
        text('operations-notice', t('operationError', error.message));
    }
    finally {
        if (owner === workspaceEpoch)
            lock(false);
    }
}
async function loadOperations() {
    const owner = workspaceEpoch;
    try {
        const data = await invoke('governance.operation', { action: 'list' });
        if (owner !== workspaceEpoch)
            return;
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
            note.textContent = `${run.updatedAt} · ${run.modelKey || t('hostDefault')} · ${run.thinkingLevel ? t(('thinking_' + run.thinkingLevel)) : t('hostDefault')}${run.error ? ' · ' + run.error : ''}`;
            if (run.sessionMode === 'existing')
                note.textContent += ' · ' + t('existingStop');
            row.append(heading, note);
            if (run.sessionId)
                for (const [key, action] of [
                    ['inspectResult', 'status'],
                    ['openSession', 'open'],
                    ...(run.sessionMode !== 'existing' && ['creating', 'created', 'running', 'unknown'].includes(run.phase)
                        ? [['cancelOperation', 'cancel']]
                        : [])
                ]) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.textContent = t(key);
                    if (action === 'cancel')
                        button.dataset.operationWrite = 'true';
                    button.disabled = busy || (action === 'cancel' && !navigator.onLine);
                    button.addEventListener('click', () => {
                        void operationAction(action, run.id);
                    });
                    row.append(button);
                }
            if ((!run.sessionId && ['creating', 'created', 'unknown'].includes(run.phase)) ||
                (run.sessionMode === 'existing' && ['created', 'unknown'].includes(run.phase))) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = t('resolveOperation');
                button.dataset.operationWrite = 'true';
                button.disabled = busy || !navigator.onLine;
                button.addEventListener('click', () => {
                    void operationAction('resolve', run.id);
                });
                row.append(button);
            }
            $('operation-runs').append(row);
        }
    }
    catch (error) {
        if (owner !== workspaceEpoch)
            return;
        text('operations-notice', t('operationError', error.message));
    }
}
$('documentation-start').addEventListener('click', () => {
    void startOperation('documentation');
});
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
function retainWorkspaceDrafts() {
    if (!snapshot?.workspace || !dirtyForms.size)
        return false;
    const previous = retainedDrafts.get(snapshot.workspace);
    const forms = { ...(previous?.forms || {}) };
    for (const id of dirtyForms) {
        forms[id] = Array.from($(id).querySelectorAll('input, textarea, select')).map((el, index) => ({
            id: el.id || String(index), value: el.value, ...(el.type === 'checkbox' ? { checked: el.checked } : {})
        }));
    }
    retainedDrafts.set(snapshot.workspace, { workspace: snapshot.workspace, task: snapshot.state?.task || null,
        itemId: editingItem || selectedItem, at: new Date().toISOString(), forms });
    return true;
}
window.pluginBridge?.on?.('workspace:changed', (workspace) => {
    const next = workspace && typeof workspace === 'object' && 'path' in workspace && typeof workspace.path === 'string' ? workspace.path : null;
    if (next && next === observedWorkspace && snapshot?.workspace === next)
        return;
    const retained = retainWorkspaceDrafts();
    const owner = ++workspaceEpoch;
    loadRevision++;
    observedWorkspace = next;
    // Closing a confirmation resolves false under the new epoch. Never send its old intent.
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close('cancel'));
    launchRequest++;
    launchContext = null;
    clearLaunchChoices();
    selectedItem = editingItem = null;
    searchQuery = '';
    $('board-search').value = '';
    resetCompletedHistory();
    itemOrigin = menuOrigin = null;
    text('operation-result', '');
    $('operation-runs').replaceChildren();
    $('agent-brief').value = '';
    $('workspace-drafts').hidden = !retainedDrafts.size;
    $('workspace-switch-notice').hidden = !retained;
    text('workspace-switch-notice', retained ? t('draftsRetained') : '');
    text('workspace', next || t('disconnected'));
    lock(true);
    void load().finally(() => { if (owner === workspaceEpoch)
        lock(false); });
});
$('workspace-drafts').addEventListener('click', () => {
    if (busy)
        return;
    $('workspace-drafts-text').value = JSON.stringify([...retainedDrafts.values()], null, 2);
    $('workspace-drafts-dialog').showModal();
    $('workspace-drafts-text').focus();
});
$('workspace-drafts-close').addEventListener('click', () => $('workspace-drafts-dialog').close());
$('architecture-check').addEventListener('click', async () => {
    if (busy || !snapshot || !projectSnapshot?.architecture || !navigator.onLine)
        return;
    const owner = workspaceEpoch;
    lock(true);
    try {
        const data = await invoke('governance.project', { checkSources: true });
        if (owner !== workspaceEpoch)
            return;
        if (data.workspace !== snapshot.workspace)
            throw Error(t('switched'));
        projectSnapshot = data;
        renderBoard();
        renderProjectGraph();
    }
    catch (error) {
        if (owner === workspaceEpoch)
            notify(error.message, true);
    }
    finally {
        if (owner === workspaceEpoch)
            lock(false);
    }
});
$('behavior-docs-open').addEventListener('click', async () => {
    if (busy || !snapshot)
        return;
    const owner = workspaceEpoch;
    lock(true);
    $('behavior-docs-content').replaceChildren();
    text('behavior-docs-status', t('waiting'));
    $('behavior-docs-dialog').showModal();
    try {
        const data = await invoke('governance.behaviors');
        if (owner !== workspaceEpoch)
            return;
        if (data.workspace !== snapshot.workspace)
            throw Error(t('switched'));
        text('behavior-docs-status', data.behaviors.length ? '' : t('behaviorEmpty'));
        const statusKeys = { passed: 'behaviorPassed', unverified: 'behaviorUnverified', stale: 'behaviorStale', incomplete: 'behaviorIncomplete', failed: 'behaviorFailed', checking: 'behaviorChecking' };
        for (const item of data.behaviors) {
            const article = document.createElement('article');
            article.className = 'behavior-document';
            const title = document.createElement('h3');
            title.textContent = `${item.id} · ${item.title}`;
            const prose = document.createElement('p');
            prose.className = 'behavior-prose';
            prose.textContent = item.prose;
            const status = document.createElement('p');
            status.className = 'behavior-status';
            status.dataset.result = item.status;
            status.textContent = t((statusKeys[item.status] || 'behaviorUnverified'));
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = t('behaviorDetails');
            const evidence = document.createElement('pre');
            evidence.textContent = JSON.stringify({ document: item.document, cases: item.cases, sources: item.files }, null, 2);
            details.append(summary, evidence);
            if (item.sourceCommit) {
                const meta = document.createElement('p');
                meta.textContent = t('behaviorCommit', item.sourceCommit, t(item.workingTree ? 'behaviorDirty' : 'behaviorClean'), item.at);
                details.append(meta);
            }
            article.append(title, prose, status, details);
            $('behavior-docs-content').append(article);
        }
    }
    catch (error) {
        if (owner === workspaceEpoch)
            text('behavior-docs-status', error.message);
    }
    finally {
        if (owner === workspaceEpoch) {
            lock(false);
            if ($('behavior-docs-dialog').open)
                $('behavior-docs-close').focus();
        }
    }
});
$('behavior-docs-close').addEventListener('click', () => { if (!busy)
    $('behavior-docs-dialog').close(); });
document.querySelectorAll('[data-project-view]').forEach(button => {
    button.addEventListener('click', () => {
        const link = document.querySelector(`.workspace-nav a[href="#${button.dataset.projectView}"]`);
        link.focus();
        link.click();
    });
});
