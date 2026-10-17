'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const zh = /^zh/i.test(navigator.language);
  const copy = zh ? {
    title: '浏览器工作台', description: '所有宿主共用同一工作台。聊天、模型和历史仍在原宿主中。',
    'project-label': '当前项目', open: '打开浏览器工作台', refresh: '刷新状态',
    hint: '载入、恢复或切换入口不会自动打开浏览器，请确认项目后点击打开。',
    checking: '正在核对项目连接…', closed: '尚未打开浏览器工作台', connected: '工作台服务已连接',
    opening: '正在打开浏览器…', opened: '已发送到系统浏览器，可在浏览器中继续。',
    failed: '无法连接。请先在宿主打开项目、确认插件权限，再刷新状态。', stale: '项目已切换，请刷新状态后再打开。'
  } : {
    title: 'Browser workbench', description: 'One workbench for all hosts. Your conversation, model and history stay in the host.',
    'project-label': 'Current project', open: 'Open browser workbench', refresh: 'Refresh status',
    hint: 'Loading, restoring or switching this entry never opens the browser. Check the project, then click Open.',
    checking: 'Checking project connection…', closed: 'Browser workbench is not open', connected: 'Workbench service connected',
    opening: 'Opening browser…', opened: 'Sent to your system browser. Continue there.',
    failed: 'Unable to connect. Open a host project, check plugin permissions, then refresh status.', stale: 'Project changed. Refresh status before opening.'
  };
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  for (const id of ['title', 'description', 'project-label', 'open', 'refresh', 'hint']) $(id).textContent = copy[id];
  let state = null, generation = 0, busy = false;
  const lock = value => { busy = value; $('open').disabled = value || !state; $('refresh').disabled = value; };
  const appearance = value => { document.documentElement.dataset.theme = (value?.base || value?.theme) === 'light' ? 'light' : (value?.base || value?.theme) === 'dark' ? 'dark' : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; };
  const invoke = async payload => {
    if (!window.pluginBridge?.invoke) throw Error();
    const answer = await window.pluginBridge.invoke('governance.entry', payload);
    const value = answer?.result;
    if (!answer?.ok || !value || typeof value.workspace !== 'string' || typeof value.open !== 'boolean' || !/^[a-f0-9]{64}$/.test(value.revision)) throw Error();
    return value;
  };
  async function refresh() {
    if (busy) return;
    const owner = ++generation; state = null; lock(true);
    $('project').textContent = '—'; $('status').textContent = copy.checking;
    try {
      const value = await invoke({ action: 'status' });
      if (owner !== generation) return;
      state = value; $('project').textContent = value.workspace;
      $('status').textContent = value.open ? copy.connected : copy.closed;
    } catch { if (owner === generation) $('status').textContent = copy.failed; }
    finally { if (owner === generation) lock(false); }
  }
  $('open').addEventListener('click', async () => {
    if (busy || !state) return;
    const owner = ++generation, revision = state.revision; lock(true); $('status').textContent = copy.opening;
    try {
      const value = await invoke({ action: 'open', confirmed: true, revision });
      if (owner !== generation) return;
      state = value; $('status').textContent = copy.opened;
    } catch { if (owner === generation) { state = null; $('status').textContent = copy.failed; } }
    finally { if (owner === generation) lock(false); }
  });
  const invalidate = () => { generation++; state = null; lock(false); $('project').textContent = '—'; $('status').textContent = copy.stale; };
  $('refresh').addEventListener('click', refresh);
  window.pluginBridge?.on?.('workspace:changed', invalidate);
  window.pluginBridge?.on?.('view:open', invalidate);
  window.addEventListener('pagehide', invalidate);
  window.addEventListener('pageshow', event => { if (event.persisted) invalidate(); });
  window.pluginBridge?.on?.('appearance:changed', appearance);
  if (window.pluginBridge?.invoke) void window.pluginBridge.invoke('app.getAppearance').then(appearance).catch(() => appearance(null));
  else appearance(null);
  void refresh(); // Read-only status, never auto-open or poll.
})();
