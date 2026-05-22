export type PaperclipAgentStatus = 'running' | 'idle' | 'paused' | 'error' | string;

export type PaperclipIssueStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'blocked'
  | 'cancelled';

export type PaperclipIssuePriority = 'critical' | 'high' | 'medium' | 'low';

export interface PaperclipAgent {
  id: string;
  companyId: string;
  name: string;
  role: string;
  title: string | null;
  icon: string | null;
  status: PaperclipAgentStatus;
  reportsTo: string | null;
  capabilities: string | null;
  adapterType: string;
  runtimeConfig?: {
    heartbeat?: { enabled?: boolean; maxConcurrentRuns?: number };
  } | null;
  budgetMonthlyCents: number | null;
  spentMonthlyCents: number | null;
  pauseReason: string | null;
  pausedAt: string | null;
  permissions?: { canCreateAgents?: boolean } | null;
  lastHeartbeatAt: string | null;
  urlKey: string;
}

export interface PaperclipActiveRun {
  id: string;
  status: string;
  agentId: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PaperclipIssue {
  id: string;
  identifier: string;
  title: string;
  status: PaperclipIssueStatus;
  priority: PaperclipIssuePriority;
  assigneeAgentId: string | null;
  executionRunId: string | null;
  activeRun: PaperclipActiveRun | null;
  updatedAt: string;
  lastActivityAt: string | null;
}

export interface PaperclipApproval {
  id: string;
  type: string;
  status: 'pending' | 'approved' | 'denied' | string;
  issueIds: string[];
  requestedByAgentId: string;
  createdAt: string;
}
