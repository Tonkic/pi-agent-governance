'use strict';
// Read-only project reader. Internal links use the listed Markdown paths, never source URLs.
(() => {
  const host = document.getElementById('documents-section');
  const words = {
    en: { title: 'Project documents', library: 'Document library', hint: 'Read-only · root guides, docs/ and notes/ Markdown. Listed internal documents and headings can be opened here; external links, images and HTML stay text.', refresh: 'Refresh documents', search: 'Search filenames', choose: 'Select a document to read', empty: 'No matching Markdown documents', waiting: 'Connect to a project first', loading: 'Reading…', contents: 'On this page', noHeadings: 'No headings', missingHeading: 'Heading not found in the loaded document.', offline: 'Offline · loaded text remains available. Reconnect and refresh to read files.', error: 'Could not read documents. Refresh to try again.', count: 'documents', limited: 'List is limited: at most 500 files, 4000 entries, depth 8, 256 KiB per file. Some files may be omitted.', plain: 'Document complexity limit: shown as plain text to keep the reader responsive.', cached: 'Loaded snapshot · refresh to read external changes', read: 'Read-only' },
    zh: { title: '项目文档', library: '文档库', hint: '只读 · 根目录说明及 docs/、notes/ 中的 Markdown。已列出的内部文档和标题可在此跳转；外部链接、图片和 HTML 仅显示文本。', refresh: '刷新文档', search: '搜索文件名', choose: '选择一篇文档开始阅读', empty: '没有匹配的 Markdown 文档', waiting: '请先连接项目', loading: '正在读取…', contents: '本页目录', noHeadings: '暂无标题', missingHeading: '未找到所链接的文档标题。', offline: '离线 · 已加载正文仍可阅读。恢复连接后刷新以读取文件。', error: '文档读取失败，请刷新重试。', count: '篇文档', limited: '列表有限额：最多 500 个文件、扫描 4000 个条目、8 层目录、每文件 256 KiB；部分文件可能未列出。', plain: '文档复杂度达到限额，已采用纯文本显示以保持流畅。', cached: '已加载快照 · 外部修改后请刷新', read: '只读' }
  };
  const w = () => words[locale === 'zh-CN' ? 'zh' : 'en'];
  const el = (tag: string, text = '', className = '') => {
    const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
  };
  const id = (node: HTMLElement, value: string) => { node.id = value; return node; };
  const head = el('div', '', 'reader-toolbar'); head.dataset.pageControl = 'documents-section'; head.hidden = true;
  const badge = el('span', '', 'badge');
  const hint = id(el('p'), 'reader-help'), safety = createContextHelp(hint, () => w().title);
  const refresh = id(el('button'), 'documents-refresh') as HTMLButtonElement; refresh.type = 'button';
  const smaller = id(el('button', 'A−'), 'documents-smaller') as HTMLButtonElement;
  const larger = id(el('button', 'A+'), 'documents-larger') as HTMLButtonElement;
  const size = el('output', '18', 'reader-size'); size.setAttribute('aria-live', 'polite');
  const focus = id(el('button'), 'documents-focus') as HTMLButtonElement; focus.setAttribute('aria-pressed', 'false');
  head.append(badge, refresh, smaller, size, larger, focus, safety);
  const layout = el('div', '', 'reader-layout');
  const library = el('details', '', 'reader-library') as HTMLDetailsElement; const libraryTitle = el('summary');
  const label = el('label'); const labelText = el('span');
  const search = id(el('input'), 'documents-search') as HTMLInputElement;
  search.type = 'search'; search.maxLength = 200; search.autocomplete = 'off'; label.append(labelText, search);
  const count = id(el('p', '', 'muted'), 'documents-count');
  const files = id(el('div', '', 'reader-files'), 'documents-files');
  library.append(libraryTitle, label, count, files);
  const reading = el('div', '', 'reader-reading');
  const status = id(el('p', '', 'reader-status'), 'documents-status'); status.setAttribute('role', 'status');
  const path = id(el('p', '', 'reader-path'), 'documents-path');
  const body = id(el('article', '', 'reader-prose'), 'documents-body'); body.tabIndex = -1;
  const contents = el('details', '', 'reader-contents') as HTMLDetailsElement; const tocTitle = el('summary');
  const toc = id(el('nav'), 'documents-toc'); contents.append(tocTitle, toc);
  reading.append(path, status, body); layout.append(library, reading, contents); host.append(layout); document.getElementById('action-panel').append(head);
  const narrow = () => host.clientWidth <= 1050;
  let folded: boolean;
  const fold = () => { if (!host.clientWidth) return; const next = narrow(); if (folded !== next) { library.open = contents.open = !next; folded = next; } };
  new ResizeObserver(fold).observe(host);
  let fontSize = 18;
  const resizeText = (delta: number) => { fontSize = Math.max(16, Math.min(20, fontSize + delta)); body.style.fontSize = `${fontSize}px`; size.textContent = String(fontSize); smaller.disabled = busy || fontSize <= 16; larger.disabled = busy || fontSize >= 20; };
  smaller.addEventListener('click', () => resizeText(-1)); larger.addEventListener('click', () => resizeText(1));
  focus.addEventListener('click', () => { const on = focus.getAttribute('aria-pressed') !== 'true'; focus.setAttribute('aria-pressed', String(on)); host.classList.toggle('reader-focused', on); });
  let root: string = null, epoch = -1, sequence = 0, listing = false, readingFile = false;
  let entries: Array<{ path: string; bytes: number }> = [], selected = '', loaded = false, truncated = false;
  let listMessage = '', readMessage = '', hasBody = false, attempted = false;
  const headingTargets = new Map<string, HTMLElement>();
  const active = () => location.hash === '#documents-section';
  const owns = (owner: number, project: string, request: number) => owner === workspaceEpoch && owner === epoch && project === root && request === sequence;
  const current = (owner: number, project: string, request: number) => owns(owner, project, request) && snapshot?.workspace === root;
  function controls() {
    refresh.disabled = !root || !snapshot || busy || listing || readingFile || !navigator.onLine;
    smaller.disabled = busy || fontSize <= 16; larger.disabled = busy || fontSize >= 20;
    search.disabled = !loaded; // Local filtering and TOC are usable offline and while writes are busy.
    files.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = !navigator.onLine || !snapshot || busy || listing; });
    toc.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; });
  }
  function messages() {
    status.textContent = !navigator.onLine ? w().offline : readMessage || (hasBody ? w().cached : w().choose);
    count.textContent = listMessage || `${entries.filter(item => item.path.toLocaleLowerCase().includes(search.value.toLocaleLowerCase().trim())).length} / ${entries.length} ${w().count}${truncated ? ' · ' + w().limited : ''}`;
    status.classList.toggle('reader-error', readMessage === w().error);
  }
  function renderList() {
    const focused = (document.activeElement as HTMLElement)?.dataset.document;
    const query = search.value.trim().toLocaleLowerCase();
    const matching = entries.filter(item => item.path.toLocaleLowerCase().includes(query));
    files.replaceChildren(...matching.map(item => {
      const button = el('button', '', 'reader-file') as HTMLButtonElement; button.type = 'button';
      button.dataset.document = item.path; button.setAttribute('aria-pressed', String(item.path === selected));
      button.append(el('span', item.path), el('small', `${Math.ceil(item.bytes / 1024)} KiB`));
      button.addEventListener('click', () => { void read(item.path, true); }); return button;
    }));
    if (!matching.length) files.append(el('p', loaded ? w().empty : w().waiting, 'muted'));
    messages(); controls();
    if (focused) Array.from(files.querySelectorAll<HTMLButtonElement>('button')).find(button => button.dataset.document === focused)?.focus({ preventScroll: true });
  }
  function reset() {
    sequence++; epoch = workspaceEpoch; root = null; entries = []; selected = ''; loaded = truncated = hasBody = listing = readingFile = false;
    headingTargets.clear();
    listMessage = readMessage = ''; attempted = false; search.value = ''; body.replaceChildren(); toc.replaceChildren(); path.textContent = ''; host.setAttribute('aria-busy', 'false'); body.setAttribute('aria-busy', 'false'); renderList();
  }
  function resolveLink(value: string) {
    if (!value || value.length > 2048) return null;
    const hash = value.indexOf('#');
    let file: string, fragment: string;
    try { file = decodeURIComponent(hash < 0 ? value : value.slice(0, hash)); fragment = hash < 0 ? '' : decodeURIComponent(value.slice(hash + 1)); } catch { return null; }
    if (/^[\/]/.test(file) || /[\x00-\x1f\x7f\\:?<>|%]/.test(file) || /[\x00-\x1f\x7f]/.test(fragment)) return null;
    const parts = selected.split('/').slice(0, -1);
    if (file) for (const part of file.split('/')) {
      if (part === '.') continue;
      if (part === '..') { if (!parts.length) return null; parts.pop(); }
      else { if (!part) return null; parts.push(part); }
    }
    const target = file ? parts.join('/') : selected;
    return entries.some(item => item.path === target) ? { file: target, fragment } : null;
  }
  function jump(fragment: string) {
    const heading = headingTargets.get(fragment);
    if (!heading) { readMessage = w().missingHeading; messages(); return; }
    readMessage = ''; messages(); if (narrow()) contents.open = false;
    heading.scrollIntoView({ block: 'start', behavior: 'instant' }); heading.focus({ preventScroll: true });
  }
  // Markdown subset, bounded DOM. No parser-generated HTML or source-owned resource URLs/IDs.
  function renderMarkdown(source: string) {
    body.replaceChildren(); toc.replaceChildren(); headingTargets.clear();
    const sourceFile = selected, project = root, owner = epoch;
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const plain = () => { headingTargets.clear(); const pre = el('pre', source); pre.tabIndex = 0; body.replaceChildren(el('p', w().plain, 'muted'), pre); toc.replaceChildren(el('p', w().noHeadings, 'muted')); };
    if (lines.length > 4000) { plain(); return; }
    // One shared node budget covers blocks, table cells, inline spans, text and TOC.
    let tokens = 4000, headings = 0;
    const make = (tag: string, value = '', cls = '') => { if ((tokens -= 2) < 0) throw Error('Reader budget'); const node = el(tag, value, cls); if (tag === 'pre') node.tabIndex = 0; return node; };
    const text = (node: HTMLElement, value: string) => { if (--tokens < 0) throw Error('Reader budget'); node.append(document.createTextNode(value)); };
    const inline = (node: HTMLElement, value: string) => {
      let at = 0, start = 0;
      while (at < value.length) {
        const c = value[at];
        // Only listed relative Markdown links get an inert, constant href and an internal handler.
        if (c === '<' || c === '[' || (c === '!' && value[at + 1] === '[') || value.startsWith('https://', at) || value.startsWith('http://', at)) {
          let end: number, close = -1;
          if (c === '<') end = value.indexOf('>', at + 1);
          else if (c === '[' || c === '!') { close = value.indexOf(']', at + 1); end = close < 0 ? -1 : value[close + 1] === '(' ? value.indexOf(')', close + 2) : close; }
          else { const space = value.slice(at).search(/\s/); end = space < 0 ? value.length - 1 : at + space - 1; }
          if (end < 0) { at = value.length; break; }
          const target = c === '[' && value[close + 1] === '(' && value[at - 1] !== '!' && value[at - 1] !== '\\' ? resolveLink(value.slice(close + 2, end)) : null;
          if (target) {
            text(node, value.slice(start, at)); const link = make('a', value.slice(at + 1, close), 'reader-link'); link.setAttribute('href', '#documents-section');
            link.addEventListener('click', event => {
              event.preventDefault();
              if (owner !== epoch || owner !== workspaceEpoch || project !== root || snapshot?.workspace !== project || sourceFile !== selected || !active()) return;
              if (target.file === selected && hasBody) { if (target.fragment) jump(target.fragment); }
              else void read(target.file, true, target.fragment);
            }); node.append(link); start = end + 1;
          }
          at = end + 1; continue;
        }
        if (c === '\n') { text(node, value.slice(start, at)); node.append(make('br')); start = ++at; continue; }
        const mark = c === '`' ? '`' : value.startsWith('**', at) ? '**' : value.startsWith('__', at) ? '__' : value.startsWith('~~', at) ? '~~' : c === '*' || (c === '_' && !/[\w]/.test(value[at - 1] || '')) ? c : '';
        if (!mark) { at++; continue; }
        const end = value.indexOf(mark, at + mark.length);
        if (end < 0) { at = value.length; break; }
        const content = value.slice(at + mark.length, end);
        if (!content || /\s/.test(content[0]) || /\s/.test(content[content.length - 1])) { at++; continue; }
        text(node, value.slice(start, at)); node.append(make(mark === '`' ? 'code' : mark.length === 1 ? 'em' : mark === '~~' ? 'del' : 'strong', content));
        start = at = end + mark.length;
      }
      text(node, value.slice(start));
    };
    const join = (rows: string[]) => rows.reduce((value, row, index) => {
      const hard = row.endsWith('  ') || row.endsWith('\\'), clean = (row.endsWith('\\') ? row.slice(0, -1) : row).trim();
      const gap = !index || value.endsWith('\n') || /[\u2e80-\u9fff\uf900-\ufaff]/.test(value.slice(-1)) && /^[\u2e80-\u9fff\uf900-\ufaff]/.test(clean) ? '' : ' ';
      return value + gap + clean + (hard ? '\n' : '');
    }, '');
    let fence = '', code: string[] = [], paragraph: string[] = [];
    let lists: Array<{ indent: number; node: HTMLElement; last: HTMLElement }> = [];
    const flush = () => { if (paragraph.length) { const p = make('p'); inline(p, join(paragraph)); body.append(p); paragraph = []; } lists = []; };
    const addHeading = (level: number, value: string) => {
      flush(); const h = make(`h${level}`); inline(h, value); h.tabIndex = -1; body.append(h);
      const slug = (h.textContent || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
      let key = slug, duplicate = 0; while (headingTargets.has(key)) key = `${slug}-${++duplicate}`;
      headingTargets.set(key, h);
      if (++headings <= 200) {
        const button = make('button', value) as HTMLButtonElement; button.type = 'button'; button.dataset.level = String(level);
        button.addEventListener('click', () => { if (narrow()) contents.open = false; h.scrollIntoView({ block: 'start', behavior: 'instant' }); h.focus({ preventScroll: true }); }); toc.append(button);
      }
    };
    const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(value => value.trim());
    try {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i], mark = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (fence) {
          if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && /^\s*$/.test(line.slice(mark[0].length))) { const pre = make('pre'); pre.append(make('code', code.join('\n'))); body.append(pre); fence = ''; code = []; }
          else code.push(line);
          continue;
        }
        if (mark) { flush(); fence = mark[1]; continue; }
        // Recognize only the prefix with regex; trailing hashes/space are scanned linearly.
        const h = line.match(/^[ \t]{0,3}(#{1,6})(?:[ \t]+|$)/);
        if (h) {
          let value = line.slice(h[0].length).trimEnd(), end = value.length;
          while (end > 0 && value[end - 1] === '#') end--;
          if (end < value.length && (end === 0 || value[end - 1] === ' ' || value[end - 1] === '\t')) value = value.slice(0, end).trimEnd();
          addHeading(h[1].length, value); continue;
        }
        if (line.trim() && i + 1 < lines.length && /^\s{0,3}(=+|-+)\s*$/.test(lines[i + 1])) { addHeading(lines[++i].trim()[0] === '=' ? 1 : 2, line); continue; }
        if (!line.trim()) { flush(); continue; }
        if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) { flush(); body.append(make('hr')); continue; }
        if (line.includes('|') && i + 1 < lines.length && cells(lines[i + 1]).every(cell => /^:?-{3,}:?$/.test(cell)) && cells(line).length === cells(lines[i + 1]).length) {
          flush(); const wrap = make('div', '', 'reader-table'), table = make('table'), header = make('thead'), rows = make('tbody'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', locale === 'zh-CN' ? '表格 · 可横向滚动' : 'Table · scroll horizontally');
          const row = (values: string[], tag: string, parent: HTMLElement) => { const tr = make('tr'); for (const value of values) { const cell = make(tag); if (tag === 'th') cell.setAttribute('scope', 'col'); inline(cell, value); tr.append(cell); } parent.append(tr); };
          row(cells(line), 'th', header); i++;
          while (i + 1 < lines.length && lines[i + 1].trim() && lines[i + 1].includes('|')) row(cells(lines[++i]), 'td', rows);
          table.append(header, rows); wrap.append(table); body.append(wrap); continue;
        }
        const item = line.match(/^(\s*)(?:([-+*])|\d+[.)])\s+(.+)$/);
        if (item) {
          if (paragraph.length) flush();
          const indent = item[1].replace(/\t/g, '    ').length, tag = item[2] ? 'ul' : 'ol';
          while (lists.length && lists[lists.length - 1].indent > indent) lists.pop();
          let entry = lists[lists.length - 1];
          if (entry?.indent === indent && entry.node.tagName.toLowerCase() !== tag) { lists.pop(); entry = lists[lists.length - 1]; }
          if (!entry || entry.indent < indent && lists.length < 8) {
            const node = make(tag); if (entry?.last) entry.last.append(node); else body.append(node);
            entry = { indent, node, last: null }; lists.push(entry);
          }
          const li = make('li'), task = item[3].match(/^\[([ xX])\]\s+(.*)$/);
          if (task) { li.className = 'reader-task'; const checked = task[1] !== ' '; const icon = make('span', checked ? '☑' : '☐', 'reader-task-mark'); icon.setAttribute('role', 'img'); icon.setAttribute('aria-label', locale === 'zh-CN' ? checked ? '已完成' : '未完成' : checked ? 'Completed' : 'Not completed'); li.append(icon); inline(li, task[2]); }
          else inline(li, item[3]); entry.node.append(li); entry.last = li; continue;
        }
        if (/^\s*>/.test(line)) { flush(); const quote = make('blockquote'), rows = [line.replace(/^\s*>\s?/, '')]; while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) rows.push(lines[++i].replace(/^\s*>\s?/, '')); const p = make('p'); inline(p, join(rows)); quote.append(p); body.append(quote); continue; }
        lists = []; paragraph.push(line);
      }
      flush(); if (fence) { const pre = make('pre'); pre.append(make('code', code.join('\n'))); body.append(pre); }
      if (!headings) toc.append(make('p', w().noHeadings, 'muted'));
    } catch { plain(); }
  }
  async function read(file: string, moveFocus = false, fragment = '') {
    if (!root || busy || listing || !navigator.onLine) return;
    const owner = epoch, project = root, request = ++sequence;
    selected = file; readingFile = true; hasBody = false; body.replaceChildren(); toc.replaceChildren(); path.textContent = file; readMessage = w().loading;
    headingTargets.clear();
    renderList(); body.setAttribute('aria-busy', 'true');
    try {
      const result = await invoke('governance.documents', { action: 'read', path: file });
      if (!current(owner, project, request)) return;
      if (result.workspace !== project || result.path !== file || typeof result.content !== 'string' || result.content.length > 262144) throw Error('Invalid document response');
      renderMarkdown(result.content); hasBody = true; readMessage = '';
      if (moveFocus && active()) { if (narrow()) library.open = contents.open = false; body.focus({ preventScroll: true }); body.scrollIntoView({ block: 'start', behavior: 'instant' }); }
      if (fragment && active()) jump(fragment);
    } catch { if (current(owner, project, request)) readMessage = w().error; }
    finally { if (owns(owner, project, request)) { readingFile = false; if (readMessage === w().loading) readMessage = w().error; body.setAttribute('aria-busy', 'false'); messages(); controls(); } }
  }
  async function reload() {
    if (!root || busy || listing || !navigator.onLine) return;
    const owner = epoch, project = root, request = ++sequence, previous = selected;
    attempted = true; listing = true; readingFile = false; loaded = false; entries = []; selected = ''; hasBody = false; path.textContent = ''; body.replaceChildren(); toc.replaceChildren();
    headingTargets.clear();
    listMessage = readMessage = w().loading; renderList(); host.setAttribute('aria-busy', 'true');
    try {
      const result = await invoke('governance.documents', { action: 'list' });
      if (!current(owner, project, request)) return;
      if (result.workspace !== project || !Array.isArray(result.files) || result.files.length > 500 || result.files.some(item => typeof item.path !== 'string' || item.path.length > 2048 || !Number.isSafeInteger(item.bytes) || item.bytes < 0)) throw Error('Invalid document list');
      entries = result.files; loaded = true; truncated = result.truncated === true; listMessage = readMessage = '';
    } catch { if (current(owner, project, request)) listMessage = readMessage = w().error; }
    finally {
      if (owns(owner, project, request)) {
        listing = false; if (listMessage === w().loading) listMessage = readMessage = w().error; host.setAttribute('aria-busy', 'false'); renderList();
        if (loaded && entries.some(item => item.path === previous)) void read(previous);
      }
    }
  }
  function context() {
    head.hidden = !active(); fold();
    if (epoch !== workspaceEpoch) reset();
    if (!snapshot?.workspace) return;
    if (root !== snapshot.workspace) { reset(); root = snapshot.workspace; epoch = workspaceEpoch; }
    controls(); if (active() && !attempted && !listing && !busy) void reload();
  }
  function localize() {
    const zh = locale === 'zh-CN';
    badge.textContent = w().read; hint.textContent = w().hint; refresh.textContent = w().refresh;
    focus.textContent = zh ? '专注阅读' : 'Focus';
    smaller.setAttribute('aria-label', zh ? '缩小正文' : 'Smaller text'); larger.setAttribute('aria-label', zh ? '放大正文' : 'Larger text');
    libraryTitle.textContent = w().library; labelText.textContent = w().search; search.placeholder = w().search; tocTitle.textContent = w().contents;
    host.setAttribute('aria-label', w().title); toc.setAttribute('aria-label', w().contents); body.setAttribute('aria-label', w().title); renderList();
  }
  refresh.addEventListener('click', () => { void reload(); }); search.addEventListener('input', renderList);
  window.addEventListener('hashchange', context);
  window.addEventListener('documents-context', context);
  window.addEventListener('documents-reset', reset);
  window.addEventListener('documents-controls', () => { context(); controls(); });
  window.addEventListener('offline', () => { sequence++; listing = readingFile = false; host.setAttribute('aria-busy', 'false'); body.setAttribute('aria-busy', 'false'); readMessage = ''; messages(); controls(); });
  window.addEventListener('online', () => { messages(); controls(); });
  window.addEventListener('pagehide', reset);
  window.addEventListener('pageshow', context);
  localize(); void localeReady.then(() => { localize(); context(); });
})();
