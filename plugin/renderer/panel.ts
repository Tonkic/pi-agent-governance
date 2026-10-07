'use strict';
const $ = (id: string): any => document.getElementById(id);
let snapshot = null,
  busy = false,
  edited = false;
let projectSnapshot: any = null,
  editingItem: string = null,
  draggedItem: string = null;
const dirtyForms = new Set<string>();
function discardWarning(submitted?: string) {
  const names = {
    'progress-form': t('draftProgress'),
    'start-form': t('draftTask'),
    'workitem-form': t('draftItem')
  };
  const drafts = [...dirtyForms].filter((id) => id !== submitted).map((id) => names[id] || id);
  return drafts.length ? t('discard', drafts.join(' / ')) : '';
}
const boardStages = ['todo', 'doing', 'done'];
const boardLabels = new Proxy({}, { get: (_, key: CopyKey) => t(key) });
const labels = new Proxy(
  {},
  { get: (_, key: CopyKey) => (copy[locale][key] ? t(key) : String(key)) }
);
const text = (id, value) => {
  $(id).textContent = value ?? '';
};
const lines = (id) =>
  $(id)
    .value.split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
function notify(message, error = false) {
  text('notice-message', message);
  $('notice').classList.toggle('error', error);
}
function lock(value) {
  busy = value;
  document.querySelectorAll('main button, main input, main textarea').forEach((el) => {
    (el as HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement).disabled = value;
  });
  $('workitem-blocker').disabled = value || !editingItem;
}
async function invoke(channel, payload = {}) {
  if (!window.pluginBridge?.invoke) throw Error(t('staticPreview'));
  const response = await window.pluginBridge.invoke(channel, payload);
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
  if (snapshot && g.workspace !== snapshot.workspace) throw Error(t('switched'));
  text(
    'git-summary',
    t('gitSummary', (g.head || '').slice(0, 12), g.dirty ? t('dirty') : t('clean'), g.tasks.length)
  );
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
    if (task.error) rows[2] = ['p', t('unavailable')];
    if (task.error) rows.push(['p', t('readFailed', task.error)]);
    if (task.pendingMerge || task.mergeInProgress) rows.push(['p', t('incompleteMerge')]);
    for (const [tag, value, cls] of rows) {
      const el = document.createElement(tag);
      el.textContent = value || '';
      if (cls) el.className = cls;
      card.append(el);
    }
    $('git-tasks').append(card);
  }
}
async function load() {
  snapshot = null;
  dirtyForms.clear();
  projectSnapshot = null;
  resetWorkitem();
  $('workitem-form').hidden = true;
  $('board-columns').replaceChildren();
  text('board-status', t('boardLoading'));
  notify(t('workspaceLoading'));
  try {
    render(await invoke('governance.snapshot'));
    text('updated', t('updated', new Date().toLocaleTimeString(locale)));
    notify(t('synced'));
  } catch (error) {
    notify(error.message, true);
    for (const id of ['uninitialized', 'start-form', 'progress-form']) $(id).hidden = true;
    text('workspace', t('disconnected'));
  }
  text('git-summary', t('gitLoading'));
  $('git-tasks').replaceChildren();
  if (snapshot) {
    try {
      const data: any = await invoke('governance.project');
      if (data.workspace !== snapshot.workspace) throw Error(t('switched'));
      projectSnapshot = data;
      renderBoard();
    } catch (error) {
      text('board-status', t('boardReadError', error.message));
    }
  } else text('board-status', t('boardDisconnected'));
  renderProjectGraph();
  // Project content is useful before slow Git commands settle. Keep new controls locked.
  if (busy) lock(true);
  try {
    renderGit(await invoke('governance.git'));
  } catch (error) {
    text('git-summary', t('gitError', error.message));
  }
}
function confirmWrite(description) {
  const dialog = $('confirm-dialog');
  text('confirm-description', description);
  text('confirm-workspace', snapshot?.workspace || '');
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {
      once: true
    })
  );
}
async function mutate(args, description) {
  if (busy || !snapshot) return;
  lock(true);
  try {
    if (
      !(await confirmWrite(
        description +
          discardWarning(
            args.action === 'progress'
              ? 'progress-form'
              : args.action === 'start'
                ? 'start-form'
                : undefined
          )
      ))
    )
      return;
    await invoke('governance.mutate', { args, revision: snapshot.revision, confirmed: true });
    await load();
  } catch (error) {
    notify(t('noRetry', error.message), true);
  } finally {
    lock(false);
  }
}
$('refresh').addEventListener('click', async () => {
  if (busy) return;
  if (edited) {
    notify(t('unsaved'));
    edited = false;
    return;
  }
  lock(true);
  try {
    await load();
  } finally {
    lock(false);
  }
});
for (const form of document.querySelectorAll('main form'))
  form.addEventListener('input', () => {
    edited = true;
    dirtyForms.add(form.id);
  });
$('initialize').addEventListener('click', () => mutate({ action: 'init' }, t('initConfirm')));
$('start-form').addEventListener('submit', (event) => {
  event.preventDefault();
  mutate(
    {
      action: 'start',
      id: $('new-id').value.trim(),
      goal: $('new-goal').value.trim(),
      criteria: lines('new-criteria'),
      scope: lines('new-scope'),
      constraints: lines('new-constraints')
    },
    t('startConfirm')
  );
});
$('progress-form').addEventListener('submit', (event) => {
  event.preventDefault();
  mutate(
    {
      action: 'progress',
      current: $('edit-current').value.trim(),
      next: lines('edit-next'),
      blocked: lines('edit-blocked')
    },
    t('progressConfirm')
  );
});
let graphView = 'architecture';
function renderProjectGraph() {
  let graph = null,
    message = '';
  const s = snapshot?.state;
  text('graph-warning', '');
  $('graph-warning').hidden = true;
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
const pageIds = ['architecture', 'board-section', 'task-section', 'git-section'];
function highlightNavigation() {
  const requested = location.hash.slice(1);
  const active = pageIds.includes(requested) ? requested : 'architecture';
  for (const id of pageIds) $(id).hidden = id !== active;
  document.querySelector<HTMLElement>('.metrics').hidden = active !== 'task-section';
  document.querySelectorAll<HTMLAnchorElement>('.workspace-nav a').forEach((link) => {
    if (link.hash === `#${active}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  // Hidden graph geometry is recalculated when the architecture page becomes visible.
  if (active === 'architecture') window.dispatchEvent(new Event('resize'));
}
window.addEventListener('hashchange', highlightNavigation);
highlightNavigation();
const appearance = (value: any = {}) => {
  document.documentElement.dataset.base =
    value?.base || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
};
appearance();
window.pluginBridge?.on?.('appearance:changed', appearance);
window.pluginBridge
  ?.invoke('app.getAppearance')
  .then(appearance)
  .catch(() => {});
function resetWorkitem() {
  dirtyForms.delete('workitem-form');
  editingItem = null;
  $('workitem-form').reset();
  $('workitem-id').readOnly = false;
  $('workitem-blocker').disabled = true;
  text('workitem-save', t('createItem'));
}
async function writeWorkitem(args) {
  if (busy || !snapshot || !projectSnapshot) return;
  const revision = projectSnapshot.revision;
  lock(true);
  try {
    if (
      !(await confirmWrite(
        t('itemConfirm', args.id, args.stage ? ` → ${boardLabels[args.stage]}` : '') +
          discardWarning(args.action === 'board_move' ? undefined : 'workitem-form')
      ))
    )
      return;
    await invoke('governance.workitem', { args, revision, confirmed: true });
    resetWorkitem();
    await load();
    if (projectSnapshot) notify(t('itemSaved'));
  } catch (error) {
    notify(t('itemError', error.message), true);
  } finally {
    lock(false);
  }
}
function moveWorkitem(id, stage, position) {
  return writeWorkitem({ action: 'board_move', id, stage, position });
}
function renderBoard() {
  const data = projectSnapshot;
  $('board-columns').replaceChildren();
  if (data.boardError) {
    text('board-status', t('boardError', data.boardError));
    return;
  }
  $('workitem-form').hidden = !snapshot?.state;
  text(
    'board-status',
    t('boardStatus', data.board.items.length, data.board.updatedAt || t('notCreated'))
  );
  for (const stage of boardStages) {
    const column = document.createElement('section');
    column.className = 'board-column';
    column.dataset.stage = stage;
    const items = data.board.items.filter((item) => item.stage === stage);
    const heading = document.createElement('h3');
    heading.textContent = `${boardLabels[stage]} · ${items.length}`;
    column.append(heading);
    column.addEventListener('dragover', (event) => {
      if (draggedItem && !busy) {
        event.preventDefault();
        column.classList.add('drop-target');
      }
    });
    column.addEventListener('dragleave', (event) => {
      if (!column.contains(event.relatedTarget as Node)) column.classList.remove('drop-target');
    });
    column.addEventListener('drop', (event) => {
      event.preventDefault();
      column.classList.remove('drop-target');
      const id = draggedItem;
      draggedItem = null;
      if (!id || busy) return;
      const others = items.filter((item) => item.id !== id);
      const target = (event.target as Element).closest<HTMLElement>('[data-workitem]');
      if (target?.dataset.workitem === id) return;
      const index = target ? others.findIndex((item) => item.id === target.dataset.workitem) : -1;
      void moveWorkitem(id, stage, index < 0 ? others.length : index);
    });
    items.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'workitem';
      card.dataset.workitem = item.id;
      card.draggable = true;
      card.addEventListener('dragstart', (event) => {
        if (busy) {
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
      for (const [tag, value] of [
        ['h4', item.title],
        ['p', item.description],
        ['small', t('itemLinks', item.taskId || t('none'), item.gitTaskId || t('none'))],
        ['p', item.blocker ? t('blocker', item.blocker) : '']
      ]) {
        const el = document.createElement(tag);
        el.textContent = value;
        card.append(el);
      }
      const controls = document.createElement('div');
      controls.className = 'workitem-controls';
      const button = (label, action) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.textContent = label;
        el.setAttribute('aria-label', `${item.title}：${label}`);
        el.addEventListener('click', action);
        controls.append(el);
      };
      button(t('edit'), async () => {
        if (busy) return;
        lock(true);
        try {
          if (dirtyForms.has('workitem-form') && !(await confirmWrite(t('switchDraft')))) return;
          resetWorkitem();
          editingItem = item.id;
          $('workitem-id').value = item.id;
          $('workitem-id').readOnly = true;
          for (const key of ['title', 'description', 'blocker'])
            $(`workitem-${key}`).value = item[key];
          text('workitem-save', t('saveChanges'));
        } finally {
          lock(false);
          $('workitem-title').focus();
        }
      });
      if (index > 0) button(t('moveUp'), () => moveWorkitem(item.id, stage, index - 1));
      if (index < items.length - 1)
        button(t('moveDown'), () => moveWorkitem(item.id, stage, index + 1));
      for (const target of boardStages.filter(
        (s) => Math.abs(boardStages.indexOf(s) - boardStages.indexOf(stage)) === 1
      ))
        button(t('moveTo', boardLabels[target]), () =>
          moveWorkitem(item.id, target, data.board.items.filter((i) => i.stage === target).length)
        );
      card.append(controls);
      column.append(card);
    });
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = t('noItems');
      column.append(empty);
    }
    $('board-columns').append(column);
  }
}
$('workitem-cancel').addEventListener('click', resetWorkitem);
$('workitem-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void writeWorkitem({
    action: editingItem ? 'board_update' : 'board_create',
    id: editingItem || $('workitem-id').value.trim(),
    title: $('workitem-title').value.trim(),
    description: $('workitem-description').value,
    ...(editingItem ? { blocker: $('workitem-blocker').value } : {})
  });
});
lock(true);
localeReady.then(load).finally(() => lock(false));
