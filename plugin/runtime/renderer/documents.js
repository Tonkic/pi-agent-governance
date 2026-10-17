'use strict';
// Read-only project reader. Source strings never become markup, attributes or resource URLs.
(() => {
    const host = document.getElementById('documents-section');
    const words = {
        en: { title: 'Project documents', library: 'Document library', hint: 'Read-only · root guides, docs/ and notes/ Markdown. Links, images and HTML stay text; nothing is executed or loaded.', refresh: 'Refresh documents', search: 'Search filenames', choose: 'Select a document to read', empty: 'No matching Markdown documents', waiting: 'Connect to a project first', loading: 'Reading…', contents: 'On this page', noHeadings: 'No headings', offline: 'Offline · loaded text remains available. Reconnect and refresh to read files.', error: 'Could not read documents. Refresh to try again.', count: 'documents', limited: 'List is limited: at most 500 files, 4000 entries, depth 8, 256 KiB per file. Some files may be omitted.', plain: 'Large line count: shown as plain text to keep the reader responsive.', cached: 'Loaded snapshot · refresh to read external changes', read: 'Read-only' },
        zh: { title: '项目文档', library: '文档库', hint: '只读 · 根目录说明及 docs/、notes/ 中的 Markdown。链接、图片和 HTML 仅显示文本，不执行或加载资源。', refresh: '刷新文档', search: '搜索文件名', choose: '选择一篇文档开始阅读', empty: '没有匹配的 Markdown 文档', waiting: '请先连接项目', loading: '正在读取…', contents: '本页目录', noHeadings: '暂无标题', offline: '离线 · 已加载正文仍可阅读。恢复连接后刷新以读取文件。', error: '文档读取失败，请刷新重试。', count: '篇文档', limited: '列表有限额：最多 500 个文件、扫描 4000 个条目、8 层目录、每文件 256 KiB；部分文件可能未列出。', plain: '文档行数较多，已采用纯文本显示以保持流畅。', cached: '已加载快照 · 外部修改后请刷新', read: '只读' }
    };
    const w = () => words[locale === 'zh-CN' ? 'zh' : 'en'];
    const el = (tag, text = '', className = '') => {
        const node = document.createElement(tag);
        node.textContent = text;
        node.className = className;
        return node;
    };
    const id = (node, value) => { node.id = value; return node; };
    const head = el('div', '', 'section-head');
    const heading = el('h2');
    const badge = el('span', '', 'badge');
    head.append(heading, badge);
    const hint = el('p', '', 'muted');
    const refresh = id(el('button'), 'documents-refresh');
    refresh.type = 'button';
    const layout = el('div', '', 'reader-layout');
    const library = el('aside', '', 'reader-library');
    const libraryTitle = el('h3');
    const label = el('label');
    const labelText = el('span');
    const search = id(el('input'), 'documents-search');
    search.type = 'search';
    search.maxLength = 200;
    search.autocomplete = 'off';
    label.append(labelText, search);
    const count = id(el('p', '', 'muted'), 'documents-count');
    const files = id(el('div', '', 'reader-files'), 'documents-files');
    library.append(libraryTitle, label, count, files);
    const reading = el('div', '', 'reader-reading');
    const status = id(el('p', '', 'reader-status'), 'documents-status');
    status.setAttribute('role', 'status');
    const path = id(el('h3', '', 'reader-path'), 'documents-path');
    const body = id(el('article', '', 'reader-prose'), 'documents-body');
    body.tabIndex = 0;
    const contents = el('aside', '', 'reader-contents');
    const tocTitle = el('h3');
    const toc = id(el('nav'), 'documents-toc');
    contents.append(tocTitle, toc);
    reading.append(status, path, body);
    layout.append(library, reading, contents);
    host.append(head, hint, refresh, layout);
    let root = null, epoch = -1, sequence = 0, listing = false, readingFile = false;
    let entries = [], selected = '', loaded = false, truncated = false;
    let listMessage = '', readMessage = '', hasBody = false, attempted = false;
    const active = () => location.hash === '#documents-section';
    const current = (owner, project, request) => owner === workspaceEpoch && owner === epoch && project === root && snapshot?.workspace === root && request === sequence;
    function controls() {
        refresh.disabled = !root || !snapshot || busy || listing || readingFile || !navigator.onLine;
        search.disabled = !loaded; // Local filtering and TOC are usable offline and while writes are busy.
        files.querySelectorAll('button').forEach(button => { button.disabled = !navigator.onLine || !snapshot || busy || listing; });
        toc.querySelectorAll('button').forEach(button => { button.disabled = false; });
    }
    function messages() {
        status.textContent = !navigator.onLine ? w().offline : readMessage || (hasBody ? w().cached : w().choose);
        count.textContent = listMessage || `${entries.filter(item => item.path.toLocaleLowerCase().includes(search.value.toLocaleLowerCase().trim())).length} / ${entries.length} ${w().count}${truncated ? ' · ' + w().limited : ''}`;
        status.classList.toggle('reader-error', readMessage === w().error);
    }
    function renderList() {
        const query = search.value.trim().toLocaleLowerCase();
        const matching = entries.filter(item => item.path.toLocaleLowerCase().includes(query));
        files.replaceChildren(...matching.map(item => {
            const button = el('button', '', 'reader-file');
            button.type = 'button';
            button.dataset.document = item.path;
            button.setAttribute('aria-pressed', String(item.path === selected));
            button.append(el('span', item.path), el('small', `${Math.ceil(item.bytes / 1024)} KiB`));
            button.addEventListener('click', () => { void read(item.path); });
            return button;
        }));
        if (!matching.length)
            files.append(el('p', loaded ? w().empty : w().waiting, 'muted'));
        messages();
        controls();
    }
    function reset() {
        sequence++;
        epoch = workspaceEpoch;
        root = null;
        entries = [];
        selected = '';
        loaded = truncated = hasBody = listing = readingFile = false;
        listMessage = readMessage = '';
        attempted = false;
        search.value = '';
        body.replaceChildren();
        toc.replaceChildren();
        path.textContent = '';
        host.setAttribute('aria-busy', 'false');
        body.setAttribute('aria-busy', 'false');
        renderList();
    }
    // Markdown subset, bounded DOM. No parser-generated HTML, URLs, images, styles or IDs from source.
    function renderMarkdown(source) {
        body.replaceChildren();
        toc.replaceChildren();
        const lines = source.replace(/\r\n?/g, '\n').split('\n');
        let tokens = 4000, headings = 0;
        const inline = (node, value) => {
            const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__)/g;
            let from = 0;
            for (const match of value.matchAll(pattern)) {
                if (--tokens < 0)
                    break;
                node.append(document.createTextNode(value.slice(from, match.index)));
                node.append(el(match[0][0] === '`' ? 'code' : 'strong', match[0].slice(match[0][0] === '`' ? 1 : 2, match[0][0] === '`' ? -1 : -2)));
                from = match.index + match[0].length;
            }
            node.append(document.createTextNode(value.slice(from)));
        };
        if (lines.length > 4000) {
            body.append(el('p', w().plain, 'muted'), el('pre', source));
            toc.append(el('p', w().noHeadings, 'muted'));
            return;
        }
        let fence = '', code = [], paragraph = [], list = null;
        const flush = () => { if (paragraph.length) {
            const p = el('p');
            inline(p, paragraph.join('\n'));
            body.append(p);
            paragraph = [];
        } list = null; };
        const addHeading = (level, value) => {
            flush();
            const h = el(`h${level}`);
            inline(h, value);
            h.tabIndex = -1;
            body.append(h);
            if (++headings <= 200) {
                const button = el('button', value);
                button.type = 'button';
                button.dataset.level = String(level);
                button.addEventListener('click', () => { h.scrollIntoView({ block: 'start', behavior: 'instant' }); h.focus({ preventScroll: true }); });
                toc.append(button);
            }
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i], mark = line.match(/^\s{0,3}(`{3,}|~{3,})/);
            if (fence) {
                if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && /^\s*$/.test(line.slice(mark[0].length))) {
                    const pre = el('pre');
                    pre.append(el('code', code.join('\n')));
                    body.append(pre);
                    fence = '';
                    code = [];
                }
                else
                    code.push(line);
                continue;
            }
            if (mark) {
                flush();
                fence = mark[1];
                continue;
            }
            const h = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
            if (h) {
                addHeading(h[1].length, h[2]);
                continue;
            }
            if (line.trim() && i + 1 < lines.length && /^\s{0,3}(=+|-+)\s*$/.test(lines[i + 1])) {
                addHeading(lines[++i].trim()[0] === '=' ? 1 : 2, line);
                continue;
            }
            if (!line.trim()) {
                flush();
                continue;
            }
            if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
                flush();
                body.append(el('hr'));
                continue;
            }
            const item = line.match(/^\s*(?:([-+*])|\d+[.)])\s+(.+)$/);
            if (item) {
                if (paragraph.length)
                    flush();
                const tag = item[1] ? 'ul' : 'ol';
                if (!list || list.tagName.toLowerCase() !== tag) {
                    list = el(tag);
                    body.append(list);
                }
                const li = el('li');
                inline(li, item[2]);
                list.append(li);
                continue;
            }
            if (/^\s*>/.test(line)) {
                flush();
                const quote = el('blockquote');
                inline(quote, line.replace(/^\s*>\s?/, ''));
                body.append(quote);
                continue;
            }
            list = null;
            paragraph.push(line);
        }
        flush();
        if (fence) {
            const pre = el('pre');
            pre.append(el('code', code.join('\n')));
            body.append(pre);
        }
        if (!headings)
            toc.append(el('p', w().noHeadings, 'muted'));
    }
    async function read(file) {
        if (!root || busy || listing || !navigator.onLine)
            return;
        const owner = epoch, project = root, request = ++sequence;
        selected = file;
        readingFile = true;
        hasBody = false;
        body.replaceChildren();
        toc.replaceChildren();
        path.textContent = file;
        readMessage = w().loading;
        renderList();
        body.setAttribute('aria-busy', 'true');
        try {
            const result = await invoke('governance.documents', { action: 'read', path: file });
            if (!current(owner, project, request))
                return;
            if (result.workspace !== project || result.path !== file || typeof result.content !== 'string' || result.content.length > 262144)
                throw Error('Invalid document response');
            renderMarkdown(result.content);
            hasBody = true;
            readMessage = '';
        }
        catch {
            if (current(owner, project, request))
                readMessage = w().error;
        }
        finally {
            if (current(owner, project, request)) {
                readingFile = false;
                body.setAttribute('aria-busy', 'false');
                messages();
                controls();
            }
        }
    }
    async function reload() {
        if (!root || busy || listing || !navigator.onLine)
            return;
        const owner = epoch, project = root, request = ++sequence, previous = selected;
        attempted = true;
        listing = true;
        readingFile = false;
        loaded = false;
        entries = [];
        selected = '';
        hasBody = false;
        path.textContent = '';
        body.replaceChildren();
        toc.replaceChildren();
        listMessage = readMessage = w().loading;
        renderList();
        host.setAttribute('aria-busy', 'true');
        try {
            const result = await invoke('governance.documents', { action: 'list' });
            if (!current(owner, project, request))
                return;
            if (result.workspace !== project || !Array.isArray(result.files) || result.files.length > 500 || result.files.some(item => typeof item.path !== 'string' || item.path.length > 1024 || !Number.isSafeInteger(item.bytes) || item.bytes < 0))
                throw Error('Invalid document list');
            entries = result.files;
            loaded = true;
            truncated = result.truncated === true;
            listMessage = readMessage = '';
        }
        catch {
            if (current(owner, project, request))
                listMessage = readMessage = w().error;
        }
        finally {
            if (current(owner, project, request)) {
                listing = false;
                host.setAttribute('aria-busy', 'false');
                renderList();
                if (loaded && entries.some(item => item.path === previous))
                    void read(previous);
            }
        }
    }
    function context() {
        if (epoch !== workspaceEpoch)
            reset();
        if (!snapshot?.workspace)
            return;
        if (root !== snapshot.workspace) {
            reset();
            root = snapshot.workspace;
            epoch = workspaceEpoch;
        }
        controls();
        if (active() && !attempted && !listing && !busy)
            void reload();
    }
    function localize() {
        heading.textContent = w().title;
        badge.textContent = w().read;
        hint.textContent = w().hint;
        refresh.textContent = w().refresh;
        libraryTitle.textContent = w().library;
        labelText.textContent = w().search;
        search.placeholder = w().search;
        tocTitle.textContent = w().contents;
        host.setAttribute('aria-label', w().title);
        toc.setAttribute('aria-label', w().contents);
        body.setAttribute('aria-label', w().title);
        renderList();
    }
    refresh.addEventListener('click', () => { void reload(); });
    search.addEventListener('input', renderList);
    window.addEventListener('hashchange', context);
    window.addEventListener('documents-context', context);
    window.addEventListener('documents-reset', reset);
    window.addEventListener('documents-controls', () => { context(); controls(); });
    window.addEventListener('offline', () => { sequence++; listing = readingFile = false; host.setAttribute('aria-busy', 'false'); body.setAttribute('aria-busy', 'false'); readMessage = ''; messages(); controls(); });
    window.addEventListener('online', () => { messages(); controls(); });
    window.addEventListener('pagehide', reset);
    localize();
    void localeReady.then(() => { localize(); context(); });
})();
