'use strict';
const $ = (id: string): any => document.getElementById(id);
let snapshot: any = null, busy = false;
let projectSnapshot: any = null;
let workspaceEpoch = 0, loadRevision = 0, observedWorkspace: string = null;
const impactLabel = (value): CopyKey => value === 'affects' ? 'impactAffects' : value === 'none' ? 'impactNone' : 'impactUnassessed';
const boardStages = ['todo', 'doing', 'done'];
// Old snapshots remain readable without migrating their persisted record.
const effectiveStage = (item) => item.stage === 'accepted' ? 'done' : item.stage;
// Dates are display-only: never synthesize completion from the board update time.
function completedDate(item) {
  const timestamp = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  if (timestamp(item.completedAt)) return { value: item.completedAt, time: Date.parse(item.completedAt), legacy: false };
  if (timestamp(item.acceptance?.at)) return { value: item.acceptance.at, time: Date.parse(item.acceptance.at), legacy: true };
  return null;
}
function completedItems(items) {
  return items.filter(item => effectiveStage(item) === 'done')
    .map((item, index) => ({ item, index, date: completedDate(item) }))
    .sort((a, b) => (b.date?.time ?? -Infinity) - (a.date?.time ?? -Infinity) || a.index - b.index)
    .map(entry => entry.item);
}
const boardLabels = new Proxy({}, { get: (_, key: CopyKey) => t(key) });
const labels = new Proxy(
  {},
  { get: (_, key: CopyKey) => (copy[locale][key] ? t(key) : String(key)) }
);
const text = (id, value) => {
  $(id).textContent = value ?? '';
};
function notify(message, error = false) {
  text('notice-message', message);
  $('notice').classList.toggle('error', error);
}
function lock(value) {
  busy = value;
  $('refresh').disabled = value || !navigator.onLine;
  $('architecture-check').disabled = value || !projectSnapshot?.architecture || !navigator.onLine;
  updateItemNavigation();
  updateDesignControls();
  window.dispatchEvent(new Event('documents-controls'));
  window.dispatchEvent(new Event('git-history-context'));
}
async function invoke(channel, payload: any = {}) {
  const allowed = channel === 'governance.snapshot' || channel === 'governance.project' ||
    (channel === 'governance.design' && payload.action === 'snapshot') ||
    (channel === 'governance.documents' && ['list', 'read'].includes(payload.action)) ||
    (channel === 'governance.gitHistory' && ['list', 'detail', 'diff'].includes(payload.action));
  if (!allowed) throw Error(t('readonly'));
  if (!window.pluginBridge?.invoke) throw Error(t('staticPreview'));
  const owner = workspaceEpoch;
  const bound = channel !== 'governance.snapshot' && snapshot?.workspace;
  let response;
  try { response = await window.pluginBridge.invoke(channel, { ...payload, ...(bound ? { workspace: bound } : {}) }); }
  catch (error) { if (owner !== workspaceEpoch) throw Object.assign(Error(t('switched')), { stale: true }); throw error; }
  if (owner !== workspaceEpoch) throw Object.assign(Error(t('switched')), { stale: true });
  if (!response?.ok) throw Error(response?.error || t('invalidResponse'));
  return response.result;
}
function list(id, values) {
  $(id).replaceChildren(
    ...(values?.length ? values : [t('none')]).map((value) => {
      const li = document.createElement('li');
      li.textContent = value;
      return li;
    })
  );
}
function render(data) {
  if (snapshot?.workspace !== data.workspace) closeWorkbenchDisclosures();
  snapshot = data;
  observedWorkspace = data.workspace;
  window.dispatchEvent(new Event('documents-context'));
  const s = data.state;
  const status = s ? labels[s.status] || s.status : t('uninitialized');
  text('workspace', data.workspace);
  text('status', status);
  $('status').dataset.state = s?.status || 'uninitialized';
  renderWorkbenchSummary(true);
}
async function load(checkSources = false) {
  const owner = workspaceEpoch, request = ++loadRevision;
  const current = () => owner === workspaceEpoch && request === loadRevision;
  window.dispatchEvent(new Event('git-history-reset'));
  snapshot = null;
  resetDesign();
  resetCompletedHistory(false);
  projectSnapshot = null;
  renderWorkbenchSummary(true);
  if ($('item-sheet').open) $('item-sheet').close();
  $('architecture-reminder').hidden = true;
  renderProjectGraph();
  $('board-empty').hidden = true;
  $('board-section').setAttribute('aria-busy', 'true');
  $('board-columns').replaceChildren();
  text('board-status', t('boardLoading'));
  notify(t('workspaceLoading'));
  try {
    const data = await invoke('governance.snapshot');
    if (!current()) return;
    render(data);
    text('updated', t('updated', new Date().toLocaleTimeString(locale)));
    notify(t('synced'));
  } catch (error) {
    if (!current()) return;
    notify(error.message, true);
    text('workspace', t('disconnected'));
  }
  if (snapshot) {
    try {
      const data: any = await invoke('governance.project', { checkSources });
      if (!current()) return;
      if (data.workspace !== snapshot.workspace) throw Error(t('switched'));
      projectSnapshot = data;
      if (data.boardError) notify(t('boardError', data.boardError), true);
      renderBoard();
    } catch (error) {
      if (!current()) return;
      text('board-status', t('boardReadError', error.message));
      notify(t('boardReadError', error.message), true);
    }
  } else text('board-status', t('boardDisconnected'));
  if (snapshot && current()) await loadDesign(owner, current);
  if (!current()) return;
  renderProjectGraph();
  if (busy) lock(true);
  if (current()) {
    $('board-section').setAttribute('aria-busy', 'false');
    renderWorkbenchSummary();
  }
}
$('refresh').addEventListener('click', async () => {
  if (busy) return;
  const owner = workspaceEpoch;
  lock(true);
  try {
    await load();
  } finally {
    if (owner === workspaceEpoch) lock(false);
  }
});
let graphView = 'architecture';
function renderProjectGraph() {
  let graph = null,
    message = '';
  const s = snapshot?.state;
  text('graph-warning', '');
  $('graph-warning').hidden = true;
  text('graph-check-state', '');
  if (graphView === 'workflow') {
    text('architecture-title', t('workflow'));
    text('graph-source', t('workflowSource'));
    text('graph-overview', t('workflowOverview'));
    if (!snapshot) message = t('stateError');
    else if (!s) message = t('notInitialized');
    else {
      const phases = ['idle', 'working', 'verified', 'ready'];
      graph = {
        nodes: phases.map((id) => ({
          id,
          title: labels[id],
          current: s.status === id,
          files: ['STATE.json'],
          description:
            id === s.status
              ? t(
                  'phaseDetails',
                  s.current || '',
                  (s.blocked || []).join(' / ') || t('none'),
                  s.verification ? t('recorded') : t('noRecord'),
                  s.followUp ? t('approved', s.followUp.id) : ''
                )
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
  } else if (graphView === 'design') {
    const view = designGraphView(); graph = view.graph; message = view.message;
  } else {
    text('architecture-title', t('architecture'));
    graph = projectSnapshot?.architecture;
    message = projectSnapshot?.architectureError
      ? t('architectureError', projectSnapshot.architectureError)
      : !projectSnapshot
        ? t('graphReadError')
        : !graph
          ? t('noGraph')
          : '';
    text(
      'graph-source',
      graph
        ? t(
            'graphSource',
            graph.title,
            graph.source,
            graph.updatedAt,
            graph.staleFiles?.length ? t('sourceChanged', graph.staleFiles.join(' / ')) : ''
          )
        : t('persistedOnly')
    );
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
initializeWorkbenchShell();
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
let lastAppearance: any = {},
  appearanceRevision = 0;
let paletteMode: 'pebrel' | 'host' = 'pebrel';
try {
  if (localStorage.getItem('governance-palette') === 'host') paletteMode = 'host';
} catch {
  /* Storage can be disabled by the host. */
}
function contributedColors(css: unknown) {
  const colors: Record<string, string> = {};
  if (typeof css !== 'string' || css.length > 256 * 1024) return colors;
  try {
    const sheet = new CSSStyleSheet();
    // Imports and all non-color rules are ignored; this sheet is never adopted.
    sheet.replaceSync(css.replace(/\/\*[\s\S]*?\*\//g, ''));
    const variables: Record<string, string> = {};
    const priorities: Record<string, number> = {};
    for (const rule of Array.from(sheet.cssRules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const selectors = rule.selectorText
        .split(',')
        .map((s) => s.trim())
        .filter(
          (s) =>
            /^:root(?:\[data-(?:theme|plugin-theme)=(?:"[^"\r\n]+"|'[^'\r\n]+'|[\w:-]+)\])*$/.test(
              s
            ) && document.documentElement.matches(s)
        );
      if (!selectors.length) continue;
      const specificity = Math.max(...selectors.map((s) => (s.match(/\[/g) || []).length));
      for (const name of Array.from(rule.style)) {
        const priority =
          specificity + (rule.style.getPropertyPriority(name) === 'important' ? 10000 : 0);
        if (/^--[a-z][a-z0-9-]*$/.test(name) && priority >= (priorities[name] ?? -1)) {
          variables[name] = rule.style.getPropertyValue(name).trim();
          priorities[name] = priority;
        }
      }
    }
    let expansions = 0;
    const resolve = (value: string, seen: string[] = []): string => {
      if (++expansions > 256 || value.length > 2048 || seen.length > 8)
        throw Error('Color alias budget exceeded');
      const result = value.replace(
        /var\((--[a-z][a-z0-9-]*)(?:,\s*([^()]+))?\)/g,
        (_, name, fallback) =>
          seen.includes(name) ? '' : resolve(variables[name] || fallback || '', [...seen, name])
      );
      if (result.length > 2048) throw Error('Color value budget exceeded');
      return result;
    };
    for (const [name, target] of Object.entries(themeColors)) {
      const value = resolve(variables[name] || '');
      // CSS color syntax only; reject URLs, expressions, unresolved vars and declarations.
      if (
        value &&
        !/[;{}@]|url\s*\(|var\s*\(|expression\s*\(/i.test(value) &&
        /^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklab|oklch|lab|lch|color|color-mix)\([\s\S]*\)|[a-z]+)$/i.test(
          value
        ) &&
        !/^(?:inherit|initial|unset|revert|currentcolor|transparent)$/i.test(value) &&
        CSS.supports('color', value)
      ) {
        colors[target] = value;
      }
    }
  } catch {
    /* Unsupported/invalid custom CSS keeps the built-in palette. */
  }
  return colors;
}
const appearance = (value: any = {}) => {
  lastAppearance = value || {};
  // System-media changes update the palette but do not invalidate the initial host read.
  const root = document.documentElement;
  const base =
    value?.base === 'light' || value?.base === 'dark'
      ? value.base
      : systemAppearance.matches
        ? 'dark'
        : 'light';
  root.dataset.base = base;
  root.dataset.theme = base;
  root.dataset.palette = paletteMode;
  text('palette-label', t(paletteMode === 'pebrel' ? 'paletteIndependent' : 'paletteHost'));
  $('palette-toggle').setAttribute('aria-pressed', String(paletteMode === 'pebrel'));
  if (value?.pluginTheme?.id) root.dataset.pluginTheme = String(value.pluginTheme.id);
  else delete root.dataset.pluginTheme;
  for (const target of Object.values(themeColors)) root.style?.removeProperty(target);
  if (paletteMode === 'host' && value?.pluginTheme?.base === base) {
    for (const [target, color] of Object.entries(contributedColors(value.pluginTheme.css)))
      root.style.setProperty(target, color);
  }
};
$('palette-toggle').addEventListener('click', () => {
  paletteMode = paletteMode === 'pebrel' ? 'host' : 'pebrel';
  try {
    localStorage.setItem('governance-palette', paletteMode);
  } catch {
    /* This session still changes when persistence is unavailable. */
  }
  appearance(lastAppearance);
});
appearance();
systemAppearance.addEventListener?.('change', () => {
  if (!['light', 'dark'].includes(lastAppearance.base)) appearance(lastAppearance);
});
window.pluginBridge?.on?.('appearance:changed', (value) => {
  appearanceRevision++;
  appearance(value);
});
const initialAppearanceRevision = appearanceRevision;
window.pluginBridge
  ?.invoke('app.getAppearance')
  .then((value) => {
    if (appearanceRevision === initialAppearanceRevision) appearance(value);
  })
  .catch(() => {});
let selectedItem: string = null,
  itemOrigin: HTMLElement = null,
  searchQuery = '';
let historyQuery = '', historyOwner = -1, historyOrigin: HTMLElement = null;
let historyItemIds: string[] = null;
function resetCompletedHistory(resetSearch = true) {
  historyOwner = -1;
  historyItemIds = null;
  historyOrigin = null;
  if ($('completed-history-dialog').open) $('completed-history-dialog').close('cancel');
  $('completed-history-body').replaceChildren();
  if (resetSearch) historyQuery = $('completed-history-search').value = '';
}
function closeCompletedHistory(restore = true) {
  const valid = historyOwner === workspaceEpoch;
  $('completed-history-dialog').close();
  if (restore && valid) (historyOrigin?.isConnected ? historyOrigin : $('completed-history-open'))?.focus();
}
function renderCompletedHistory() {
  if (historyOwner !== workspaceEpoch || !projectSnapshot?.board || projectSnapshot.boardError) return;
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
      if (historyOwner !== workspaceEpoch) return;
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
function openCompletedHistory(origin: HTMLElement) {
  if (!projectSnapshot?.board || projectSnapshot.boardError || document.querySelector('dialog[open]')) return;
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
function itemById(id) {
  return projectSnapshot?.board?.items.find((item) => item.id === id);
}
async function openItem(id: string, _edit = false, origin?: HTMLElement) {
  const item = itemById(id);
  if (!item) return;
  if (origin?.closest('[data-workitem]')) historyItemIds = null;
  selectedItem = id;
  itemOrigin = origin || (document.activeElement as HTMLElement);
  text('item-sheet-title', item.title);
  text('item-sheet-meta', boardLabels[effectiveStage(item)]);
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
    text(
      'item-review-record',
      r
        ? t(
            'reviewRecord',
            t(r.method === 'human' ? 'legacyHuman' : 'legacyAgent'),
            r.reviewer,
            t(r.valid ? 'reviewValid' : 'reviewInvalid'),
            r.at,
            r.conclusion,
            r.evidence
          )
        : ''
    );
  }
  if (!$('item-sheet').open) $('item-sheet').showModal();
  $('item-back').focus();
  updateItemNavigation();
  return true;
}
async function closeItemSheet() {
  // Closing a read-only detail never needs a save/discard confirmation.
  $('item-sheet').close();
  const target =
    itemOrigin?.isConnected && !itemOrigin.closest('[hidden]')
      ? itemOrigin
      : document.querySelector<HTMLElement>(`[data-workitem="${selectedItem}"]`);
  (target && !target.closest('[hidden]')
    ? target
    : document.querySelector<HTMLElement>('.workspace-nav a[aria-current="page"]') || $('board-search')
  ).focus();
}
function renderBoard() {
  renderWorkbenchSummary();
  const data = projectSnapshot;
  $('board-columns').replaceChildren();
  $('board-empty').hidden = true;
  if (!data || data.boardError) {
    text(
      'board-status',
      data?.boardError ? t('boardError', data.boardError) : t('boardDisconnected')
    );
    return;
  }
  const affected = data.board.items.filter(item => item.taskId === snapshot?.state?.task && item.architectureImpact === 'affects' && effectiveStage(item) === 'done');
  text('architecture-reminder', affected.length ? t('architectureReminder', affected.length) : '');
  $('architecture-reminder').hidden = !affected.length;
  const matches = (item) =>
    !searchQuery ||
    [item.title, item.description, item.blocker, item.id].some((s) =>
      s?.toLocaleLowerCase().includes(searchQuery)
    );
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
    header.append(heading, count);
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
      column.append(summary, history);
    }
    for (const item of items) {
      const card = document.createElement('article');
      card.className = 'workitem';
      card.dataset.workitem = item.id;
      card.dataset.blocked = String(!!item.blocker);
      card.tabIndex = 0;
      card.draggable = false;
      card.setAttribute('aria-label', item.title);
      card.setAttribute('aria-haspopup', 'dialog');
      const title = document.createElement('h4');
      title.textContent = item.title;
      const content = document.createElement('p');
      content.className = 'item-excerpt';
      content.textContent = item.description;
      const meta = document.createElement('div');
      meta.className = 'item-meta';
      const status = document.createElement('span');
      status.textContent = item.blocker ? t('blocked') : boardLabels[effectiveStage(item)];
      meta.append(status);
      card.append(title);
      if (item.description) card.append(content);
      card.append(meta);
      const tag = document.createElement('span');
      tag.className = 'architecture-tag';
      tag.dataset.impact = item.architectureImpact || 'unassessed';
      tag.textContent = t(impactLabel(item.architectureImpact));
      card.append(tag);
      card.addEventListener('click', (event) => {
        if ((event.target as Element).closest('button')) return;
        void openItem(item.id, false, card);
      });
      card.addEventListener('keydown', (event) => {
        if ((event.target as Element).closest('button')) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void openItem(item.id, false, card);
        }
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
$('board-search').addEventListener('input', () => {
  searchQuery = $('board-search').value.trim().toLocaleLowerCase();
  if (projectSnapshot) renderBoard();
});
$('search-clear').addEventListener('click', () => {
  $('board-search').value = '';
  searchQuery = '';
  renderBoard();
  $('board-search').focus();
});
for (const id of ['item-back', 'item-close'])
  $(id).addEventListener('click', () => {
    void closeItemSheet();
  });
function displayedItemIds() {
  if (historyItemIds) return historyItemIds.filter(id => !!itemById(id));
  return Array.from(document.querySelectorAll<HTMLElement>('[data-workitem]')).map(
    (card) => card.dataset.workitem
  );
}
function updateItemNavigation() {
  const ids = displayedItemIds(),
    index = ids.indexOf(selectedItem);
  $('item-previous').disabled = busy || index <= 0;
  $('item-next').disabled = busy || index < 0 || index >= ids.length - 1;
}
async function browseItem(direction) {
  if (busy) return;
  const ids = displayedItemIds(),
    index = ids.indexOf(selectedItem),
    id = ids[index + direction];
  if (index < 0 || !id) return;
  await openItem(id, false, historyItemIds ? $('completed-history-open') : document.querySelector<HTMLElement>(`[data-workitem="${id}"]`));
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
document.addEventListener('keydown', (event) => {
  if (
    event.key === 'Escape' &&
    $('item-sheet').open
  ) {
    event.preventDefault();
    void closeItemSheet();
    return;
  }
  if (
    event.key === '/' &&
    !(event.target as Element).closest('input, textarea, [contenteditable]') &&
    !$('item-sheet').open &&
    !$('completed-history-dialog').open
  ) {
    event.preventDefault();
    location.hash = '#board-section';
    highlightNavigation();
    $('board-search').focus();
  }
});
window.addEventListener('offline', () => {
  notify(t('offlineNotice'), true);
  if (projectSnapshot) renderBoard();
  lock(busy);
});
window.addEventListener('online', () => {
  notify(t('onlineNotice'));
  if (projectSnapshot) renderBoard();
  lock(busy);
});
lock(true);
localeReady
  .then(async () => {
    const owner = workspaceEpoch;
    highlightNavigation();
    appearance(lastAppearance);
    await load();
    if (owner === workspaceEpoch) lock(false);
  });

function designOption(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}
window.pluginBridge?.on?.('workspace:changed', (workspace) => {
  const next = workspace && typeof workspace === 'object' && 'path' in workspace && typeof workspace.path === 'string' ? workspace.path : null;
  if (next && next === observedWorkspace && snapshot?.workspace === next) return;
  const owner = ++workspaceEpoch;
  loadRevision++;
  window.dispatchEvent(new Event('documents-reset'));
  observedWorkspace = next;
  // Revoke the old view immediately; late reads cannot enter the new workspace.
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close('cancel'));
  selectedItem = null;
  searchQuery = '';
  $('board-search').value = '';
  resetCompletedHistory();
  itemOrigin = null;
  text('workspace', next || t('disconnected'));
  lock(true);
  void load().finally(() => { if (owner === workspaceEpoch) lock(false); });
});
$('architecture-check').addEventListener('click', async () => {
  if (busy || !snapshot || !projectSnapshot?.architecture || !navigator.onLine) return;
  const owner = workspaceEpoch;
  lock(true);
  try {
    const data: any = await invoke('governance.project', { checkSources: true });
    if (owner !== workspaceEpoch) return;
    if (data.workspace !== snapshot.workspace) throw Error(t('switched'));
    projectSnapshot = data;
    renderBoard();
    renderProjectGraph();
  } catch (error) { if (owner === workspaceEpoch) notify(error.message, true); }
  finally { if (owner === workspaceEpoch) lock(false); }
});

document.querySelectorAll<HTMLButtonElement>('[data-project-view]').forEach(button => {
  button.addEventListener('click', () => {
    const link = document.querySelector<HTMLAnchorElement>(`.workspace-nav a[href="#${button.dataset.projectView}"]`);
    link.focus();
    link.click();
  });
});
