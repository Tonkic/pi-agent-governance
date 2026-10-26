'use strict';
// Local explanatory copy only. No APIs, HTML parsing, persistence, or project writes.
let contextHelpActive = null;
let contextHelpGeneration = 0, contextHelpSequence = 0, contextHelpWarmUntil = 0;
function closeContextHelp() {
    contextHelpGeneration++;
    const active = contextHelpActive;
    contextHelpActive = null;
    if (!active)
        return;
    active.trigger.setAttribute('aria-expanded', 'false');
    if (active.source.isConnected && active.source.matches(':popover-open'))
        active.source.hidePopover();
    contextHelpWarmUntil = performance.now() + 700;
}
function createContextHelp(source, topic) {
    const wrapper = document.createElement('div'), trigger = document.createElement('button');
    wrapper.className = 'context-help';
    if (!source.id)
        source.id = `help-copy-${++contextHelpSequence}`;
    source.classList.add('context-help-popover');
    source.setAttribute('popover', 'manual');
    source.setAttribute('role', 'tooltip');
    trigger.type = 'button';
    trigger.className = 'context-help-trigger';
    trigger.dataset.contextHelp = source.id;
    trigger.setAttribute('aria-describedby', source.id);
    trigger.setAttribute('aria-controls', source.id);
    trigger.setAttribute('aria-expanded', 'false');
    const mark = document.createElement('span');
    mark.textContent = '?';
    mark.setAttribute('aria-hidden', 'true');
    trigger.append(mark);
    const label = () => trigger.setAttribute('aria-label', t('helpFor', topic()));
    label();
    void localeReady.then(label);
    let showTimer, hideTimer;
    const cancelTimers = () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
    const open = (pinned = false) => {
        cancelTimers();
        label();
        if (!trigger.isConnected || !trigger.getClientRects().length || trigger.closest('[hidden]'))
            return;
        if (contextHelpActive?.trigger === trigger) {
            contextHelpActive.pinned ||= pinned;
            return;
        }
        closeContextHelp();
        contextHelpActive = { trigger, source, pinned };
        trigger.setAttribute('aria-expanded', 'true');
        source.showPopover();
        const edge = 12, gap = 8, r = trigger.getBoundingClientRect(), box = source.getBoundingClientRect();
        const x = Math.max(edge, Math.min(innerWidth - box.width - edge, r.left + r.width / 2 - box.width / 2));
        const below = r.bottom + gap;
        const y = below + box.height <= innerHeight - edge ? below : Math.max(edge, r.top - gap - box.height);
        source.style.left = `${x}px`;
        source.style.top = `${y}px`;
    };
    const leave = () => {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (contextHelpActive?.trigger === trigger && !contextHelpActive.pinned && document.activeElement !== trigger && !source.matches(':hover') && !trigger.matches(':hover'))
                closeContextHelp();
        }, 140);
    };
    trigger.addEventListener('pointerenter', event => {
        if (event.pointerType === 'touch' || !matchMedia('(hover: hover)').matches)
            return;
        cancelTimers();
        const generation = contextHelpGeneration;
        showTimer = setTimeout(() => { if (generation === contextHelpGeneration)
            open(); }, performance.now() < contextHelpWarmUntil ? 0 : 300);
    });
    trigger.addEventListener('pointerleave', leave);
    trigger.addEventListener('focus', () => open());
    trigger.addEventListener('blur', () => { cancelTimers(); if (contextHelpActive?.trigger === trigger && !source.matches(':hover'))
        closeContextHelp(); });
    trigger.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (contextHelpActive?.trigger === trigger && contextHelpActive.pinned)
            closeContextHelp();
        else
            open(true);
    });
    source.addEventListener('pointerenter', cancelTimers);
    source.addEventListener('pointerleave', leave);
    wrapper.append(trigger, source);
    return wrapper;
}
function attachContextHelp(source, anchor, topic = () => anchor.textContent.trim()) {
    const row = document.createElement('div');
    row.className = 'context-help-label';
    if (anchor.dataset.pageControl)
        row.dataset.pageControl = anchor.dataset.pageControl;
    anchor.replaceWith(row);
    row.append(anchor, createContextHelp(source, topic));
}
function initializeContextHelp() {
    document.querySelectorAll('[data-help-for]').forEach(source => {
        const anchor = document.getElementById(source.dataset.helpFor);
        if (anchor)
            attachContextHelp(source, anchor, source.dataset.helpTitle ? () => t(source.dataset.helpTitle) : () => anchor.textContent.trim());
    });
    const info = document.getElementById('local-console-info');
    if (info) {
        const title = info.querySelector('strong'), copy = document.createElement('div');
        copy.id = 'local-console-copy';
        for (const child of Array.from(info.childNodes))
            if (child !== title)
                copy.append(child);
        attachContextHelp(copy, title);
    }
    document.addEventListener('pointerdown', event => {
        const active = contextHelpActive, target = event.target;
        if (!active || !active.trigger.contains(target) && !active.source.contains(target))
            closeContextHelp();
    }, true);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            const wasOpen = !!contextHelpActive;
            closeContextHelp();
            if (wasOpen) {
                event.preventDefault();
                event.stopPropagation();
            }
        }
    }, true);
    document.addEventListener('scroll', event => {
        if (!contextHelpActive || !contextHelpActive.source.contains(event.target))
            closeContextHelp();
    }, true);
    document.addEventListener('close', closeContextHelp, true);
    window.addEventListener('resize', closeContextHelp);
    window.addEventListener('hashchange', closeContextHelp);
    document.addEventListener('visibilitychange', () => { if (document.hidden)
        closeContextHelp(); });
}
