import type { CanvasBundle, CanvasNode } from './types';

export type FilterKey = 'all' | 'overloaded' | 'paused' | 'budget_attention';
export type DepthKey = '1' | '2' | '3' | 'all';
export type CardTone = 'neutral' | 'paused' | 'error';

export const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'overloaded', label: 'Overloaded' },
  { key: 'paused', label: 'Paused' },
  { key: 'budget_attention', label: 'Budget ≥80%' }
];

export const DEPTH_OPTIONS: DepthKey[] = ['1', '2', '3', 'all'];

export function nodeMatchesFilter(node: CanvasNode, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'overloaded') return node.flags.some((f) => f.key === 'overloaded');
  if (filter === 'paused') {
    return (
      node.org.runtimeStatus === 'paused' ||
      !!node.org.pausedAt ||
      node.flags.some((f) => f.key === 'paused_budget' || f.key === 'paused_manual')
    );
  }
  if (filter === 'budget_attention') {
    const pct = node.budget.monthUtilizationPct;
    return pct !== null && pct >= node.budget.attentionThresholdPct;
  }
  return true;
}

export function pruneByDepth(nodes: CanvasNode[], depth: DepthKey): CanvasNode[] {
  if (depth === 'all') return nodes;
  const maxDepth = Number(depth);
  const byId = new Map(nodes.map((n) => [n.org.agentId, n]));
  const depthOf = new Map<string, number>();
  function compute(id: string, visiting = new Set<string>()): number {
    const cached = depthOf.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 1; // cycle guard — treat as root
    visiting.add(id);
    const node = byId.get(id);
    if (!node) return 1;
    const parentId = node.org.reportsToAgentId;
    if (!parentId || !byId.has(parentId)) {
      depthOf.set(id, 1);
      return 1;
    }
    const d = compute(parentId, visiting) + 1;
    depthOf.set(id, d);
    return d;
  }
  return nodes.filter((n) => compute(n.org.agentId) <= maxDepth);
}

export interface CanvasSummary {
  totalAgents: number;
  runningAgents: number;
  pausedAgents: number;
  overloadedAgents: number;
  budgetAttentionAgents: number;
  openIssues: number;
}

export function buildSummary(bundle: CanvasBundle): CanvasSummary {
  let running = 0;
  let paused = 0;
  let overloaded = 0;
  let attention = 0;
  let openIssues = 0;
  for (const n of bundle.nodes) {
    if (n.org.runtimeStatus === 'running') running += 1;
    if (n.org.runtimeStatus === 'paused' || n.org.pausedAt) paused += 1;
    if (n.flags.some((f) => f.key === 'overloaded')) overloaded += 1;
    const pct = n.budget.monthUtilizationPct;
    if (pct !== null && pct >= n.budget.attentionThresholdPct) attention += 1;
    openIssues += n.workload.openCount;
  }
  return {
    totalAgents: bundle.nodes.length,
    runningAgents: running,
    pausedAgents: paused,
    overloadedAgents: overloaded,
    budgetAttentionAgents: attention,
    openIssues
  };
}

// Card background tint is reserved for exception states (paused / error).
// `running` / `idle` / `unknown` share the neutral tone so the wedge
// signal (`overloaded`, surfaced via card border) is not drowned out.
export function pickCardTone(node: CanvasNode): CardTone {
  if (node.org.runtimeStatus === 'error') return 'error';
  if (node.org.runtimeStatus === 'paused' || node.org.pausedAt) return 'paused';
  return 'neutral';
}

export function isOverloaded(node: CanvasNode): boolean {
  return node.flags.some((f) => f.key === 'overloaded');
}
