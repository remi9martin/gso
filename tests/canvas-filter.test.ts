import { describe, expect, it } from 'vitest';

import {
  buildSummary,
  isOverloaded,
  nodeMatchesFilter,
  pickCardTone,
  pruneByDepth
} from '@/lib/canvas/filter';
import type {
  AgentStatusFlag,
  AgentStatusFlagKey,
  CanvasBundle,
  CanvasNode,
  OrgNodeRuntimeStatus
} from '@/lib/canvas/types';

function flag(key: AgentStatusFlagKey): AgentStatusFlag {
  return { key, label: key, severity: 'warn' };
}

interface NodeFactoryOverrides {
  agentId?: string;
  reportsToAgentId?: string | null;
  runtimeStatus?: OrgNodeRuntimeStatus;
  pausedAt?: string | null;
  flagKeys?: AgentStatusFlagKey[];
  utilization?: number | null;
  attentionThreshold?: number;
  openCount?: number;
}

function node(overrides: NodeFactoryOverrides = {}): CanvasNode {
  return {
    org: {
      agentId: overrides.agentId ?? 'a-1',
      displayName: 'Demo',
      roleKey: 'engineer',
      title: null,
      icon: null,
      urlKey: 'demo',
      reportsToAgentId: overrides.reportsToAgentId ?? null,
      runtimeStatus: overrides.runtimeStatus ?? 'running',
      runtimeStatusRaw: overrides.runtimeStatus ?? 'running',
      pauseReason: null,
      pausedAt: overrides.pausedAt ?? null,
      lastHeartbeatAt: null,
      maxConcurrentRuns: 1,
      heartbeatEnabled: true,
      adapterType: 'claude_local'
    },
    capacity: { slotsTotal: 1, slotsActive: 0, slotsFree: 1, utilizationPct: 0 },
    workload: {
      openCount: overrides.openCount ?? 0,
      inProgressCount: 0,
      inReviewCount: 0,
      blockedCount: 0,
      highPriorityOpenCount: 0,
      currentIssueRef: null
    },
    budget: {
      monthBudgetCents: 10000,
      monthSpentCents: 0,
      monthUtilizationPct: overrides.utilization ?? 0,
      attentionThresholdPct: overrides.attentionThreshold ?? 0.8,
      pauseThresholdPct: 1
    },
    flags: (overrides.flagKeys ?? []).map(flag)
  };
}

describe('pickCardTone', () => {
  it('returns neutral for running / idle / unknown — wedge differentiator is overloaded, not status', () => {
    expect(pickCardTone(node({ runtimeStatus: 'running' }))).toBe('neutral');
    expect(pickCardTone(node({ runtimeStatus: 'idle' }))).toBe('neutral');
    expect(pickCardTone(node({ runtimeStatus: 'unknown' }))).toBe('neutral');
  });

  it('returns paused when status is paused or pausedAt is set', () => {
    expect(pickCardTone(node({ runtimeStatus: 'paused' }))).toBe('paused');
    expect(pickCardTone(node({ runtimeStatus: 'idle', pausedAt: '2026-01-01' }))).toBe('paused');
  });

  it('returns error for runtime error', () => {
    expect(pickCardTone(node({ runtimeStatus: 'error' }))).toBe('error');
  });

  it('an overloaded running agent still gets a neutral tone — overload is signalled by border, not tint', () => {
    const n = node({ runtimeStatus: 'running', flagKeys: ['overloaded'] });
    expect(pickCardTone(n)).toBe('neutral');
    expect(isOverloaded(n)).toBe(true);
  });
});

describe('nodeMatchesFilter', () => {
  const overloaded = node({ flagKeys: ['overloaded'] });
  const paused = node({ runtimeStatus: 'paused' });
  const burning = node({ utilization: 0.85 });
  const calm = node({ utilization: 0.2 });

  it('"all" passes every node', () => {
    expect(nodeMatchesFilter(overloaded, 'all')).toBe(true);
    expect(nodeMatchesFilter(calm, 'all')).toBe(true);
  });

  it('"overloaded" matches only nodes flagged overloaded', () => {
    expect(nodeMatchesFilter(overloaded, 'overloaded')).toBe(true);
    expect(nodeMatchesFilter(calm, 'overloaded')).toBe(false);
  });

  it('"paused" matches runtime paused or paused_* flags', () => {
    expect(nodeMatchesFilter(paused, 'paused')).toBe(true);
    expect(nodeMatchesFilter(node({ flagKeys: ['paused_budget'] }), 'paused')).toBe(true);
    expect(nodeMatchesFilter(calm, 'paused')).toBe(false);
  });

  it('"budget_attention" matches nodes at or above the attention threshold', () => {
    expect(nodeMatchesFilter(burning, 'budget_attention')).toBe(true);
    expect(nodeMatchesFilter(calm, 'budget_attention')).toBe(false);
    expect(nodeMatchesFilter(node({ utilization: null }), 'budget_attention')).toBe(false);
  });
});

describe('pruneByDepth', () => {
  const ceo = node({ agentId: 'ceo', reportsToAgentId: null });
  const cto = node({ agentId: 'cto', reportsToAgentId: 'ceo' });
  const eng = node({ agentId: 'eng', reportsToAgentId: 'cto' });
  const intern = node({ agentId: 'intern', reportsToAgentId: 'eng' });
  const all = [ceo, cto, eng, intern];

  it('"all" returns every node', () => {
    expect(pruneByDepth(all, 'all').map((n) => n.org.agentId)).toEqual([
      'ceo',
      'cto',
      'eng',
      'intern'
    ]);
  });

  it('"1" returns only roots', () => {
    expect(pruneByDepth(all, '1').map((n) => n.org.agentId)).toEqual(['ceo']);
  });

  it('"2" returns roots + direct reports', () => {
    expect(pruneByDepth(all, '2').map((n) => n.org.agentId)).toEqual(['ceo', 'cto']);
  });

  it('"3" returns three levels deep', () => {
    expect(pruneByDepth(all, '3').map((n) => n.org.agentId)).toEqual(['ceo', 'cto', 'eng']);
  });

  it('treats orphans (parent missing) as roots', () => {
    const orphan = node({ agentId: 'orphan', reportsToAgentId: 'ghost' });
    expect(pruneByDepth([orphan], '1').map((n) => n.org.agentId)).toEqual(['orphan']);
  });
});

describe('buildSummary', () => {
  it('counts running/paused/overloaded/budget-attention and sums open issues', () => {
    const bundle: CanvasBundle = {
      companyId: 'c1',
      generatedAt: '2026-05-17T21:40:00.000Z',
      nodes: [
        node({ agentId: 'a', runtimeStatus: 'running', openCount: 2 }),
        node({
          agentId: 'b',
          runtimeStatus: 'running',
          flagKeys: ['overloaded'],
          openCount: 5,
          utilization: 0.9
        }),
        node({ agentId: 'c', runtimeStatus: 'paused', openCount: 1 }),
        node({ agentId: 'd', runtimeStatus: 'idle', openCount: 0 })
      ]
    };
    const s = buildSummary(bundle);
    expect(s.totalAgents).toBe(4);
    expect(s.runningAgents).toBe(2);
    expect(s.pausedAgents).toBe(1);
    expect(s.overloadedAgents).toBe(1);
    expect(s.budgetAttentionAgents).toBe(1);
    expect(s.openIssues).toBe(8);
  });
});
