'use strict';
let designSnapshot = null, designSelection = 'baseline';
const designElement = (id) => document.getElementById(id);
function resetDesign() {
    designSnapshot = null;
    designSelection = 'baseline';
}
async function loadDesign(owner, current) {
    try {
        const data = await invoke('governance.design', { action: 'snapshot' });
        if (!current() || owner !== workspaceEpoch)
            return;
        if (data.workspace !== snapshot?.workspace)
            throw Error(t('switched'));
        designSnapshot = data;
        designSelection = data.baseline ? 'baseline' : data.draft ? 'draft' : 'baseline';
    }
    catch (e) {
        if (!current() || owner !== workspaceEpoch)
            return;
        designSnapshot = { error: e.message };
    }
    if (current())
        renderProjectGraph();
}
function selectedDesign() {
    if (designSelection === 'draft')
        return designSnapshot?.draft;
    if (designSelection === 'baseline')
        return designSnapshot?.baseline;
    return designSnapshot?.history?.find((b) => String(b.number) === designSelection) || null;
}
function designGraphView() {
    const selected = selectedDesign();
    const graph = selected?.graph || null;
    text('architecture-title', t('designTitle'));
    text('graph-overview', graph?.title || t('designEmpty'));
    text('graph-source', t('designScope'));
    text('graph-check-state', selected
        ? designSelection === 'draft'
            ? t('designDraftState', selected.baseVersion, selected.reason)
            : t('designBaselineState', selected.number, selected.confirmedAt, selected.reviewer)
        : t('designEmpty'));
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
        options.push(designOption('baseline', t('designCurrent', designSnapshot.baseline.number)));
    if (designSnapshot?.draft)
        options.push(designOption('draft', t('designDraft')));
    for (const b of [...(designSnapshot?.history || [])].reverse().slice(1))
        options.push(designOption(String(b.number), t('designHistory', b.number)));
    select.replaceChildren(...options);
    select.value = designSelection;
    const selected = selectedDesign();
    text('design-document', selected?.documentBody ?? selected?.proposal?.document ?? t('designAwaitingProposal'));
    text('design-ascii', selected?.ascii || t('designAwaitingProposal'));
    designElement('design-ascii-section').hidden = graphView !== 'design' || !selected?.proposal;
    text('design-scope-note', t('designScope'));
    text('design-record', selected
        ? designSelection === 'draft'
            ? t('designDraftState', selected.baseVersion, selected.reason)
            : t('designBaselineState', selected.number, selected.confirmedAt, selected.reviewer)
        : t('designEmpty'));
    const diff = designSelection === 'draft' ? designSnapshot?.diff : null;
    const lines = diff
        ? [
            t('designNodeDiff', diff.addedNodes.join(' / ') || t('none'), diff.removedNodes.join(' / ') || t('none'), diff.changedNodes.join(' / ') || t('none')),
            t('designEdgeDiff', diff.addedEdges.join(' / ') || t('none'), diff.removedEdges.join(' / ') || t('none'), diff.changedEdges.join(' / ') || t('none')),
            t(diff.documentChanged || diff.titleChanged ? 'designTextChanged' : 'designTextUnchanged'),
            t(diff.asciiChanged ? 'designAsciiChanged' : 'designAsciiUnchanged')
        ]
        : [t('designNoDiff')];
    text('design-diff', lines.join('\n'));
    text('design-previous-document', designSnapshot?.baseline?.documentBody ??
        designSnapshot?.baseline?.proposal?.document ??
        t('none'));
    designElement('design-diff-details').hidden = !diff;
    updateDesignControls();
}
function updateDesignControls() {
    designElement('design-version').disabled = busy || (!designSnapshot?.history?.length && !designSnapshot?.draft);
}
designElement('show-design').addEventListener('click', () => {
    graphView = 'design';
    renderProjectGraph();
});
designElement('design-version').addEventListener('change', () => {
    designSelection = designElement('design-version').value;
    renderProjectGraph();
});
