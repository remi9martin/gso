export type OrgNodeRuntimeStatus = 'running' | 'idle' | 'paused' | 'error' | 'unknown';

export type AgentStatusFlagKey =
  | 'running'
  | 'idle'
  | 'paused_budget'
  | 'paused_manual'
  | 'error'
  | 'overloaded'
  | 'blocked_heavy'
  | 'attention';

export type StatusFlagSeverity = 'info' | 'warn' | 'critical';

export interface AgentStatusFlag {
  key: AgentStatusFlagKey;
  label: string;
  severity: StatusFlagSeverity;
}

export interface OrgNode {
  agentId: string;
  displayName: string;
  roleKey: string;
  title: string | null;
  icon: string | null;
  urlKey: string;
  reportsToAgentId: string | null;
  runtimeStatus: OrgNodeRuntimeStatus;
  runtimeStatusRaw: string;
  pauseReason: string | null;
  pausedAt: string | null;
  lastHeartbeatAt: string | null;
  maxConcurrentRuns: number;
  heartbeatEnabled: boolean;
  adapterType: string;
}

export interface CapacitySnapshot {
  slotsTotal: number;
  slotsActive: number;
  slotsFree: number;
  utilizationPct: number;
}

export interface WorkloadSummary {
  openCount: number;
  inProgressCount: number;
  inReviewCount: number;
  blockedCount: number;
  highPriorityOpenCount: number;
  currentIssueRef: { id: string; identifier: string; title: string } | null;
}

export interface BudgetBurn {
  monthBudgetCents: number | null;
  monthSpentCents: number | null;
  monthUtilizationPct: number | null;
  attentionThresholdPct: number;
  pauseThresholdPct: number;
}

export interface CanvasNode {
  org: OrgNode;
  capacity: CapacitySnapshot;
  workload: WorkloadSummary;
  budget: BudgetBurn;
  flags: AgentStatusFlag[];
}

export interface CanvasBundle {
  companyId: string;
  generatedAt: string;
  nodes: CanvasNode[];
}
