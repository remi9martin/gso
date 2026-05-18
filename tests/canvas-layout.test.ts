import { describe, expect, it } from 'vitest';

import { layoutCanvas } from '@/lib/canvas/layout';
import type { CanvasNode } from '@/lib/canvas/types';

function node(id: string, parent: string | null = null): CanvasNode {
  return {
    org: {
      agentId: id,
      displayName: id,
      roleKey: 'role',
      title: null,
      icon: null,
      urlKey: id,
      reportsToAgentId: parent,
      runtimeStatus: 'running',
      runtimeStatusRaw: 'running',
      pauseReason: null,
      pausedAt: null,
      lastHeartbeatAt: null,
      maxConcurrentRuns: 1,
      heartbeatEnabled: true,
      adapterType: 'claude_local'
    },
    capacity: { slotsTotal: 1, slotsActive: 0, slotsFree: 1, utilizationPct: 0 },
    workload: {
      openCount: 0,
      inProgressCount: 0,
      inReviewCount: 0,
      blockedCount: 0,
      highPriorityOpenCount: 0,
      currentIssueRef: null
    },
    budget: {
      monthBudgetCents: null,
      monthSpentCents: null,
      monthUtilizationPct: null,
      attentionThresholdPct: 0.8,
      pauseThresholdPct: 1
    },
    flags: []
  };
}

describe('layoutCanvas', () => {
  it('places children below their parent and emits one edge per reporting line', () => {
    const nodes = [node('ceo'), node('cto', 'ceo'), node('eng', 'cto')];
    const layout = layoutCanvas(nodes);
    const ceo = layout.nodes.find((n) => n.node.org.agentId === 'ceo')!;
    const cto = layout.nodes.find((n) => n.node.org.agentId === 'cto')!;
    const eng = layout.nodes.find((n) => n.node.org.agentId === 'eng')!;
    expect(ceo.level).toBe(0);
    expect(cto.level).toBe(1);
    expect(eng.level).toBe(2);
    expect(ceo.y).toBeLessThan(cto.y);
    expect(cto.y).toBeLessThan(eng.y);
    expect(layout.edges).toEqual(
      expect.arrayContaining([
        { fromAgentId: 'ceo', toAgentId: 'cto' },
        { fromAgentId: 'cto', toAgentId: 'eng' }
      ])
    );
  });

  it('handles orphans (reportsTo points at someone not in the company)', () => {
    const nodes = [node('orphan', 'no-such-agent')];
    const layout = layoutCanvas(nodes);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.edges).toHaveLength(0);
  });

  it('handles the empty company gracefully', () => {
    const layout = layoutCanvas([]);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});
