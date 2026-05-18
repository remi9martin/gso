// Burn snapshot types — see [data-model §3.1](/GSO/issues/GSO-21#document-data-model).
// One-way door: snapshot rows are the only record of past per-agent daily spend;
// Paperclip cannot replay history.

export interface BurnSnapshot {
  agentId: string;
  // UTC calendar day, YYYY-MM-DD. Idempotency key with agentId.
  dateUtc: string;
  // ISO timestamp at which the snapshot was first observed.
  snapshotAt: string;
  monthSpentCents: number;
  monthBudgetCents: number;
}

export interface BurnSnapshotSeriesPoint {
  dateUtc: string;
  monthSpentCents: number | null;
  monthBudgetCents: number | null;
  monthUtilizationPct: number | null;
}

export interface BurnSnapshotSeries {
  agentId: string;
  // Inclusive bounds, oldest first.
  fromDateUtc: string;
  toDateUtc: string;
  days: BurnSnapshotSeriesPoint[];
  generatedAt: string;
}

export interface PutSnapshotResult {
  // false when a row for (agentId, dateUtc) already existed; first-write-wins.
  written: boolean;
}

export interface BurnSnapshotRangeQuery {
  fromDateUtc: string;
  toDateUtc: string;
}

export interface BurnSnapshotStore {
  putSnapshot(snapshot: BurnSnapshot): Promise<PutSnapshotResult>;
  listForAgent(agentId: string, range: BurnSnapshotRangeQuery): Promise<BurnSnapshot[]>;
}
