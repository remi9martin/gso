import { describe, expect, it } from 'vitest';

import {
  buildBudgetBurn,
  buildCanvasBundle,
  buildCapacity,
  buildOrgNode,
  buildStatusFlags,
  buildWorkload
} from '@/lib/canvas/projection';
import type { PaperclipAgent, PaperclipIssue } from '@/lib/paperclip/types';

const T0 = Date.parse('2026-05-18T12:00:00.000Z');

function agent(overrides: Partial<PaperclipAgent> = {}): PaperclipAgent {
  return {
    id: 'agent-1',
    companyId: 'company-1',
    name: 'Founding Engineer',
    role: 'engineer',
    title: null,
    icon: null,
    status: 'running',
    reportsTo: 'agent-cto',
    capabilities: null,
    adapterType: 'claude_local',
    runtimeConfig: { heartbeat: { enabled: true, maxConcurrentRuns: 2 } },
    budgetMonthlyCents: 8000,
    spentMonthlyCents: 1600,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: new Date(T0 - 60_000).toISOString(),
    urlKey: 'foundingengineer',
    ...overrides
  };
}

function issue(overrides: Partial<PaperclipIssue> = {}): PaperclipIssue {
  return {
    id: 'issue-1',
    identifier: 'GSO-100',
    title: 'Sample issue',
    status: 'in_progress',
    priority: 'medium',
    assigneeAgentId: 'agent-1',
    executionRunId: null,
    activeRun: null,
    updatedAt: new Date(T0).toISOString(),
    lastActivityAt: new Date(T0).toISOString(),
    ...overrides
  };
}

describe('buildOrgNode', () => {
  it('mirrors agent fields and clamps running with stale heartbeat to idle', () => {
    const a = agent({ lastHeartbeatAt: new Date(T0 - 45 * 60 * 1000).toISOString() });
    const node = buildOrgNode(a, T0);
    expect(node.runtimeStatus).toBe('idle');
    expect(node.runtimeStatusRaw).toBe('running');
    expect(node.maxConcurrentRuns).toBe(2);
    expect(node.heartbeatEnabled).toBe(true);
  });

  it('falls back to unknown for novel status values', () => {
    const node = buildOrgNode(agent({ status: 'degraded' }), T0);
    expect(node.runtimeStatus).toBe('unknown');
    expect(node.runtimeStatusRaw).toBe('degraded');
  });

  it('defaults maxConcurrentRuns to 1 when runtimeConfig is missing', () => {
    const node = buildOrgNode(agent({ runtimeConfig: null }), T0);
    expect(node.maxConcurrentRuns).toBe(1);
    expect(node.heartbeatEnabled).toBe(false);
  });
});

describe('buildCapacity', () => {
  it('counts running active runs against slots', () => {
    const node = buildOrgNode(agent(), T0);
    const issues = [
      issue({
        executionRunId: 'r1',
        activeRun: {
          id: 'r1',
          status: 'running',
          agentId: 'agent-1',
          startedAt: null,
          finishedAt: null
        }
      }),
      issue({ status: 'blocked' }),
      issue({ status: 'todo' })
    ];
    const cap = buildCapacity(node, issues);
    expect(cap.slotsTotal).toBe(2);
    expect(cap.slotsActive).toBe(1);
    expect(cap.slotsFree).toBe(1);
    expect(cap.utilizationPct).toBe(0.5);
  });

  it('treats zero slots as zero utilization (no NaN)', () => {
    const node = buildOrgNode(
      agent({ runtimeConfig: { heartbeat: { maxConcurrentRuns: 0 } } }),
      T0
    );
    const cap = buildCapacity(node, []);
    expect(cap.utilizationPct).toBe(0);
    expect(cap.slotsFree).toBe(0);
  });
});

describe('buildWorkload', () => {
  it('counts statuses, picks the executing issue as current', () => {
    const issues = [
      issue({ status: 'in_progress', executionRunId: 'r1' }),
      issue({ id: 'i2', identifier: 'GSO-101', status: 'in_review' }),
      issue({ id: 'i3', identifier: 'GSO-102', status: 'blocked', priority: 'critical' }),
      issue({ id: 'i4', identifier: 'GSO-103', status: 'todo', priority: 'high' })
    ];
    const w = buildWorkload(issues);
    expect(w.openCount).toBe(4);
    expect(w.inProgressCount).toBe(1);
    expect(w.inReviewCount).toBe(1);
    expect(w.blockedCount).toBe(1);
    expect(w.highPriorityOpenCount).toBe(2);
    expect(w.currentIssueRef?.identifier).toBe('GSO-100');
  });

  it('returns no currentIssueRef when nothing is executing', () => {
    const w = buildWorkload([issue({ status: 'todo' })]);
    expect(w.currentIssueRef).toBeNull();
  });
});

describe('buildBudgetBurn', () => {
  it('produces ratio and surfaces thresholds', () => {
    const b = buildBudgetBurn(agent({ budgetMonthlyCents: 8000, spentMonthlyCents: 7200 }), 0.8);
    expect(b.monthBudgetCents).toBe(8000);
    expect(b.monthSpentCents).toBe(7200);
    expect(b.monthUtilizationPct).toBeCloseTo(0.9);
    expect(b.attentionThresholdPct).toBe(0.8);
    expect(b.pauseThresholdPct).toBe(1);
  });

  it('returns null utilization when budget is missing or zero', () => {
    expect(buildBudgetBurn(agent({ budgetMonthlyCents: 0 }), 0.8).monthUtilizationPct).toBeNull();
    expect(
      buildBudgetBurn(agent({ budgetMonthlyCents: null }), 0.8).monthUtilizationPct
    ).toBeNull();
  });
});

describe('buildStatusFlags', () => {
  it('marks paused with budget reason as paused_budget', () => {
    const node = buildOrgNode(
      agent({
        status: 'paused',
        pausedAt: new Date(T0).toISOString(),
        pauseReason: 'Auto-paused: monthly budget reached'
      }),
      T0
    );
    const cap = buildCapacity(node, []);
    const wl = buildWorkload([]);
    const burn = buildBudgetBurn(agent({ budgetMonthlyCents: 8000, spentMonthlyCents: 8000 }), 0.8);
    const flags = buildStatusFlags(node, cap, wl, burn);
    expect(flags.map((f) => f.key)).toContain('paused_budget');
  });

  it('flags overloaded when over capacity AND open > slots', () => {
    const node = buildOrgNode(
      agent({ runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } } }),
      T0
    );
    const cap = buildCapacity(node, [
      issue({
        executionRunId: 'r1',
        activeRun: {
          id: 'r1',
          status: 'running',
          agentId: 'agent-1',
          startedAt: null,
          finishedAt: null
        }
      })
    ]);
    const wl = buildWorkload(
      Array.from({ length: 4 }, (_, i) => issue({ id: `i${i}`, identifier: `GSO-${i}` }))
    );
    const burn = buildBudgetBurn(agent(), 0.8);
    const flags = buildStatusFlags(node, cap, wl, burn);
    expect(flags.map((f) => f.key)).toContain('overloaded');
  });

  it('flags blocked-heavy when blocked/open ≥ 0.5', () => {
    const node = buildOrgNode(agent(), T0);
    const cap = buildCapacity(node, []);
    const wl = buildWorkload([
      issue({ id: 'a', status: 'blocked' }),
      issue({ id: 'b', status: 'blocked' }),
      issue({ id: 'c', status: 'todo' })
    ]);
    const burn = buildBudgetBurn(agent(), 0.8);
    const flags = buildStatusFlags(node, cap, wl, burn);
    expect(flags.map((f) => f.key)).toContain('blocked_heavy');
  });

  it('flags budget attention at 80% without pausing', () => {
    const node = buildOrgNode(agent(), T0);
    const cap = buildCapacity(node, []);
    const wl = buildWorkload([]);
    const burn = buildBudgetBurn(agent({ budgetMonthlyCents: 8000, spentMonthlyCents: 6500 }), 0.8);
    const flags = buildStatusFlags(node, cap, wl, burn);
    expect(flags.map((f) => f.key)).toContain('attention');
    expect(flags.map((f) => f.key)).not.toContain('paused_budget');
  });
});

describe('buildCanvasBundle', () => {
  it('groups issues to the right agent and orders nodes by name', () => {
    const agents: PaperclipAgent[] = [
      agent({ id: 'a-cto', name: 'CTO', role: 'cto', reportsTo: 'a-ceo', urlKey: 'cto' }),
      agent({ id: 'a-ceo', name: 'CEO', role: 'ceo', reportsTo: null, urlKey: 'ceo' }),
      agent({
        id: 'a-eng',
        name: 'Founding Engineer',
        role: 'engineer',
        reportsTo: 'a-cto',
        urlKey: 'foundingengineer'
      })
    ];
    const issues: PaperclipIssue[] = [
      issue({ assigneeAgentId: 'a-cto', status: 'in_progress' }),
      issue({ id: 'x', identifier: 'GSO-X', assigneeAgentId: 'a-eng', status: 'blocked' }),
      issue({ id: 'y', identifier: 'GSO-Y', assigneeAgentId: null })
    ];
    const bundle = buildCanvasBundle({
      companyId: 'company-1',
      agents,
      issues,
      options: { now: () => T0 }
    });
    expect(bundle.companyId).toBe('company-1');
    expect(bundle.generatedAt).toBe(new Date(T0).toISOString());
    expect(bundle.nodes.map((n) => n.org.displayName)).toEqual(['CEO', 'CTO', 'Founding Engineer']);
    const eng = bundle.nodes.find((n) => n.org.agentId === 'a-eng')!;
    expect(eng.workload.blockedCount).toBe(1);
    expect(eng.workload.openCount).toBe(1);
    const ceo = bundle.nodes.find((n) => n.org.agentId === 'a-ceo')!;
    expect(ceo.workload.openCount).toBe(0);
  });
});
