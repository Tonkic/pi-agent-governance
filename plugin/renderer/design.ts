'use strict';
let designSnapshot: any = null,
  designSelection = 'baseline',
  reviewedDesign: any = null;
const designElement = (id: string): any => document.getElementById(id);
function resetDesign() {
  designSnapshot = null;
  reviewedDesign = null;
  designSelection = 'baseline';
  for (const name of ['begin', 'confirm']) {
    const dialog = designElement(`design-${name}-dialog`);
    if (dialog.open) dialog.close('cancel');
    designElement(`design-${name}-form`).reset();
  }
}
async function loadDesign(owner, current) {
  try {
    const data = await invoke('governance.design', { action: 'snapshot' });
    if (!current() || owner !== workspaceEpoch) return;
    if (data.workspace !== snapshot?.workspace) throw Error(t('switched'));
    designSnapshot = data;
    designSelection = data.baseline ? 'baseline' : data.draft ? 'draft' : 'baseline';
  } catch (e) {
    if (!current() || owner !== workspaceEpoch) return;
    designSnapshot = { error: e.message };
  }
  if (current()) renderProjectGraph();
}
function selectedDesign() {
  if (designSelection === 'draft') return designSnapshot?.draft;
  if (designSelection === 'baseline') return designSnapshot?.baseline;
  return designSnapshot?.history?.find((b) => String(b.number) === designSelection) || null;
}
function designGraphView() {
  const selected = selectedDesign();
  const graph = selected?.proposal || null;
  text('architecture-title', t('designTitle'));
  text('graph-overview', graph?.title || t('designEmpty'));
  text('graph-source', t('designScope'));
  text(
    'graph-check-state',
    selected
      ? designSelection === 'draft'
        ? t('designDraftState', selected.baseVersion, selected.reason)
        : t('designBaselineState', selected.number, selected.confirmedAt, selected.reviewer)
      : t('designEmpty')
  );
  return {
    graph,
    message: designSnapshot?.error
      ? t('designError', designSnapshot.error)
      : !designSnapshot
        ? t('reading')
        : !graph
          ? t(designSnapshot?.draft ? 'designAwaitingProposal' : 'designEmpty')
          : ''
  };
}
function renderDesign() {
  designElement('design-controls').hidden = graphView !== 'design';
  designElement('show-design').setAttribute('aria-pressed', String(graphView === 'design'));
  const select = designElement('design-version');
  const options = [];
  if (designSnapshot?.baseline)
    options.push(launchOption('baseline', t('designCurrent', designSnapshot.baseline.number)));
  if (designSnapshot?.draft) options.push(launchOption('draft', t('designDraft')));
  for (const b of [...(designSnapshot?.history || [])].reverse().slice(1))
    options.push(launchOption(String(b.number), t('designHistory', b.number)));
  select.replaceChildren(...options);
  select.value = designSelection;
  const selected = selectedDesign();
  text(
    'design-document',
    selected?.documentBody ?? selected?.proposal?.document ?? t('designAwaitingProposal')
  );
  text('design-ascii', selected?.ascii || t('designAwaitingProposal'));
  designElement('design-ascii-section').hidden = graphView !== 'design' || !selected?.proposal;
  text('design-scope-note', t('designScope'));
  text(
    'design-record',
    selected
      ? designSelection === 'draft'
        ? t('designDraftState', selected.baseVersion, selected.reason)
        : t('designBaselineState', selected.number, selected.confirmedAt, selected.reviewer)
      : t('designEmpty')
  );
  const diff = designSelection === 'draft' ? designSnapshot?.diff : null;
  const lines = diff
    ? [
        t(
          'designNodeDiff',
          diff.addedNodes.join(' / ') || t('none'),
          diff.removedNodes.join(' / ') || t('none'),
          diff.changedNodes.join(' / ') || t('none')
        ),
        t(
          'designEdgeDiff',
          diff.addedEdges.join(' / ') || t('none'),
          diff.removedEdges.join(' / ') || t('none'),
          diff.changedEdges.join(' / ') || t('none')
        ),
        t(diff.documentChanged || diff.titleChanged ? 'designTextChanged' : 'designTextUnchanged'),
        t(diff.asciiChanged ? 'designAsciiChanged' : 'designAsciiUnchanged')
      ]
    : [t('designNoDiff')];
  text('design-diff', lines.join('\n'));
  text(
    'design-previous-document',
    designSnapshot?.baseline?.documentBody ??
      designSnapshot?.baseline?.proposal?.document ??
      t('none')
  );
  designElement('design-diff-details').hidden = !diff;
  text('design-begin', t(designSnapshot?.baseline ? 'designRevise' : 'designFirst'));
  updateDesignControls();
}
function updateDesignControls() {
  const blocked =
    busy ||
    !navigator.onLine ||
    !snapshot?.state?.task ||
    !designSnapshot?.revision ||
    !!designSnapshot?.error;
  const draft = designSnapshot?.draft;
  designElement('design-begin').disabled = blocked || !!draft;
  designElement('design-start').disabled =
    blocked || !draft || draft.taskId !== snapshot?.state?.task;
  designElement('design-discard').disabled = blocked || !draft;
  designElement('design-review').disabled =
    blocked ||
    !draft?.proposal ||
    designSelection !== 'draft' ||
    draft.taskId !== snapshot?.state?.task;
  designElement('design-version').disabled = busy || (!designSnapshot?.history?.length && !draft);
  for (const name of ['begin', 'confirm'])
    designElement(`design-${name}-submit`).disabled = blocked;
}
async function designWrite(action, fields, submitted?) {
  if (busy || !navigator.onLine || !designSnapshot?.revision) return false;
  const owner = workspaceEpoch,
    revision = reviewedDesign?.revision || designSnapshot.revision;
  lock(true);
  try {
    const message = t(
      action === 'confirm'
        ? 'designConfirmWrite'
        : action === 'discard'
          ? 'designDiscardWrite'
          : 'designBeginWrite'
    );
    if (!(await confirmWrite(message + '\n' + discardWarning(submitted)))) return false;
    if (owner !== workspaceEpoch || !navigator.onLine) return false;
    await invoke('governance.design', { action, revision, ...fields, confirmed: true });
    if (owner !== workspaceEpoch) return false;
    await load();
    if (owner !== workspaceEpoch) return false;
    graphView = 'design';
    renderProjectGraph();
    notify(t('designSaved'));
    return true;
  } catch (e) {
    if (owner === workspaceEpoch) notify(e.message, true);
    return false;
  } finally {
    if (owner === workspaceEpoch) {
      lock(false);
      updateDesignControls();
    }
  }
}
async function closeDesignDialog(name) {
  if (busy) return;
  const owner = workspaceEpoch,
    form = `design-${name}-form`;
  if (dirtyForms.has(form) && !(await confirmWrite(t('switchDraft')))) return;
  if (owner !== workspaceEpoch) return;
  dirtyForms.delete(form);
  edited = dirtyForms.size > 0;
  designElement(form).reset();
  designElement(`design-${name}-dialog`).close();
  reviewedDesign = null;
}
designElement('show-design').addEventListener('click', () => {
  graphView = 'design';
  renderProjectGraph();
});
designElement('design-version').addEventListener('change', () => {
  designSelection = designElement('design-version').value;
  renderProjectGraph();
});
designElement('design-begin').addEventListener('click', () => {
  if (designElement('design-begin').disabled) return;
  reviewedDesign = null;
  text('design-begin-title', t(designSnapshot.baseline ? 'designRevise' : 'designFirst'));
  designElement('design-begin-dialog').showModal();
  designElement('design-reason').focus();
});
designElement('design-begin-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void designWrite('begin', { reason: designElement('design-reason').value }, 'design-begin-form');
});
designElement('design-discard').addEventListener('click', () => {
  reviewedDesign = null;
  void designWrite('discard', {});
});
designElement('design-start').addEventListener('click', () => {
  void startOperation('design');
});
designElement('design-review').addEventListener('click', () => {
  if (designElement('design-review').disabled) return;
  reviewedDesign = {
    revision: designSnapshot.revision,
    fingerprint: designSnapshot.draft.proposalFingerprint
  };
  text('design-reviewed-title', designSnapshot.draft.proposal.title);
  designElement('design-confirm-dialog').showModal();
  designElement('design-reviewer').focus();
});
designElement('design-confirm-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!reviewedDesign || !designElement('design-reviewed').checked) return;
  void designWrite(
    'confirm',
    {
      expectedProposal: reviewedDesign.fingerprint,
      reviewer: designElement('design-reviewer').value,
      conclusion: designElement('design-conclusion').value
    },
    'design-confirm-form'
  );
});
for (const name of ['begin', 'confirm']) {
  for (const suffix of ['close', 'cancel'])
    designElement(`design-${name}-${suffix}`).addEventListener('click', () => {
      void closeDesignDialog(name);
    });
  designElement(`design-${name}-dialog`).addEventListener('cancel', (event) => {
    event.preventDefault();
    void closeDesignDialog(name);
  });
}
