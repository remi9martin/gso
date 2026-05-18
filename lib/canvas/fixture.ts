import type { PaperclipAgent, PaperclipIssue } from '../paperclip/types';
import { buildCanvasBundle } from './projection';
import type { CanvasBundle } from './types';

// T0 anchors to wall-clock at bundle-build time (not module-parse time) so the
// running-stripe / "1 running" pill stay green even after the dev server has
// been up for a while. The projection idle-threshold check is relative to wall
// clock, so stale fixture timestamps used to flip every agent to idle.
function makeTs(t0: number) {
  return (offsetMs: number): string => new Date(t0 + offsetMs).toISOString();
}

function fixtureAgents(t0: number): PaperclipAgent[] {
  const ts = makeTs(t0);
  return [
    {
      id: 'agent-ceo',
      companyId: 'demo-company',
      name: 'Demo CEO',
      role: 'ceo',
      title: 'Chief Executive (demo)',
      icon: null,
      status: 'running',
      reportsTo: null,
      capabilities: null,
      adapterType: 'claude_local',
      runtimeConfig: { heartbeat: { enabled: true, maxConcurrentRuns: 1 } },
      budgetMonthlyCents: 50000,
      spentMonthlyCents: 31000,
      pauseReason: null,
      pausedAt: null,
      permissions: { canCreateAgents: true },
      lastHeartbeatAt: ts(-60_000),
      urlKey: 'ceo'
    },
    {
      id: 'agent-cto',
      companyId: 'demo-company',
      name: 'Demo CTO',
      role: 'cto',
      title: 'Chief Technology Officer (demo)',
      icon: null,
      status: 'running',
      reportsTo: 'agent-ceo',
      capabilities: null,
      adapterType: 'claude_local',
      runtimeConfig: { heartbeat: { enabled: true, maxConcurrentRuns: 1 } },
      budgetMonthlyCents: 20000,
      spentMonthlyCents: 17800,
      pauseReason: null,
      pausedAt: null,
      permissions: { canCreateAgents: true },
      lastHeartbeatAt: ts(-30_000),
      urlKey: 'cto'
    },
    {
      id: 'agent-eng',
      companyId: 'demo-company',
      name: 'Demo Engineer',
      role: 'engineer',
      title: 'Founding Engineer (demo)',
      icon: null,
      status: 'running',
      reportsTo: 'agent-cto',
      capabilities: null,
      adapterType: 'claude_local',
      runtimeConfig: { heartbeat: { enabled: true, maxConcurrentRuns: 2 } },
      budgetMonthlyCents: 30000,
      spentMonthlyCents: 9500,
      pauseReason: null,
      pausedAt: null,
      permissions: { canCreateAgents: false },
      lastHeartbeatAt: ts(-15_000),
      urlKey: 'engineer'
    },
    {
      id: 'agent-ux',
      companyId: 'demo-company',
      name: 'Demo UX',
      role: 'uxdesigner',
      title: 'UX Designer (demo)',
      icon: null,
      status: 'idle',
      reportsTo: 'agent-cto',
      capabilities: null,
      adapterType: 'claude_local',
      runtimeConfig: { heartbeat: { enabled: true, maxConcurrentRuns: 1 } },
      budgetMonthlyCents: 10000,
      spentMonthlyCents: 0,
      pauseReason: null,
      pausedAt: null,
      permissions: { canCreateAgents: false },
      lastHeartbeatAt: ts(-5 * 60_000),
      urlKey: 'uxdesigner'
    }
  ];
}

function fixtureIssues(t0: number): PaperclipIssue[] {
  const ts = makeTs(t0);
  const issues: PaperclipIssue[] = [];
  let n = 1;
  const push = (overrides: Partial<PaperclipIssue> & Pick<PaperclipIssue, 'assigneeAgentId'>) => {
    issues.push({
      id: `demo-issue-${n}`,
      identifier: `DEMO-${100 + n}`,
      title: overrides.title ?? `Demo issue ${n}`,
      status: 'in_progress',
      priority: 'medium',
      executionRunId: null,
      activeRun: null,
      updatedAt: ts(-n * 60_000),
      lastActivityAt: ts(-n * 60_000),
      ...overrides
    });
    n += 1;
  };

  // CTO: overloaded — 1 slot, multiple open + active run.
  push({
    assigneeAgentId: 'agent-cto',
    status: 'in_progress',
    priority: 'high',
    title: 'Hire QA agent',
    executionRunId: 'run-cto-1',
    activeRun: {
      id: 'run-cto-1',
      status: 'running',
      agentId: 'agent-cto',
      startedAt: ts(-90_000),
      finishedAt: null
    }
  });
  push({
    assigneeAgentId: 'agent-cto',
    status: 'todo',
    priority: 'high',
    title: 'Approve canvas v0.1'
  });
  push({ assigneeAgentId: 'agent-cto', status: 'in_review', title: 'Decide layer-vs-fork stance' });

  // Engineer: overloaded — 2 slots, but 5 open.
  push({
    assigneeAgentId: 'agent-eng',
    status: 'in_progress',
    priority: 'high',
    title: 'Org Canvas v0.1 polish',
    executionRunId: 'run-eng-1',
    activeRun: {
      id: 'run-eng-1',
      status: 'running',
      agentId: 'agent-eng',
      startedAt: ts(-120_000),
      finishedAt: null
    }
  });
  push({
    assigneeAgentId: 'agent-eng',
    status: 'in_progress',
    priority: 'medium',
    title: 'Triage routing affordance',
    executionRunId: 'run-eng-2',
    activeRun: {
      id: 'run-eng-2',
      status: 'running',
      agentId: 'agent-eng',
      startedAt: ts(-200_000),
      finishedAt: null
    }
  });
  push({
    assigneeAgentId: 'agent-eng',
    status: 'todo',
    priority: 'medium',
    title: 'Budget dashboard tablet support'
  });
  push({
    assigneeAgentId: 'agent-eng',
    status: 'todo',
    priority: 'low',
    title: 'Workspace runbook polish'
  });
  push({
    assigneeAgentId: 'agent-eng',
    status: 'blocked',
    priority: 'medium',
    title: 'Burn snapshot store wiring'
  });

  // CEO: light load.
  push({
    assigneeAgentId: 'agent-ceo',
    status: 'todo',
    priority: 'medium',
    title: 'Approve hire plan'
  });

  // UX: empty workload — verifies 0% bar fix.
  return issues;
}

export function fixtureBundle(now: () => number = Date.now): CanvasBundle {
  const t0 = now();
  return buildCanvasBundle({
    companyId: 'demo-company',
    agents: fixtureAgents(t0),
    issues: fixtureIssues(t0),
    options: { now: () => t0 }
  });
}
