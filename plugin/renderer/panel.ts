'use strict';
const $ = (id: string): any => document.getElementById(id);
let snapshot = null, busy = false, edited = false;
let projectSnapshot: any = null, editingItem: string = null, draggedItem: string = null;
const dirtyForms = new Set<string>();
function discardWarning(submitted?: string) {
  const names = { 'progress-form': '总体进度', 'start-form': '新任务', 'workitem-form': '工作项' };
  const drafts = [...dirtyForms].filter(id => id !== submitted).map(id => names[id] || id);
  return drafts.length ? ` 注意：保存后刷新将丢弃未提交的${drafts.join('、')}草稿。确认即同意丢弃；取消可返回保存草稿。` : '';
}
const boardStages = ['todo', 'doing', 'done'];
const boardLabels = { todo: '待办', doing: '进行中', done: '完成' };
const labels = { idle: '待命', working: '进行中', verified: '已验证', ready: '待关闭', integrated: '已集成', integrating: '集成中' };
const text = (id, value) => { $(id).textContent = value ?? ''; };
const lines = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
function notify(message, error = false) { text('notice-message', message); $('notice').classList.toggle('error', error); }
function lock(value) { busy = value; document.querySelectorAll('main button, main input, main textarea').forEach(el => { (el as HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement).disabled = value; }); $('workitem-blocker').disabled = value || !editingItem; }
async function invoke(channel, payload = {}) {
  if (!window.pluginBridge?.invoke) throw Error('当前是静态预览。请在 PI-Desktop 插件面板中打开，才能读取或修改项目。');
  const response = await window.pluginBridge.invoke(channel, payload);
  if (!response?.ok) throw Error(response?.error || '宿主未返回有效结果');
  return response.result;
}
function list(id, values) {
  $(id).replaceChildren(...(values?.length ? values : ['暂无']).map(value => { const li = document.createElement('li'); li.textContent = value; return li; }));
}
function render(data) {
  snapshot = data; const s = data.state;
  const status = s ? labels[s.status] || s.status : '未初始化';
  const criteriaCount = s?.criteria?.length || 0;
  const blockerCount = s?.blocked?.length || 0;
  text('workspace', data.workspace);
  text('status', status); text('status-metric', status);
  $('status').dataset.state = s?.status || 'uninitialized';
  text('criteria-count', criteriaCount); text('criteria-state', `${criteriaCount} 条`); text('blocked-count', blockerCount);
  text('task-id', s?.task || 'STATE');
  text('goal', s?.goal || (s ? '暂无活动任务' : '为项目建立可接手的状态'));
  text('current', s?.current || '初始化后，再明确目标、范围和验收条件。');
  list('criteria', s?.criteria); list('scope', s?.scope); list('constraints', s?.constraints);
  $('followup').hidden = !s?.followUp;
  text('followup', s?.followUp ? `已批准的后续任务：${s.followUp.id}。创建表单已预填，可确认后启动。` : '');
  $('uninitialized').hidden = !!s; $('start-form').hidden = !s || !!s.task; $('progress-form').hidden = !s?.task;
  text('editor-title', s?.task ? '更新进度' : s ? '创建任务' : '初始化');
  $('edit-current').value = s?.current || ''; $('edit-next').value = (s?.next || []).join('\n'); $('edit-blocked').value = (s?.blocked || []).join('\n');
  for (const key of ['id', 'goal', 'criteria', 'scope', 'constraints']) {
    const v = s?.followUp?.[key]; $(`new-${key}`).value = Array.isArray(v) ? v.join('\n') : v || '';
  }
  edited = false;
}
function renderGit(g) {
  if (snapshot && g.workspace !== snapshot.workspace) throw Error('工作区在读取期间已切换，请刷新');
  text('git-summary', `HEAD ${(g.head || '').slice(0, 12)} · ${g.dirty ? '有未提交修改' : '工作区干净'} · ${g.tasks.length} 个受管任务`);
  $('git-tasks').replaceChildren();
  if (!g.tasks.length) { text('git-tasks', '还没有受管工作区。需要写入型子任务时，让 Agent 先调用 git_create。'); return; }
  for (const t of g.tasks) {
    const card = document.createElement('article'); card.className = 'git-task';
    const rows = [ ['h3', `${t.id} · ${t.role === 'coordinator' ? '协调' : '执行'}`], ['p', t.goal], ['p', `${labels[t.status] || t.status} · ${t.dirty ? '有修改' : '干净'} · ${t.verificationValid ? '验证有效' : '未验证 / 已失效'}`], ['p', `分支 ${t.branch}`], ['p', t.worktree, 'path'], ['p', `范围：${(t.allowedPaths || []).join('、')}`] ];
    if (t.error) rows[2] = ['p', '状态不可用，请检查工作区'];
    if (t.error) rows.push(['p', `读取失败：${t.error}`]);
    if (t.pendingMerge || t.mergeInProgress) rows.push(['p', '存在未完成合并，请先检查冲突或恢复登记。']);
    for (const [tag, value, cls] of rows) { const el = document.createElement(tag); el.textContent = value || ''; if (cls) el.className = cls; card.append(el); }
    $('git-tasks').append(card);
  }
}
async function load() {
  snapshot = null;
  dirtyForms.clear();
  projectSnapshot = null; resetWorkitem(); $('workitem-form').hidden = true; $('board-columns').replaceChildren(); text('board-status', '正在读取工作项…');
  notify('正在读取当前工作区…');
  try { render(await invoke('governance.snapshot')); text('updated', `更新于 ${new Date().toLocaleTimeString()}`); notify('已同步。写入操作需要确认；测试与 Git 集成仍由 Agent 执行。'); }
  catch (error) { notify(error.message, true); for (const id of ['uninitialized', 'start-form', 'progress-form']) $(id).hidden = true; text('workspace', '连接不可用，以下如有数据仅为上次快照'); }
  text('git-summary', '正在读取 Git 状态…'); $('git-tasks').replaceChildren();
  try { renderGit(await invoke('governance.git')); }
  catch (error) { text('git-summary', `Git 不可用：${error.message}`); }
  if (snapshot) {
    try {
      const data: any = await invoke('governance.project');
      if (data.workspace !== snapshot.workspace) throw Error('工作区已切换，请刷新');
      projectSnapshot = data; renderBoard();
    } catch (error) { text('board-status', `工作项读取失败：${error.message}`); }
  } else text('board-status', '连接不可用，无法读取工作项。');
  renderProjectGraph();
}
function confirmWrite(description) {
  const dialog = $('confirm-dialog'); text('confirm-description', description); text('confirm-workspace', snapshot?.workspace || '');
  dialog.returnValue = ''; dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}
async function mutate(args, description) {
  if (busy || !snapshot) return;
  lock(true);
  try {
    if (!await confirmWrite(description + discardWarning(args.action === 'progress' ? 'progress-form' : args.action === 'start' ? 'start-form' : undefined))) return;
    await invoke('governance.mutate', { args, revision: snapshot.revision, confirmed: true });
    await load();
  } catch (error) { notify(`${error.message}。未自动重试，请检查状态；刷新会丢弃未保存表单。`, true); }
  finally { lock(false); }
}
$('refresh').addEventListener('click', async () => {
  if (busy) return;
  if (edited) { notify('表单有未保存内容。再次点击刷新将丢弃这些内容。'); edited = false; return; }
  lock(true); try { await load(); } finally { lock(false); }
});
for (const form of document.querySelectorAll('main form')) form.addEventListener('input', () => { edited = true; dirtyForms.add(form.id); });
$('initialize').addEventListener('click', () => mutate({ action: 'init' }, '创建缺失的 STATE.json、AGENTS.md 和 README.md，保留已有文件。'));
$('start-form').addEventListener('submit', event => {
  event.preventDefault();
  mutate({ action: 'start', id: $('new-id').value.trim(), goal: $('new-goal').value.trim(), criteria: lines('new-criteria'), scope: lines('new-scope'), constraints: lines('new-constraints') }, '按表单目标与验收条件创建任务，写入 STATE 和任务目录。');
});
$('progress-form').addEventListener('submit', event => {
  event.preventDefault(); mutate({ action: 'progress', current: $('edit-current').value.trim(), next: lines('edit-next'), blocked: lines('edit-blocked') }, '保存当前进度、下一步和阻塞项，并使旧验证失效。');
});
let graphView = 'architecture';
function renderProjectGraph() {
  let graph = null, message = '';
  const s = snapshot?.state;
  if (graphView === 'workflow') {
    text('architecture-title', '任务流程');
    text('graph-source', '有效 STATE 快照 · 允许的治理阶段，不代表自动执行或历史阶段已通过');
    if (!snapshot) message = '状态读取失败，无法展示流程。';
    else if (!s) message = '尚未初始化治理。';
    else {
      const phases = ['idle', 'working', 'verified', 'ready'];
      graph = { nodes: phases.map(id => ({ id, title: labels[id], current: s.status === id, files: ['STATE.json'], description: id === s.status ? `${s.current || ''}\n阻塞：${(s.blocked || []).join('；') || '无'}\n验证：${s.verification ? '有验证记录；关闭前仍须核对文件指纹' : '无有效验证记录'}\n${s.followUp ? `已批准后续：${s.followUp.id}` : ''}` : ({ idle: '等待人工目标；close 后回到待命。', working: '执行已批准任务；更新进度会使旧验证失效。', verified: '必须实际完成检查后由 Agent 提交验收证据。', ready: '知识说明已完成，等待关闭归档。' })[id] })), edges: [{ from: 'idle', to: 'working', label: 'start' }, { from: 'working', to: 'verified', label: 'verify' }, { from: 'verified', to: 'ready', label: 'gate / close(knowledge)' }, { from: 'ready', to: 'idle', label: 'close / archive' }, { from: 'verified', to: 'working', label: 'progress / 意图变化' }, { from: 'ready', to: 'working', label: 'progress / 意图变化' }] };
    }
  } else {
    text('architecture-title', '项目架构');
    graph = projectSnapshot?.architecture;
    message = projectSnapshot?.architectureError ? `架构读取失败：${projectSnapshot.architectureError}` : !projectSnapshot ? '项目图尚未读取或读取失败，请刷新。' : !graph ? '尚无项目架构。请让 Agent 阅读源码后调用 architecture_sources / architecture_set。' : '';
    text('graph-source', graph ? `${graph.title} · ${graph.source} · 更新于 ${graph.updatedAt}${graph.staleFiles?.length ? ` · 源码已变化：${graph.staleFiles.join('、')}` : ''}` : '仅展示当前工作区持久化架构，不使用插件模块图替代。');
  }
  text('graph-empty', message); $('graph-empty').hidden = !message;
  text('graph-count', `${graph?.nodes?.length || 0} 节点 · ${graph?.edges?.length || 0} 关系`);
  $('show-architecture').setAttribute('aria-pressed', String(graphView === 'architecture')); $('show-workflow').setAttribute('aria-pressed', String(graphView === 'workflow'));
  window.dispatchEvent(new CustomEvent('project-graph', { detail: graph }));
}
$('show-architecture').addEventListener('click', () => { graphView = 'architecture'; renderProjectGraph(); });
$('show-workflow').addEventListener('click', () => { graphView = 'workflow'; renderProjectGraph(); });
function highlightNavigation() {
  const target = location.hash || '#architecture';
  document.querySelectorAll<HTMLAnchorElement>('.workspace-nav a').forEach(link => {
    if (link.hash === target) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', highlightNavigation);
highlightNavigation();
const appearance = (value: any = {}) => { document.documentElement.dataset.base = value?.base || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); };
appearance();
window.pluginBridge?.on?.('appearance:changed', appearance);
window.pluginBridge?.invoke('app.getAppearance').then(appearance).catch(() => {});
function resetWorkitem() {
  dirtyForms.delete('workitem-form');
  editingItem = null; $('workitem-form').reset(); $('workitem-id').readOnly = false;
  $('workitem-blocker').disabled = true; text('workitem-save', '创建工作项');
}
async function writeWorkitem(args) {
  if (busy || !snapshot || !projectSnapshot) return;
  const revision = projectSnapshot.revision;
  lock(true);
  try {
    if (!await confirmWrite(`保存工作项 ${args.id}${args.stage ? ` → ${boardLabels[args.stage]}` : ''}。不会验证或关闭总体任务，也不会执行 Git 集成。` + discardWarning(args.action === 'board_move' ? undefined : 'workitem-form'))) return;
    await invoke('governance.workitem', { args, revision, confirmed: true });
    resetWorkitem(); await load(); if (projectSnapshot) notify('工作项已保存并重新读取。');
  } catch (error) { notify(`工作项未确认保存：${error.message}。请刷新后核对；未自动重试。`, true); }
  finally { lock(false); }
}
function moveWorkitem(id, stage, position) { return writeWorkitem({ action: 'board_move', id, stage, position }); }
function renderBoard() {
  const data = projectSnapshot; $('board-columns').replaceChildren();
  if (data.boardError) { text('board-status', `工作项数据错误：${data.boardError}`); return; }
  $('workitem-form').hidden = !snapshot?.state;
  text('board-status', `${data.board.items.length} 个工作项 · ${data.board.updatedAt || '尚未创建'} · 拖动卡片排序，或使用卡片上的移动按钮。`);
  for (const stage of boardStages) {
    const column = document.createElement('section'); column.className = 'board-column'; column.dataset.stage = stage;
    const items = data.board.items.filter(item => item.stage === stage);
    const heading = document.createElement('h3'); heading.textContent = `${boardLabels[stage]} · ${items.length}`; column.append(heading);
    column.addEventListener('dragover', event => { if (draggedItem && !busy) { event.preventDefault(); column.classList.add('drop-target'); } });
    column.addEventListener('dragleave', event => { if (!column.contains(event.relatedTarget as Node)) column.classList.remove('drop-target'); });
    column.addEventListener('drop', event => {
      event.preventDefault(); column.classList.remove('drop-target');
      const id = draggedItem; draggedItem = null; if (!id || busy) return;
      const others = items.filter(item => item.id !== id);
      const target = (event.target as Element).closest<HTMLElement>('[data-workitem]');
      if (target?.dataset.workitem === id) return;
      const index = target ? others.findIndex(item => item.id === target.dataset.workitem) : -1;
      void moveWorkitem(id, stage, index < 0 ? others.length : index);
    });
    items.forEach((item, index) => {
      const card = document.createElement('article'); card.className = 'workitem'; card.dataset.workitem = item.id; card.draggable = true;
      card.addEventListener('dragstart', event => { if (busy) { event.preventDefault(); return; } draggedItem = item.id; event.dataTransfer.setData('text/plain', item.id); event.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
      card.addEventListener('dragend', () => { draggedItem = null; card.classList.remove('dragging'); document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target')); });
      for (const [tag, value] of [['h4', item.title], ['p', item.description], ['small', `总体任务：${item.taskId || '无'} · Git：${item.gitTaskId || '无'}`], ['p', item.blocker ? `阻塞：${item.blocker}` : '']]) {
        const el = document.createElement(tag); el.textContent = value; card.append(el);
      }
      const controls = document.createElement('div'); controls.className = 'workitem-controls';
      const button = (label, action) => { const el = document.createElement('button'); el.type = 'button'; el.textContent = label; el.setAttribute('aria-label', `${item.title}：${label}`); el.addEventListener('click', action); controls.append(el); };
      button('编辑', async () => {
        if (busy) return;
        lock(true);
        try {
          if (dirtyForms.has('workitem-form') && !await confirmWrite('切换编辑对象将丢弃当前未保存的工作项草稿。确认丢弃并编辑所选卡片？')) return;
          resetWorkitem(); editingItem = item.id; $('workitem-id').value = item.id; $('workitem-id').readOnly = true;
          for (const key of ['title', 'description', 'blocker']) $(`workitem-${key}`).value = item[key];
          text('workitem-save', '保存修改');
        } finally { lock(false); $('workitem-title').focus(); }
      });
      if (index > 0) button('上移', () => moveWorkitem(item.id, stage, index - 1));
      if (index < items.length - 1) button('下移', () => moveWorkitem(item.id, stage, index + 1));
      for (const target of boardStages.filter(s => Math.abs(boardStages.indexOf(s) - boardStages.indexOf(stage)) === 1)) button(`移至${boardLabels[target]}`, () => moveWorkitem(item.id, target, data.board.items.filter(i => i.stage === target).length));
      card.append(controls); column.append(card);
    });
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = '暂无工作项，可拖入相邻列的卡片。'; column.append(empty); }
    $('board-columns').append(column);
  }
}
$('workitem-cancel').addEventListener('click', resetWorkitem);
$('workitem-form').addEventListener('submit', event => {
  event.preventDefault(); void writeWorkitem({ action: editingItem ? 'board_update' : 'board_create', id: editingItem || $('workitem-id').value.trim(), title: $('workitem-title').value.trim(), description: $('workitem-description').value, ...(editingItem ? { blocker: $('workitem-blocker').value } : {}) });
});
lock(true); load().finally(() => lock(false));
