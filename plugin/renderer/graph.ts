'use strict';
(() => {
  const get = (id: string) => document.getElementById(id);
  const viewport = get('graph-viewport'),
    stage = get('graph-stage');
  let nodes: HTMLButtonElement[] = [];
  const svg = get('graph-edges');
  const ns = 'http://www.w3.org/2000/svg';
  let selected = '',
    mode: GraphTrace = 'all';
  let view = graphFit(viewport.clientWidth, viewport.clientHeight);
  let dragging: { id: number; x: number; y: number } = null;
  let edgeElements: SVGGElement[] = [];
  function paintView() {
    // Keep at least part of the graph reachable, even after a long drag.
    view.x = Math.max(
      40 - graphSize.width * view.scale,
      Math.min(viewport.clientWidth - 40, view.x)
    );
    view.y = Math.max(
      40 - graphSize.height * view.scale,
      Math.min(viewport.clientHeight - 40, view.y)
    );
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    get('graph-scale').textContent = `${Math.round(view.scale * 100)}%`;
  }
  function fit() {
    view = graphFit(viewport.clientWidth, viewport.clientHeight);
    paintView();
  }
  function zoom(factor: number, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
    view = graphZoom(view, factor, x, y);
    paintView();
  }
  function paintTrace() {
    const reach = graphReach(selected, mode);
    nodes.forEach((node) => {
      node.classList.toggle('graph-dimmed', !reach.nodes.has(node.dataset.module));
      node.setAttribute('aria-pressed', String(node.dataset.module === selected));
    });
    edgeElements.forEach((edge, i) => {
      edge.classList.toggle('graph-dimmed', !reach.links.has(i));
      const direct = graphEdges[i].from === selected || graphEdges[i].to === selected;
      edge.classList.toggle('graph-highlight', reach.links.has(i) && (mode !== 'all' || direct));
    });
    document
      .querySelectorAll<HTMLButtonElement>('[data-trace]')
      .forEach((button) =>
        button.setAttribute('aria-pressed', String(button.dataset.trace === mode))
      );
    const direction = mode === 'upstream' ? t('upstream') : t('downstream');
    get('graph-summary').textContent =
      mode === 'all'
        ? t('allRelations', graphEdges.length)
        : t(
            'traceSummary',
            graphNodes[selected]?.title || t('unselected'),
            direction,
            Math.max(0, reach.nodes.size - 1),
            reach.links.size
          );
    const detail = graphNodes[selected];
    get('module-title').textContent = detail?.title || t('unselected');
    get('module-path').textContent = (detail?.files || []).join(' · ');
    get('module-description').textContent = detail?.description || t('generated');
    get('module-connection').textContent = detail?.current ? t('currentPhase') : '';
    const relations = graphEdges
      .filter((edge) => edge.from === selected || edge.to === selected)
      .map((edge) => {
        const li = document.createElement('li'),
          button = document.createElement('button');
        const target = edge.from === selected ? edge.to : edge.from;
        button.type = 'button';
        button.textContent = `${edge.from === selected ? '→' : '←'} ${graphNodes[target].title} · ${edge.label}`;
        button.addEventListener('click', () =>
          nodes.find((node) => node.dataset.module === target)?.click()
        );
        li.append(button);
        return li;
      });
    get('module-relations').replaceChildren(...relations);
  }
  function rebuild(data) {
    setGraphData(data);
    selected = data?.nodes?.find((node) => node.current)?.id || data?.nodes?.[0]?.id || '';
    nodes.forEach((node) => node.remove());
    edgeElements.forEach((edge) => edge.remove());
    stage.style.width = `${graphSize.width}px`;
    stage.style.height = `${graphSize.height}px`;
    svg.setAttribute('viewBox', `0 0 ${graphSize.width} ${graphSize.height}`);
    svg.style.width = `${graphSize.width}px`;
    svg.style.height = `${graphSize.height}px`;
    edgeElements = graphEdges.map((edge) => {
      const group = document.createElementNS(ns, 'g');
      group.classList.add('graph-edge');
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', edge.path);
      path.setAttribute('marker-end', 'url(#edge-arrow)');
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', String(edge.x));
      label.setAttribute('y', String(edge.y));
      label.textContent = edge.label;
      group.append(path, label);
      svg.append(group);
      return group;
    });
    nodes = Object.entries(graphNodes).map(([id, data]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'architecture-node';
      button.dataset.module = id;
      button.title = data.description || data.title;
      for (const [tag, value] of [
        [
          'span',
          data.current
            ? t('phase')
            : t('module', String(Object.keys(graphNodes).indexOf(id) + 1).padStart(2, '0'))
        ],
        ['strong', data.title],
        ['small', data.description || t('viewRelations')]
      ]) {
        const el = document.createElement(tag);
        el.textContent = value;
        button.append(el);
      }
      stage.append(button);
      return button;
    });
    nodes.forEach((node) => {
      const data = graphNodes[node.dataset.module];
      node.style.left = `${data.x}px`;
      node.style.top = `${data.y}px`;
      node.addEventListener('click', () => {
        selected = node.dataset.module;
        paintTrace();
      });
      node.addEventListener('focus', () => {
        const rect = node.getBoundingClientRect(),
          bounds = viewport.getBoundingClientRect();
        if (
          rect.left < bounds.left ||
          rect.right > bounds.right ||
          rect.top < bounds.top ||
          rect.bottom > bounds.bottom
        ) {
          view.x = viewport.clientWidth / 2 - (data.x + 105) * view.scale;
          view.y = viewport.clientHeight / 2 - (data.y + 48) * view.scale;
          paintView();
        }
      });
    });
    paintTrace();
    fit();
  }
  window.addEventListener('project-graph', (event: CustomEvent) => rebuild(event.detail));
  document.querySelectorAll<HTMLButtonElement>('[data-trace]').forEach((button) =>
    button.addEventListener('click', () => {
      mode = button.dataset.trace as GraphTrace;
      paintTrace();
    })
  );
  get('graph-in').addEventListener('click', () => zoom(1.2));
  get('graph-out').addEventListener('click', () => zoom(1 / 1.2));
  get('graph-fit').addEventListener('click', fit);
  viewport.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      zoom(
        Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.005),
        event.clientX - bounds.left,
        event.clientY - bounds.top
      );
    },
    { passive: false }
  );
  viewport.addEventListener('pointerdown', (event) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      dragging ||
      (event.target as Element).closest('button')
    )
      return;
    dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
    viewport.focus({ preventScroll: true });
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!dragging || dragging.id !== event.pointerId) return;
    view.x += event.clientX - dragging.x;
    view.y += event.clientY - dragging.y;
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    paintView();
  });
  function endDrag(event: PointerEvent) {
    if (dragging?.id !== event.pointerId) return;
    dragging = null;
    viewport.classList.remove('is-panning');
    if (viewport.hasPointerCapture(event.pointerId))
      viewport.releasePointerCapture(event.pointerId);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    viewport.addEventListener(type, endDrag);
  viewport.addEventListener('keydown', (event) => {
    if (event.target !== viewport) return;
    if (event.key === '+' || event.key === '=') zoom(1.2);
    else if (event.key === '-') zoom(1 / 1.2);
    else if (event.key === '0') fit();
    else if (event.key.startsWith('Arrow')) {
      if (event.key === 'ArrowLeft') view.x -= 35;
      if (event.key === 'ArrowRight') view.x += 35;
      if (event.key === 'ArrowUp') view.y -= 35;
      if (event.key === 'ArrowDown') view.y += 35;
      paintView();
    } else return;
    event.preventDefault();
  });
  new ResizeObserver(fit).observe(viewport);
  localeReady.then(() => rebuild(null));
})();
