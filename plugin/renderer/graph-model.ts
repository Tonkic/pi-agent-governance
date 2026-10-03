'use strict';
// Populated only from the current workspace snapshot, never a plugin fallback.
let graphNodes: Record<string, any> = {};
let graphEdges: any[] = [];
let graphSize = { width: 940, height: 440 };
function setGraphData(data) {
  graphNodes = {}; graphEdges = [];
  const nodes = data?.nodes || [];
  const ids = nodes.map(node => node.id), edges = data?.edges || [];
  // Collapse strongly connected components before ranking: cycles never recurse forever.
  const adjacency = new Map<string, string[]>(ids.map(id => [id, []]));
  edges.forEach(edge => adjacency.get(edge.from)?.push(edge.to));
  const index = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], active = new Set<string>(), components: string[][] = [];
  function visit(id: string) {
    index.set(id, index.size); low.set(id, index.get(id)); stack.push(id); active.add(id);
    for (const next of adjacency.get(id) || []) {
      if (!index.has(next)) { visit(next); low.set(id, Math.min(low.get(id), low.get(next))); }
      else if (active.has(next)) low.set(id, Math.min(low.get(id), index.get(next)));
    }
    if (low.get(id) === index.get(id)) {
      const component: string[] = []; let next: string;
      do { next = stack.pop(); active.delete(next); component.push(next); } while (next !== id);
      components.push(component);
    }
  }
  ids.forEach(id => { if (!index.has(id)) visit(id); });
  const group = new Map<string, number>();
  components.forEach((members, i) => members.forEach(id => group.set(id, i)));
  const ranks = components.map(() => 0);
  for (let pass = 0; pass < components.length; pass++) {
    for (const edge of edges) {
      const from = group.get(edge.from), to = group.get(edge.to);
      if (from !== to) ranks[to] = Math.max(ranks[to], ranks[from] + 1);
    }
  }
  const layers: string[][] = [];
  ids.forEach(id => { const rank = ranks[group.get(id)]; (layers[rank] ||= []).push(id); });
  // Stable barycentric ordering brings related modules closer without shuffling ties.
  layers.forEach((layer, rank) => {
    if (!rank) return;
    const center = (id: string) => {
      const parents = edges.filter(edge => edge.to === id && ranks[group.get(edge.from)] < rank);
      return parents.length ? parents.reduce((sum, edge) => {
        const row = layers[ranks[group.get(edge.from)]];
        return sum + (row.indexOf(edge.from) + .5) / row.length;
      }, 0) / parents.length : .5;
    };
    layer.sort((a, b) => center(a) - center(b));
  });
  const width = Math.max(310, ...layers.map(layer => layer.length * 300 + 10));
  layers.forEach((layer, rank) => layer.forEach((id, column) => {
    graphNodes[id] = { ...nodes.find(node => node.id === id), layer: rank,
      x: (width - layer.length * 300) / 2 + column * 300 + 45, y: 80 + rank * 210 };
  }));
  let outerLane = 0;
  graphEdges = edges.map((edge, i) => {
    const a = graphNodes[edge.from], b = graphNodes[edge.to];
    const x1 = a.x + 105, y1 = a.y + 96, x2 = b.x + 105, y2 = b.y;
    if (a.layer === b.layer) {
      // Opposite directions use separate sides; self-edges remain visible.
      const top = a.x <= b.x, y = top ? a.y : a.y + 96;
      const lane = y + (top ? -1 : 1) * (30 + (i % 3) * 12);
      const start = x1 - 24, end = x2 + 24;
      return { ...edge, path: `M${start} ${y} C${start} ${lane} ${end} ${lane} ${end} ${y}`, x: (start + end) / 2, y: lane };
    }
    if (b.layer > a.layer + 1) {
      const lane = width + 24 + outerLane++ * 18;
      return { ...edge, path: `M${x1} ${y1} V${y1 + 62} H${lane} V${y2 - 62} H${x2} V${y2}`, x: lane, y: (y1 + y2) / 2 };
    }
    return { ...edge, path: `M${x1} ${y1} C${x1} ${(y1+y2)/2} ${x2} ${(y1+y2)/2} ${x2} ${y2}`, x: (x1+x2)/2, y: (y1+y2)/2 - 8 };
  });
  graphSize = { width: width + (outerLane ? 48 + outerLane * 18 : 0), height: Math.max(260, layers.length * 210 + 40) };
}
type GraphTrace = 'all' | 'upstream' | 'downstream';
function graphReach(selected: string, direction: GraphTrace, edges = graphEdges) {
  const nodes = new Set([selected]), links = new Set<number>();
  if (direction === 'all') return { nodes: new Set(Object.keys(graphNodes)), links: new Set(edges.map((_, i) => i)) };
  const queue = [selected];
  while (queue.length) {
    const id = queue.shift();
    edges.forEach((edge, i) => {
      const from = direction === 'upstream' ? edge.to : edge.from;
      const to = direction === 'upstream' ? edge.from : edge.to;
      if (from !== id) return;
      links.add(i);
      if (!nodes.has(to)) { nodes.add(to); queue.push(to); }
    });
  }
  return { nodes, links };
}
function graphFit(width: number, height: number, bounds = graphSize) {
  const scale = Math.max(.05, Math.min(1.25, (width - 24) / bounds.width, (height - 24) / bounds.height));
  return { scale, x: (width - bounds.width * scale) / 2, y: (height - bounds.height * scale) / 2 };
}
function graphZoom(view: {scale: number, x: number, y: number}, factor: number, x: number, y: number) {
  const scale = Math.max(.05, Math.min(2, view.scale * factor));
  const ratio = scale / view.scale;
  return { scale, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio };
}
