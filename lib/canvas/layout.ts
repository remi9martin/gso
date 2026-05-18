import type { CanvasNode } from './types';

export interface CanvasLayoutNode {
  node: CanvasNode;
  level: number;
  x: number;
  y: number;
}

export interface CanvasLayoutEdge {
  fromAgentId: string;
  toAgentId: string;
}

export interface CanvasLayout {
  nodes: CanvasLayoutNode[];
  edges: CanvasLayoutEdge[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  hGap?: number;
  vGap?: number;
  paddingX?: number;
  paddingY?: number;
}

export function layoutCanvas(nodes: CanvasNode[], options: LayoutOptions = {}): CanvasLayout {
  const nodeWidth = options.nodeWidth ?? 240;
  const nodeHeight = options.nodeHeight ?? 168;
  const hGap = options.hGap ?? 32;
  const vGap = options.vGap ?? 88;
  const paddingX = options.paddingX ?? 24;
  const paddingY = options.paddingY ?? 24;

  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: paddingX * 2, height: paddingY * 2 };
  }

  const byAgentId = new Map(nodes.map((n) => [n.org.agentId, n]));
  const childrenOf = new Map<string | null, CanvasNode[]>();
  for (const n of nodes) {
    const parent =
      n.org.reportsToAgentId && byAgentId.has(n.org.reportsToAgentId)
        ? n.org.reportsToAgentId
        : null;
    const bucket = childrenOf.get(parent);
    if (bucket) bucket.push(n);
    else childrenOf.set(parent, [n]);
  }

  const seen = new Set<string>();
  const depthBuckets = new Map<number, CanvasNode[]>();

  function indexByDepth(items: CanvasNode[], depth: number) {
    for (const item of items) {
      if (seen.has(item.org.agentId)) continue;
      seen.add(item.org.agentId);
      const bucket = depthBuckets.get(depth);
      if (bucket) bucket.push(item);
      else depthBuckets.set(depth, [item]);
      indexByDepth(childrenOf.get(item.org.agentId) ?? [], depth + 1);
    }
  }
  indexByDepth(childrenOf.get(null) ?? [], 0);

  const orphans = nodes.filter((n) => !seen.has(n.org.agentId));
  if (orphans.length) {
    const depth = depthBuckets.size;
    depthBuckets.set(depth, orphans);
  }

  const sortedDepths = [...depthBuckets.keys()].sort((a, b) => a - b);

  let maxRowWidth = 0;
  for (const depth of sortedDepths) {
    const row = depthBuckets.get(depth)!;
    const rowWidth = row.length * nodeWidth + (row.length - 1) * hGap;
    if (rowWidth > maxRowWidth) maxRowWidth = rowWidth;
  }
  const width = maxRowWidth + paddingX * 2;

  const placed: CanvasLayoutNode[] = [];
  for (const depth of sortedDepths) {
    const row = depthBuckets.get(depth)!;
    const rowWidth = row.length * nodeWidth + (row.length - 1) * hGap;
    const rowStart = paddingX + (maxRowWidth - rowWidth) / 2;
    const y = paddingY + depth * (nodeHeight + vGap);
    row.forEach((n, i) => {
      placed.push({
        node: n,
        level: depth,
        x: rowStart + i * (nodeWidth + hGap),
        y
      });
    });
  }

  const edges: CanvasLayoutEdge[] = [];
  for (const n of nodes) {
    if (n.org.reportsToAgentId && byAgentId.has(n.org.reportsToAgentId)) {
      edges.push({
        fromAgentId: n.org.reportsToAgentId,
        toAgentId: n.org.agentId
      });
    }
  }

  const height =
    paddingY * 2 + sortedDepths.length * nodeHeight + Math.max(sortedDepths.length - 1, 0) * vGap;

  return { nodes: placed, edges, width, height };
}
