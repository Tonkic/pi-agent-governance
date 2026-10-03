'use strict';
// Authored module relationships, not runtime telemetry or an automatic repository scan.
const graphNodes = {
    ui: { title: '可视化面板', x: 50, y: 100 },
    agent: { title: 'Agent / CLI', x: 50, y: 290 },
    core: { title: '任务治理', x: 365, y: 100 },
    git: { title: 'Git 协作', x: 365, y: 290 },
    state: { title: '任务与验收记录', x: 680, y: 100 },
    worktree: { title: '隔离工作区', x: 680, y: 290 }
};
const graphEdges = [
    { from: 'ui', to: 'core', label: '桥接调用', path: 'M260 148 H365', x: 312, y: 134 },
    { from: 'agent', to: 'core', label: '工具调用', path: 'M260 338 C310 338 310 148 365 148', x: 306, y: 252 },
    { from: 'core', to: 'git', label: 'git_* 委派', path: 'M470 196 V290', x: 511, y: 250 },
    { from: 'core', to: 'state', label: '读写 / 归档', path: 'M575 148 H680', x: 627, y: 134 },
    { from: 'git', to: 'worktree', label: '隔离 / 集成', path: 'M575 338 H680', x: 627, y: 324 }
];
function graphReach(selected, direction, edges = graphEdges) {
    const nodes = new Set([selected]), links = new Set();
    if (direction === 'all')
        return { nodes: new Set(Object.keys(graphNodes)), links: new Set(edges.map((_, i) => i)) };
    const queue = [selected];
    while (queue.length) {
        const id = queue.shift();
        edges.forEach((edge, i) => {
            const from = direction === 'upstream' ? edge.to : edge.from;
            const to = direction === 'upstream' ? edge.from : edge.to;
            if (from !== id)
                return;
            links.add(i);
            if (!nodes.has(to)) {
                nodes.add(to);
                queue.push(to);
            }
        });
    }
    return { nodes, links };
}
function graphFit(width, height) {
    const scale = Math.max(.2, Math.min(1.25, (width - 24) / 940, (height - 24) / 440));
    return { scale, x: (width - 940 * scale) / 2, y: (height - 440 * scale) / 2 };
}
function graphZoom(view, factor, x, y) {
    const scale = Math.max(.2, Math.min(2, view.scale * factor));
    const ratio = scale / view.scale;
    return { scale, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio };
}
