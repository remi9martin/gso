import { describe, expect, it } from 'vitest';

import {
  applyOptimisticReassign,
  toReassignResult,
  type ReassignApiResponse
} from '@/lib/canvas/drag-reassign';
import type { CanvasBundle, CanvasNode } from '@/lib/canvas/types';

function makeNode(
  agentId: string,
  overrides: Partial<CanvasNode['workload']> = {}
): CanvasNode {
  return {
    org: {
      agentId,
      displayName: `Agent ${agentId}`,
      roleKey: 'coder',
      title: null,
      icon: null,
      urlKey: agentId,
      reportsToAgentId: null,
      runtimeStatus: 'idle',
      runtimeStatusRaw: 'idle',
      pauseReason: null,
      pausedAt: null,
      lastHeartbeatAt: null,
      maxConcurrentRuns: 1,
      heartbeatEnabled: true,
      adapterType: 'local'
    },
    capacity: { slotsTotal: 1, slotsActive: 0, slotsFree: 1, utilizationPct: 0 },
    workload: {
      openCount: 5,
      inProgressCount: 2,
      inReviewCount: 1,
      blockedCount: 1,
      highPriorityOpenCount: 2,
      currentIssueRef: { id: 'i1', identifier: 'GSO-1', title: 'Issue 1' },
      ...overrides
    },
    budget: {
      monthBudgetCents: 10000,
      monthSpentCents: 2000,
      monthUtilizationPct: 0.2,
      attentionThresholdPct: 0.8,
      pauseThresholdPct: 1.0
    },
    flags: []
  };
}

function makeBundle(nodes: CanvasNode[]): CanvasBundle {
  return { companyId: 'co1', generatedAt: new Date().toISOString(), nodes };
}

describe('applyOptimisticReassign', () => {
  it('zeroes out source workload and adds to target', () => {
    const source = makeNode('a', {
      openCount: 5,
      inProgressCount: 2,
      inReviewCount: 1,
      blockedCount: 1,
      highPriorityOpenCount: 2
    });
    const target = makeNode('b', {
      openCount: 3,
      inProgressCount: 1,
      inReviewCount: 0,
      blockedCount: 0,
      highPriorityOpenCount: 1
    });
    const bundle = makeBundle([source, target]);

    const result = applyOptimisticReassign(bundle, 'a', 'b');

    const newSource = result.nodes.find((n) => n.org.agentId === 'a')!;
    const newTarget = result.nodes.find((n) => n.org.agentId === 'b')!;

    expect(newSource.workload.openCount).toBe(0);
    expect(newSource.workload.inProgressCount).toBe(0);
    expect(newSource.workload.inReviewCount).toBe(0);
    expect(newSource.workload.blockedCount).toBe(0);
    expect(newSource.workload.highPriorityOpenCount).toBe(0);
    expect(newSource.workload.currentIssueRef).toBeNull();

    expect(newTarget.workload.openCount).toBe(8);
    expect(newTarget.workload.inProgressCount).toBe(3);
    expect(newTarget.workload.inReviewCount).toBe(1);
    expect(newTarget.workload.blockedCount).toBe(1);
    expect(newTarget.workload.highPriorityOpenCount).toBe(3);
  });

  it('preserves unchanged nodes', () => {
    const a = makeNode('a');
    const b = makeNode('b');
    const c = makeNode('c', { openCount: 7 });
    const bundle = makeBundle([a, b, c]);

    const result = applyOptimisticReassign(bundle, 'a', 'b');

    const unchanged = result.nodes.find((n) => n.org.agentId === 'c')!;
    expect(unchanged.workload.openCount).toBe(7);
  });

  it('returns original bundle if source not found', () => {
    const bundle = makeBundle([makeNode('a'), makeNode('b')]);
    const result = applyOptimisticReassign(bundle, 'missing', 'b');
    expect(result).toBe(bundle);
  });

  it('returns original bundle if target not found', () => {
    const bundle = makeBundle([makeNode('a'), makeNode('b')]);
    const result = applyOptimisticReassign(bundle, 'a', 'missing');
    expect(result).toBe(bundle);
  });

  it('does not mutate the original bundle', () => {
    const a = makeNode('a', { openCount: 4 });
    const b = makeNode('b', { openCount: 2 });
    const bundle = makeBundle([a, b]);

    applyOptimisticReassign(bundle, 'a', 'b');

    expect(bundle.nodes[0].workload.openCount).toBe(4);
    expect(bundle.nodes[1].workload.openCount).toBe(2);
  });

  it('prefers target currentIssueRef over source when target has one', () => {
    const source = makeNode('a');
    const target = makeNode('b');
    source.workload.currentIssueRef = { id: 'src-issue', identifier: 'G-10', title: 'Source' };
    target.workload.currentIssueRef = { id: 'tgt-issue', identifier: 'G-20', title: 'Target' };
    const bundle = makeBundle([source, target]);

    const result = applyOptimisticReassign(bundle, 'a', 'b');

    const newTarget = result.nodes.find((n) => n.org.agentId === 'b')!;
    expect(newTarget.workload.currentIssueRef?.id).toBe('tgt-issue');
  });

  it('uses source currentIssueRef when target has none', () => {
    const source = makeNode('a');
    const target = makeNode('b');
    source.workload.currentIssueRef = { id: 'src-issue', identifier: 'G-10', title: 'Source' };
    target.workload.currentIssueRef = null;
    const bundle = makeBundle([source, target]);

    const result = applyOptimisticReassign(bundle, 'a', 'b');

    const newTarget = result.nodes.find((n) => n.org.agentId === 'b')!;
    expect(newTarget.workload.currentIssueRef?.id).toBe('src-issue');
  });
});

describe('toReassignResult', () => {
  it('extracts issue ids from response', () => {
    const response: ReassignApiResponse = {
      reassigned: [
        { id: 'i1', identifier: 'G-1', title: 'Issue 1' },
        { id: 'i2', identifier: 'G-2', title: 'Issue 2' }
      ],
      errors: []
    };
    const result = toReassignResult(response, 'src', 'tgt');
    expect(result.issueIds).toEqual(['i1', 'i2']);
    expect(result.sourceAgentId).toBe('src');
    expect(result.targetAgentId).toBe('tgt');
  });

  it('handles empty reassigned list', () => {
    const response: ReassignApiResponse = { reassigned: [], errors: [] };
    const result = toReassignResult(response, 'src', 'tgt');
    expect(result.issueIds).toHaveLength(0);
  });
});
