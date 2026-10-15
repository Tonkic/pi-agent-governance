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
  const missing = zh ? '请使用启动终端输出的完整本地地址连接；服务重启后需打开新地址。' : 'Open the full private URL printed by the startup terminal. Reopen the new URL after restarting the service.';
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
  const info = document.createElement('section');
  info.id = 'local-console-info';
  info.setAttribute('aria-label', zh ? '本地控制台连接' : 'Local console connection');
  const title = document.createElement('strong');
  title.textContent = zh ? '本地项目控制台' : 'Local project console';
  const description = document.createElement('p');
  description.textContent = zh ? '仅本机 · 绑定启动时的项目。CLI / 桌面客户端通过 MCP 共享看板和架构；保存后手动刷新。这里不启动模型或 Agent。' : 'Local only · Bound to the startup project. CLI / desktop MCP clients share its board and architecture; refresh after changes. No model or Agent launches here.';
  const design = document.createElement('p');
  design.className = 'muted';
  design.textContent = zh ? '设计协作：在此创建草案 → 让已配置 MCP 的客户端保存方案 → 刷新并人工审阅确认。确认设计不会授权代码实施。' : 'Design: create a draft here → save a proposal from an MCP client → refresh and review it here. Confirming a design does not authorize code changes.';
  info.append(title, description, design);
  document.querySelector('.topbar').after(info);
})();
