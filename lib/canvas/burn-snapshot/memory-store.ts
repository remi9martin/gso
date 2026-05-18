import type {
  BurnSnapshot,
  BurnSnapshotRangeQuery,
  BurnSnapshotStore,
  PutSnapshotResult
} from './types';

// Default in-process store. Survives across requests within a single Node
// instance but not across cold starts. Production primitive (Vercel Postgres
// or KV) plugs into the same interface — see GSO-52.
export class MemoryBurnSnapshotStore implements BurnSnapshotStore {
  private readonly rows = new Map<string, BurnSnapshot>();

  private key(agentId: string, dateUtc: string): string {
    return `${agentId}:${dateUtc}`;
  }

  async putSnapshot(snapshot: BurnSnapshot): Promise<PutSnapshotResult> {
    const k = this.key(snapshot.agentId, snapshot.dateUtc);
    if (this.rows.has(k)) {
      return { written: false };
    }
    this.rows.set(k, snapshot);
    return { written: true };
  }

  async listForAgent(agentId: string, range: BurnSnapshotRangeQuery): Promise<BurnSnapshot[]> {
    const out: BurnSnapshot[] = [];
    for (const row of this.rows.values()) {
      if (row.agentId !== agentId) continue;
      if (row.dateUtc < range.fromDateUtc) continue;
      if (row.dateUtc > range.toDateUtc) continue;
      out.push(row);
    }
    out.sort((a, b) => a.dateUtc.localeCompare(b.dateUtc));
    return out;
  }

  // Test helper — not part of the BurnSnapshotStore interface.
  __reset(): void {
    this.rows.clear();
  }
}
