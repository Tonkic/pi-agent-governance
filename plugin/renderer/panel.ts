'use strict';
const $ = (id: string): any => document.getElementById(id);
let snapshot = null, busy = false, edited = false;
const labels = { idle: '待命', working: '进行中', verified: '已验证', ready: '待关闭', integrated: '已集成', integrating: '集成中' };
const text = (id, value) => { $(id).textContent = value; };
const lines = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
function notify(message, error = false) { text('notice', message); $('notice').classList.toggle('error', error); }
function lock(value) { busy = value; document.querySelectorAll('main button, main input, main textarea').forEach(el => { (el as HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement).disabled = value; }); }
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
  text('workspace', data.workspace);
  text('status', s ? labels[s.status] || s.status : '未初始化');
  text('criteria-count', s?.criteria?.length || 0); text('blocked-count', s?.blocked?.length || 0);
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
  notify('正在读取当前工作区…');
  try { render(await invoke('governance.snapshot')); text('updated', `更新于 ${new Date().toLocaleTimeString()}`); notify('已同步。写入操作需要确认；测试与 Git 集成仍由 Agent 执行。'); }
  catch (error) { notify(error.message, true); for (const id of ['uninitialized', 'start-form', 'progress-form']) $(id).hidden = true; text('workspace', '连接不可用，以下如有数据仅为上次快照'); }
  text('git-summary', '正在读取 Git 状态…'); $('git-tasks').replaceChildren();
  try { renderGit(await invoke('governance.git')); }
  catch (error) { text('git-summary', `Git 不可用：${error.message}`); }
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
    if (!await confirmWrite(description)) return;
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
for (const form of document.querySelectorAll('main form')) form.addEventListener('input', () => { edited = true; });
$('initialize').addEventListener('click', () => mutate({ action: 'init' }, '创建缺失的 STATE.json、AGENTS.md 和 README.md，保留已有文件。'));
$('start-form').addEventListener('submit', event => {
  event.preventDefault();
  mutate({ action: 'start', id: $('new-id').value.trim(), goal: $('new-goal').value.trim(), criteria: lines('new-criteria'), scope: lines('new-scope'), constraints: lines('new-constraints') }, '按表单目标与验收条件创建任务，写入 STATE 和任务目录。');
});
$('progress-form').addEventListener('submit', event => {
  event.preventDefault(); mutate({ action: 'progress', current: $('edit-current').value.trim(), next: lines('edit-next'), blocked: lines('edit-blocked') }, '保存当前进度、下一步和阻塞项，并使旧验证失效。');
});
const appearance = (value: any = {}) => { document.documentElement.dataset.base = value?.base || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); };
appearance();
window.pluginBridge?.on?.('appearance:changed', appearance);
window.pluginBridge?.invoke('app.getAppearance').then(appearance).catch(() => {});
lock(true); load().finally(() => lock(false));
