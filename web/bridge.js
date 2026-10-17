'use strict';
(() => {
  const zh = /^zh/i.test(navigator.language);
  const key = 'governance-local-session';
  let token = '';
  const fragment = location.hash.slice(1);
  if (/^[a-f0-9]{64}$/.test(fragment)) {
    token = fragment;
    try { sessionStorage.setItem(key, token); } catch { /* In-memory session still works. */ }
    history.replaceState(null, '', location.pathname);
  } else {
    try { token = sessionStorage.getItem(key) || ''; } catch { /* Ask user to reopen startup link. */ }
  }
  const missing = zh ? '请回到宿主重新打开浏览器工作台；手动CLI模式请使用终端新输出的完整私有地址。' : 'Reopen the browser workbench from your host; for manual CLI mode use its newly printed full private URL.';
  window.pluginBridge = Object.freeze({
    invoke: async (channel, payload = {}) => {
      if (channel === 'app.getLocale') return navigator.language;
      if (channel === 'app.getAppearance') return { theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' };
      if (!/^[a-f0-9]{64}$/.test(token)) throw Error(missing);
      if (channel === 'governance.operation') throw Error(zh ? '本地控制台不提供宿主模型或Agent会话控制。' : 'Host model and Agent session control is not available in the local console.');
      const response = await fetch('/api/invoke', {
        method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Governance-Token': token },
        body: JSON.stringify({ channel, payload }), signal: AbortSignal.timeout(20000)
      });
      if (response.status === 403) throw Error(missing);
      const result = await response.json();
      if (!result.ok) throw Error(result.error || (zh ? '操作失败，请刷新。' : 'Operation failed; refresh before retrying.'));
      return result;
    },
    on: (event, handler) => {
      if (event !== 'appearance:changed') return;
      const query = matchMedia('(prefers-color-scheme: dark)');
      query.addEventListener('change', e => handler({ theme: e.matches ? 'dark' : 'light' }));
    }
  });
  // A random ID per document activation (never sessionStorage: duplicated tabs must differ).
  // Failures stop the loop; only pageshow/online can resume it. No queued retry backlog.
  let leaseId = '';
  let leaseTimer;
  let leaseRequest;
  let generation = 0;
  let hidden = false;
  let unmanaged = false;
  const leasePost = (id, event, extra = {}) => fetch('/api/invoke', {
    method: 'POST', credentials: 'omit', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Governance-Token': token },
    body: JSON.stringify({ channel: 'governance.lease', payload: { id, event } }), ...extra
  });
  const renew = async (event, epoch) => {
    if (hidden || unmanaged || epoch !== generation || leaseRequest || !/^[a-f0-9]{64}$/.test(token)) return;
    const controller = new AbortController();
    leaseRequest = controller;
    // The only timer also bounds this request; replace it with the next heartbeat on success.
    leaseTimer = setTimeout(() => controller.abort(), 20000);
    let scheduled = false;
    try {
      const response = await leasePost(leaseId, event, { signal: controller.signal });
      if (!response.ok) return;
      const message = await response.json();
      if (!message.ok || epoch !== generation || hidden) return;
      if (message.result?.managed === false) { unmanaged = true; return; }
      const delay = message.result?.heartbeatMs;
      if (message.result?.managed !== true || !Number.isSafeInteger(delay) || delay <= 0) return;
      clearTimeout(leaseTimer);
      leaseTimer = setTimeout(() => { leaseTimer = undefined; void renew('heartbeat', epoch); }, delay);
      scheduled = true;
    } catch { /* Offline/closed server: no automatic retry. */ }
    finally {
      if (leaseRequest === controller) {
        leaseRequest = undefined;
        // Clear only the request timeout on failure, not a scheduled heartbeat.
        if (!scheduled) { clearTimeout(leaseTimer); leaseTimer = undefined; }
      }
    }
  };
  const resume = () => {
    if (unmanaged || leaseRequest || leaseTimer || !/^[a-f0-9]{64}$/.test(token)) return;
    hidden = false;
    if (!leaseId) leaseId = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
    void renew('join', ++generation);
  };
  window.addEventListener('pagehide', () => {
    hidden = true; generation++;
    clearTimeout(leaseTimer); leaseTimer = undefined;
    leaseRequest?.abort(); leaseRequest = undefined;
    if (leaseId && !unmanaged) void leasePost(leaseId, 'leave', { keepalive: true }).catch(() => {});
    leaseId = '';
  });
  window.addEventListener('pageshow', resume);
  window.addEventListener('online', () => { if (!hidden) resume(); });
  resume();

  const info = document.createElement('section');
  info.id = 'local-console-info';
  info.setAttribute('aria-label', zh ? '本地控制台连接' : 'Local console connection');
  const title = document.createElement('strong');
  title.textContent = zh ? '本地项目控制台' : 'Local project console';
  const description = document.createElement('p');
  description.textContent = zh ? '所有宿主共用此浏览器工作台 · 固定绑定当前项目。开发、模型和历史保留在原宿主会话；保存后刷新。这里不启动模型或 Agent。' : 'One browser workbench for all hosts · Bound to this project. Development, model and history stay in the original host conversation; refresh after changes. No model or Agent launches here.';
  const design = document.createElement('p');
  design.className = 'muted';
  design.textContent = zh ? '设计协作：在此创建草案 → 回原宿主会话保存方案 → 刷新并人工审阅确认。确认设计不会授权代码实施。' : 'Design: create a draft here → save a proposal in your original host conversation → refresh and review it here. Confirming a design does not authorize code changes.';
  info.append(title, description, design);
  document.querySelector('.topbar').after(info);
})();
