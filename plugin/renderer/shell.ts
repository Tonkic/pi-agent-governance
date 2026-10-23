'use strict';
// Presentation-only shell. It reads loaded snapshots; never invokes APIs or changes project data.
const pageIds = ['board-section', 'architecture', 'git-section', 'documents-section', 'behaviors-section'];
function closeWorkbenchDisclosures() {
  for (const id of ['project-tools', 'project-overview']) {
    const details = document.getElementById(id) as HTMLDetailsElement;
    if (details) details.open = false;
  }
}
function renderWorkbenchSummary(loading = false) {
  const workspace = snapshot?.workspace;
  text('summary-workspace-name', workspace ? workspace.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || workspace : '—');
  text('summary-workspace-path', workspace || '—');
  text('summary-state', snapshot ? (snapshot.state ? labels[snapshot.state.status] || snapshot.state.status : t('uninitialized')) : '—');
  text('summary-task', snapshot?.state?.task || (snapshot ? t('noTask') : '—'));
  const items = projectSnapshot?.board && !projectSnapshot.boardError ? projectSnapshot.board.items : null;
  const counts = items ? boardStages.map(stage => items.filter(item => effectiveStage(item) === stage).length) : null;
  const total = items?.length;
  const percent = counts && total ? Math.round(counts[2] / total * 100) : counts ? 0 : null;
  for (const [id, value] of [
    ['summary-total', total], ['summary-doing', counts?.[1]], ['summary-done', counts?.[2]], ['summary-active-count', counts?.[1]], ['summary-complete-count', counts?.[2]],
    ['summary-impact', items?.filter(item => item.architectureImpact === 'affects').length], ['summary-todo', counts?.[0]]
  ]) text(id, value == null ? '—' : String(value));
  text('summary-percent', percent == null ? '—' : `${percent}%`);
  $('summary-ring').style.setProperty('--completion', String(percent ?? 0));
  $('summary-ring').dataset.available = String(percent !== null);
  document.querySelectorAll<HTMLElement>('[data-summary-stage]').forEach((segment, index) => {
    const value = counts?.[index] ?? 0;
    segment.style.setProperty('--stage-share', String(total ? value / total * 100 : 0));
  });
  $('summary-stages').dataset.empty = String(!total);
  $('summary-stages').setAttribute('aria-label', counts ? boardStages.map((stage, index) => `${boardLabels[stage]} ${counts[index]}`).join(' · ') : t('summaryUnavailable'));
  $('summary-ring').setAttribute('aria-label', percent == null ? t('summaryUnavailable') : t('summaryRatio', percent, counts[2], total));
  text('summary-availability', loading ? t('reading') : !items ? t('summaryUnavailable') : !navigator.onLine ? t('summaryOffline') : !total ? t('summaryEmpty') : t('summaryLoaded'));
  $('workbench-metrics').setAttribute('aria-busy', String(loading));
}
function highlightNavigation() {
  const requested = location.hash.slice(1);
  const active = pageIds.includes(requested) ? requested : 'board-section';
  document.documentElement.dataset.view = active;
  const pageTitles: Record<string, CopyKey> = { architecture: 'navArchitecture', 'board-section': 'navBoard', 'git-section': 'navGit', 'documents-section': 'navDocuments', 'behaviors-section': 'behaviorDocs' };
  text('page-title', t(pageTitles[active]));
  for (const id of pageIds) $(id).hidden = id !== active;
  document.querySelectorAll<HTMLElement>('[data-page-control]').forEach(control => { control.hidden = control.dataset.pageControl !== active; });
  if (requested === 'task-section') openProjectControls();
  document.querySelectorAll<HTMLAnchorElement>('.workspace-nav a').forEach(link => {
    if (link.hash === `#${active}`) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  if (active === 'architecture') window.dispatchEvent(new Event('resize'));
  updateBehaviorControls();
}
function initializeWorkbenchShell() {
  const info = document.getElementById('local-console-info');
  if (info) {
    const details = document.createElement('details'), summary = document.createElement('summary');
    summary.append(info.querySelector('strong')); details.append(summary, ...Array.from(info.childNodes)); info.append(details);
  }
  localizeNavigation(); void localeReady.then(() => { localizeNavigation(); highlightNavigation(); });
  const nav = $('workspace-navigation');
  nav.addEventListener('pointermove', () => { if (!nav.dataset.dismissed) nav.dataset.hovered = 'true'; });
  nav.addEventListener('pointerleave', () => { delete nav.dataset.hovered; delete nav.dataset.dismissed; });
  nav.addEventListener('click', (event: MouseEvent) => { if (event.detail) { delete nav.dataset.hovered; nav.dataset.dismissed = 'true'; } });
  document.querySelectorAll<HTMLAnchorElement>('.workspace-nav a').forEach(link => link.addEventListener('click', (event: MouseEvent) => {
    if (event.detail) { link.blur(); return; }
    if (location.hash !== link.hash) window.addEventListener('hashchange', () => { if (location.hash === link.hash) link.focus({ preventScroll: true }); }, { once: true });
  }));
  const tools = document.getElementById('project-tools');
  tools?.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape' && (tools as HTMLDetailsElement).open) { event.preventDefault(); (tools as HTMLDetailsElement).open = false; tools.querySelector('summary')?.focus(); }
  });
  window.addEventListener('hashchange', () => { closeItemMenu(false); stopLongPress(); closeWorkbenchDisclosures(); highlightNavigation(); });
  highlightNavigation();
}
