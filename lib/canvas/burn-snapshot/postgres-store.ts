import 'server-only';

import { sql as defaultSql } from '@vercel/postgres';

import type {
  BurnSnapshot,
  BurnSnapshotRangeQuery,
  BurnSnapshotStore,
  PutSnapshotResult
} from './types';

// Minimal surface of the @vercel/postgres `sql` tagged-template client that
// this adapter relies on. Typed locally so tests can inject a fake without
// pulling the full @vercel/postgres types into the test surface.
export type SqlClient = <Row = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<{ rows: Row[]; rowCount: number }>;

interface BurnRow {
  agent_id: string;
  date_utc: string;
  snapshot_at: string | Date;
  month_spent_cents: number;
  month_budget_cents: number;
}

export class PostgresBurnSnapshotStore implements BurnSnapshotStore {
  // Pooled client by default — @vercel/postgres manages its own connection
  // pool, so we hold a single reference instead of opening per request.
  constructor(private readonly sql: SqlClient = defaultSql as unknown as SqlClient) {}

  async putSnapshot(snapshot: BurnSnapshot): Promise<PutSnapshotResult> {
    const result = await this.sql`
      INSERT INTO budget_burn_snapshot
        (agent_id, date_utc, snapshot_at, month_spent_cents, month_budget_cents)
      VALUES
        (${snapshot.agentId}, ${snapshot.dateUtc}, ${snapshot.snapshotAt},
         ${snapshot.monthSpentCents}, ${snapshot.monthBudgetCents})
      ON CONFLICT (agent_id, date_utc) DO NOTHING
    `;
    return { written: (result.rowCount ?? 0) > 0 };
  }

  async listForAgent(agentId: string, range: BurnSnapshotRangeQuery): Promise<BurnSnapshot[]> {
    // to_char keeps date_utc as 'YYYY-MM-DD' so it matches the type contract
    // without round-tripping through a JS Date (which would shift in non-UTC
    // local zones).
    const result = await this.sql<BurnRow>`
      SELECT
        agent_id,
        to_char(date_utc, 'YYYY-MM-DD') AS date_utc,
        snapshot_at,
        month_spent_cents,
        month_budget_cents
      FROM budget_burn_snapshot
      WHERE agent_id = ${agentId}
        AND date_utc BETWEEN ${range.fromDateUtc}::date AND ${range.toDateUtc}::date
      ORDER BY date_utc ASC
    `;
    return result.rows.map((row) => ({
      agentId: row.agent_id,
      dateUtc: row.date_utc,
      snapshotAt:
        typeof row.snapshot_at === 'string' ? row.snapshot_at : row.snapshot_at.toISOString(),
      monthSpentCents: row.month_spent_cents,
      monthBudgetCents: row.month_budget_cents
    }));
  }
}
