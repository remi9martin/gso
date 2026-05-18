import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { OrgCanvasDrawer } from '@/app/canvas/canvas-drawer';
import type { OrgDrawerSlot } from '@/lib/canvas/drawer';
import type { CanvasNode } from '@/lib/canvas/types';

function node(id: string): CanvasNode {
  return {
    org: {
      agentId: id,
      displayName: id,
      roleKey: 'role',
      title: null,
      icon: null,
      urlKey: id,
      reportsToAgentId: null,
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
      monthBudgetCents: 100_000,
      monthSpentCents: 10_000,
      monthUtilizationPct: 0.1,
      attentionThresholdPct: 0.8,
      pauseThresholdPct: 1
    },
    flags: []
  };
}

describe('OrgCanvasDrawer renders every slot kind without crashing', () => {
  const nodesByAgentId = new Map<string, CanvasNode>([['agent-1', node('agent-1')]]);

  const cases: Array<{ name: string; slot: OrgDrawerSlot; expect: string }> = [
    {
      name: 'agent-detail',
      slot: { kind: 'agent-detail', agentId: 'agent-1' },
      expect: 'Agent detail'
    },
    {
      name: 'routing-trace',
      slot: { kind: 'routing-trace', issueId: 'issue-42' },
      expect: 'Coming in'
    },
    {
      name: 'rules-explainer',
      slot: { kind: 'rules-explainer', ruleSetId: 'rules-v0' },
      expect: 'Coming in'
    }
  ];

  for (const c of cases) {
    it(`renders ${c.name}`, () => {
      const html = renderToStaticMarkup(
        <OrgCanvasDrawer slot={c.slot} nodesByAgentId={nodesByAgentId} onClose={() => {}} />
      );
      expect(html).toContain(c.expect);
      expect(html).toContain(`data-slot-kind="${c.slot.kind}"`);
    });
  }

  it('renders null when slot is null', () => {
    const html = renderToStaticMarkup(
      <OrgCanvasDrawer slot={null} nodesByAgentId={nodesByAgentId} onClose={() => {}} />
    );
    expect(html).toBe('');
  });

  it('agent-detail renders currentIssueRef as a /GSO/issues/{identifier} link and omits the Routing rationale parent heading', () => {
    const linkedNode = node('agent-2');
    linkedNode.workload.currentIssueRef = {
      id: 'iss-1',
      identifier: 'GSO-99',
      title: 'Sample task'
    };
    const html = renderToStaticMarkup(
      <OrgCanvasDrawer
        slot={{ kind: 'agent-detail', agentId: 'agent-2' }}
        nodesByAgentId={new Map([['agent-2', linkedNode]])}
        onClose={() => {}}
      />
    );
    expect(html).toContain('href="/GSO/issues/GSO-99"');
    expect(html).toContain('<code>GSO-99</code>');
    expect(html).not.toMatch(/<h\d[^>]*>Routing rationale<\/h\d>/);
  });

  it('agent-detail with unknown agentId renders an empty-state message rather than crashing', () => {
    const html = renderToStaticMarkup(
      <OrgCanvasDrawer
        slot={{ kind: 'agent-detail', agentId: 'missing' }}
        nodesByAgentId={new Map()}
        onClose={() => {}}
      />
    );
    expect(html).toContain('no longer on the canvas');
  });
});
