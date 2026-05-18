import { describe, expect, it } from 'vitest';

import { layoutCanvas } from '@/lib/canvas/layout';
import {
  arrowKeyToTreeDirection,
  ORG_DRAWER_WIDTH_PX,
  resolveTreeNavigation,
  type OrgDrawerSlot
} from '@/lib/canvas/drawer';
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

describe('OrgDrawerSlot contract', () => {
  it('exports a stable drawer width matching the D2 spec (space-96 = 384px)', () => {
    expect(ORG_DRAWER_WIDTH_PX).toBe(384);
  });

  it('narrows the discriminated union by kind', () => {
    const slots: OrgDrawerSlot[] = [
      { kind: 'agent-detail', agentId: 'a1' },
      { kind: 'routing-trace', issueId: 'i1' },
      { kind: 'rules-explainer', ruleSetId: 'r1' }
    ];
    const visited = slots.map((s) => {
      switch (s.kind) {
        case 'agent-detail':
          return s.agentId;
        case 'routing-trace':
          return s.issueId;
        case 'rules-explainer':
          return s.ruleSetId;
      }
    });
    expect(visited).toEqual(['a1', 'i1', 'r1']);
  });
});

describe('arrowKeyToTreeDirection', () => {
  it('maps the four arrow keys', () => {
    expect(arrowKeyToTreeDirection('ArrowUp')).toBe('up');
    expect(arrowKeyToTreeDirection('ArrowDown')).toBe('down');
    expect(arrowKeyToTreeDirection('ArrowLeft')).toBe('left');
    expect(arrowKeyToTreeDirection('ArrowRight')).toBe('right');
  });
  it('returns null for unrelated keys', () => {
    expect(arrowKeyToTreeDirection('Enter')).toBeNull();
    expect(arrowKeyToTreeDirection(' ')).toBeNull();
    expect(arrowKeyToTreeDirection('Tab')).toBeNull();
    expect(arrowKeyToTreeDirection('Escape')).toBeNull();
  });
});

describe('resolveTreeNavigation', () => {
  // ceo
  //  ├── cto
  //  │    ├── founding-eng
  //  │    └── ux
  //  └── cfo
  const tree = [
    node('ceo'),
    node('cto', 'ceo'),
    node('cfo', 'ceo'),
    node('founding-eng', 'cto'),
    node('ux', 'cto')
  ];
  const layout = layoutCanvas(tree);

  it('Up from a child goes to its parent', () => {
    const res = resolveTreeNavigation(layout, 'cto', 'up');
    expect(res).toEqual({ agentId: 'ceo', moved: true });
  });

  it('Up from the root stays on the root and reports no movement', () => {
    const res = resolveTreeNavigation(layout, 'ceo', 'up');
    expect(res).toEqual({ agentId: 'ceo', moved: false });
  });

  it('Down from a parent goes to the leftmost child', () => {
    const res = resolveTreeNavigation(layout, 'cto', 'down');
    // founding-eng and ux are children of cto; whichever has the smaller x wins.
    const cto = layout.nodes.find((n) => n.node.org.agentId === 'cto')!;
    const fe = layout.nodes.find((n) => n.node.org.agentId === 'founding-eng')!;
    const ux = layout.nodes.find((n) => n.node.org.agentId === 'ux')!;
    void cto;
    const expected = fe.x <= ux.x ? 'founding-eng' : 'ux';
    expect(res).toEqual({ agentId: expected, moved: true });
  });

  it('Down from a leaf stays put', () => {
    const res = resolveTreeNavigation(layout, 'ux', 'down');
    expect(res).toEqual({ agentId: 'ux', moved: false });
  });

  it('Left/Right move between siblings at the same level by x order', () => {
    // founding-eng and ux are at the same level. Determine left/right.
    const fe = layout.nodes.find((n) => n.node.org.agentId === 'founding-eng')!;
    const ux = layout.nodes.find((n) => n.node.org.agentId === 'ux')!;
    const leftId = fe.x <= ux.x ? 'founding-eng' : 'ux';
    const rightId = leftId === 'founding-eng' ? 'ux' : 'founding-eng';

    const right = resolveTreeNavigation(layout, leftId, 'right');
    expect(right).toEqual({ agentId: rightId, moved: true });

    const left = resolveTreeNavigation(layout, rightId, 'left');
    expect(left).toEqual({ agentId: leftId, moved: true });

    // Left of leftmost stays put.
    const leftEdge = resolveTreeNavigation(layout, leftId, 'left');
    expect(leftEdge).toEqual({ agentId: leftId, moved: false });

    // Right of rightmost stays put.
    const rightEdge = resolveTreeNavigation(layout, rightId, 'right');
    expect(rightEdge).toEqual({ agentId: rightId, moved: false });
  });

  it('Returns no-move when called against an empty layout', () => {
    const empty = layoutCanvas([]);
    const res = resolveTreeNavigation(empty, 'ceo', 'up');
    expect(res.moved).toBe(false);
  });

  it('Falls back to the first node when from-id is unknown', () => {
    const res = resolveTreeNavigation(layout, 'no-such-agent', 'up');
    expect(res.moved).toBe(true);
    expect(layout.nodes.some((n) => n.node.org.agentId === res.agentId)).toBe(true);
  });
});
