'use strict';
// Populated only from the current workspace snapshot, never a plugin fallback.
let graphNodes: Record<string, any> = {};
let graphEdges: any[] = [];
let graphSize = { width: 940, height: 440 };
function setGraphData(data) {
  graphNodes = {}; graphEdges = [];
  const nodes = data?.nodes || [];
  const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(nodes.length))));
  nodes.forEach((node, i) => { graphNodes[node.id] = { ...node, x: 40 + (i % columns) * 310, y: 50 + Math.floor(i / columns) * 180 }; });
  graphSize = { width: Math.max(320, columns * 310), height: Math.max(230, Math.ceil(nodes.length / columns) * 180 + 50) };
  graphEdges = (data?.edges || []).map(edge => {
    const a = graphNodes[edge.from], b = graphNodes[edge.to];
    const x1 = a.x + 105, y1 = a.y + 96, x2 = b.x + 105, y2 = b.y;
    return { ...edge, path: `M${x1} ${y1} C${x1} ${(y1+y2)/2} ${x2} ${(y1+y2)/2} ${x2} ${y2}`, x: (x1+x2)/2, y: (y1+y2)/2 - 8 };
  });
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
