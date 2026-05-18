import type { PaperclipAgent, PaperclipIssue } from '../paperclip/types';
import type {
  AgentStatusFlag,
  BudgetBurn,
  CanvasNode,
  CapacitySnapshot,
  OrgNode,
  OrgNodeRuntimeStatus,
  WorkloadSummary
} from './types';

const KNOWN_RUNTIME_STATUSES = new Set<OrgNodeRuntimeStatus>([
  'running',
  'idle',
  'paused',
  'error'
]);

const IDLE_HEARTBEAT_THRESHOLD_MS = 30 * 60 * 1000;
const ATTENTION_THRESHOLD_PCT = 0.8;
const PAUSE_THRESHOLD_PCT = 1.0;

export interface BuildCanvasOptions {
  now?: () => number;
  attentionThresholdPct?: number;
}

export function buildOrgNode(agent: PaperclipAgent, now: number): OrgNode {
  const runtimeStatusRaw = agent.status ?? 'unknown';
  let runtimeStatus: OrgNodeRuntimeStatus = KNOWN_RUNTIME_STATUSES.has(
    runtimeStatusRaw as OrgNodeRuntimeStatus
  )
    ? (runtimeStatusRaw as OrgNodeRuntimeStatus)
    : 'unknown';

  if (runtimeStatus === 'running' && agent.lastHeartbeatAt) {
    const last = Date.parse(agent.lastHeartbeatAt);
    if (Number.isFinite(last) && now - last > IDLE_HEARTBEAT_THRESHOLD_MS) {
      runtimeStatus = 'idle';
    }
  }

  return {
    agentId: agent.id,
    displayName: agent.name,
    roleKey: agent.role,
    title: agent.title,
    icon: agent.icon,
    urlKey: agent.urlKey,
    reportsToAgentId: agent.reportsTo,
    runtimeStatus,
    runtimeStatusRaw,
    pauseReason: agent.pauseReason,
    pausedAt: agent.pausedAt,
    lastHeartbeatAt: agent.lastHeartbeatAt,
    maxConcurrentRuns: agent.runtimeConfig?.heartbeat?.maxConcurrentRuns ?? 1,
    heartbeatEnabled: agent.runtimeConfig?.heartbeat?.enabled ?? false,
    adapterType: agent.adapterType
  };
}

export function buildCapacity(node: OrgNode, issuesForAgent: PaperclipIssue[]): CapacitySnapshot {
  const slotsTotal = Math.max(node.maxConcurrentRuns, 0);
  const slotsActive = issuesForAgent.filter(
    (issue) => issue.activeRun?.status === 'running'
  ).length;
  const slotsFree = Math.max(slotsTotal - slotsActive, 0);
  const utilizationPct = slotsTotal > 0 ? slotsActive / slotsTotal : 0;
  return { slotsTotal, slotsActive, slotsFree, utilizationPct };
}

export function buildWorkload(issuesForAgent: PaperclipIssue[]): WorkloadSummary {
  let inProgressCount = 0;
  let inReviewCount = 0;
  let blockedCount = 0;
  let highPriorityOpenCount = 0;
  let currentIssueRef: WorkloadSummary['currentIssueRef'] = null;
  let currentIssueActivity = -Infinity;

  for (const issue of issuesForAgent) {
    if (issue.status === 'in_progress') inProgressCount += 1;
    else if (issue.status === 'in_review') inReviewCount += 1;
    else if (issue.status === 'blocked') blockedCount += 1;

    if (issue.priority === 'critical' || issue.priority === 'high') {
      highPriorityOpenCount += 1;
    }

    if (issue.executionRunId) {
      const stamp = Date.parse(issue.lastActivityAt ?? issue.updatedAt ?? '');
      const ranked = Number.isFinite(stamp) ? stamp : 0;
      if (ranked >= currentIssueActivity) {
        currentIssueActivity = ranked;
        currentIssueRef = {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title
        };
      }
    }
  }

  return {
    openCount: issuesForAgent.length,
    inProgressCount,
    inReviewCount,
    blockedCount,
    highPriorityOpenCount,
    currentIssueRef
  };
}

export function buildBudgetBurn(agent: PaperclipAgent, attentionThresholdPct: number): BudgetBurn {
  const budget = agent.budgetMonthlyCents;
  const spent = agent.spentMonthlyCents;
  const utilization =
    typeof budget === 'number' && budget > 0 && typeof spent === 'number' ? spent / budget : null;
  return {
    monthBudgetCents: budget ?? null,
    monthSpentCents: spent ?? null,
    monthUtilizationPct: utilization,
    attentionThresholdPct,
    pauseThresholdPct: PAUSE_THRESHOLD_PCT
  };
}

export function buildStatusFlags(
  node: OrgNode,
  capacity: CapacitySnapshot,
  workload: WorkloadSummary,
  budget: BudgetBurn
): AgentStatusFlag[] {
  const flags: AgentStatusFlag[] = [];

  if (node.runtimeStatus === 'error') {
    flags.push({ key: 'error', label: 'error', severity: 'critical' });
  }

  const budgetMentionsPause = !!node.pauseReason && /budget|spend|cost/i.test(node.pauseReason);
  const overBudgetPaused =
    budget.monthUtilizationPct !== null && budget.monthUtilizationPct >= budget.pauseThresholdPct;

  if (node.runtimeStatus === 'paused' || node.pausedAt) {
    if (budgetMentionsPause || overBudgetPaused) {
      flags.push({ key: 'paused_budget', label: 'paused: budget', severity: 'critical' });
    } else {
      flags.push({ key: 'paused_manual', label: 'paused', severity: 'warn' });
    }
  } else if (overBudgetPaused) {
    flags.push({ key: 'paused_budget', label: 'over budget', severity: 'critical' });
  }

  if (node.runtimeStatus === 'running') {
    flags.push({ key: 'running', label: 'running', severity: 'info' });
  } else if (node.runtimeStatus === 'idle') {
    flags.push({ key: 'idle', label: 'idle', severity: 'info' });
  }

  if (
    capacity.slotsTotal > 0 &&
    capacity.utilizationPct >= 1 &&
    workload.openCount > capacity.slotsTotal
  ) {
    flags.push({ key: 'overloaded', label: 'overloaded', severity: 'warn' });
  }

  if (workload.openCount > 0 && workload.blockedCount / workload.openCount >= 0.5) {
    flags.push({ key: 'blocked_heavy', label: 'blocked-heavy', severity: 'warn' });
  }

  if (
    !overBudgetPaused &&
    budget.monthUtilizationPct !== null &&
    budget.monthUtilizationPct >= budget.attentionThresholdPct
  ) {
    flags.push({ key: 'attention', label: 'budget attention', severity: 'warn' });
  }

  return flags;
}

export function buildCanvasNode(
  agent: PaperclipAgent,
  issuesForAgent: PaperclipIssue[],
  options: { now: number; attentionThresholdPct: number }
): CanvasNode {
  const org = buildOrgNode(agent, options.now);
  const capacity = buildCapacity(org, issuesForAgent);
  const workload = buildWorkload(issuesForAgent);
  const budget = buildBudgetBurn(agent, options.attentionThresholdPct);
  const flags = buildStatusFlags(org, capacity, workload, budget);
  return { org, capacity, workload, budget, flags };
}

export interface BuildCanvasBundleInput {
  companyId: string;
  agents: PaperclipAgent[];
  issues: PaperclipIssue[];
  options?: BuildCanvasOptions;
}

export function buildCanvasBundle(input: BuildCanvasBundleInput): {
  companyId: string;
  generatedAt: string;
  nodes: CanvasNode[];
} {
  const now = (input.options?.now ?? Date.now)();
  const attentionThresholdPct = input.options?.attentionThresholdPct ?? ATTENTION_THRESHOLD_PCT;

  const issuesByAgent = new Map<string, PaperclipIssue[]>();
  for (const issue of input.issues) {
    if (!issue.assigneeAgentId) continue;
    const bucket = issuesByAgent.get(issue.assigneeAgentId);
    if (bucket) bucket.push(issue);
    else issuesByAgent.set(issue.assigneeAgentId, [issue]);
  }

  const nodes = input.agents
    .map((agent) =>
      buildCanvasNode(agent, issuesByAgent.get(agent.id) ?? [], {
        now,
        attentionThresholdPct
      })
    )
    .sort((a, b) => a.org.displayName.localeCompare(b.org.displayName));

  return {
    companyId: input.companyId,
    generatedAt: new Date(now).toISOString(),
    nodes
  };
}
