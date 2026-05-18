import { describe, it, expect } from 'vitest';

import {
  PostgresBurnSnapshotStore,
  type SqlClient
} from '@/lib/canvas/burn-snapshot/postgres-store';

interface FakeRow {
  agent_id: string;
  date_utc: string;
  snapshot_at: string;
  month_spent_cents: number;
  month_budget_cents: number;
}

interface FakeSql {
  client: SqlClient;
  rows: FakeRow[];
}

// In-memory fake of the @vercel/postgres `sql` tagged-template client.
// Inspects the first SQL chunk to decide INSERT vs SELECT, and applies
// (agent_id, date_utc) primary-key dedup so we exercise the real
// "ON CONFLICT DO NOTHING" semantics without needing a real database.
function createFakeSql(initial: FakeRow[] = []): FakeSql {
  const rows: FakeRow[] = [...initial];
  const client: SqlClient = (async <Row = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    const head = strings[0]!.trim().slice(0, 6).toUpperCase();
    if (head === 'INSERT') {
      const [agentId, dateUtc, snapshotAt, monthSpentCents, monthBudgetCents] = values as [
        string,
        string,
        string,
        number,
        number
      ];
      const existing = rows.find((r) => r.agent_id === agentId && r.date_utc === dateUtc);
      if (existing) {
        return { rows: [] as Row[], rowCount: 0 };
      }
      rows.push({
        agent_id: agentId,
        date_utc: dateUtc,
        snapshot_at: snapshotAt,
        month_spent_cents: monthSpentCents,
        month_budget_cents: monthBudgetCents
      });
      return { rows: [] as Row[], rowCount: 1 };
    }
    if (head === 'SELECT') {
      const [agentId, from, to] = values as [string, string, string];
      const matched = rows
        .filter((r) => r.agent_id === agentId && r.date_utc >= from && r.date_utc <= to)
        .sort((a, b) => a.date_utc.localeCompare(b.date_utc));
      return {
        rows: matched as unknown as Row[],
        rowCount: matched.length
      };
    }
    throw new Error(`unexpected SQL: ${strings.join('?')}`);
  }) as SqlClient;
  return { client, rows };
}

function snap(
  agentId: string,
  dateUtc: string,
  extras: Partial<{ snapshotAt: string; spent: number; budget: number }> = {}
) {
  return {
    agentId,
    dateUtc,
    snapshotAt: extras.snapshotAt ?? `${dateUtc}T12:00:00.000Z`,
    monthSpentCents: extras.spent ?? 100,
    monthBudgetCents: extras.budget ?? 1000
  };
}

describe('PostgresBurnSnapshotStore', () => {
  it('inserts on first write and reports written=true', async () => {
    const fake = createFakeSql();
    const store = new PostgresBurnSnapshotStore(fake.client);
    const result = await store.putSnapshot(snap('a1', '2026-05-01'));
    expect(result).toEqual({ written: true });
    expect(fake.rows).toHaveLength(1);
  });

  it('dedupes (agent_id, date_utc) — second write returns written=false', async () => {
    const fake = createFakeSql();
    const store = new PostgresBurnSnapshotStore(fake.client);
    await store.putSnapshot(snap('a1', '2026-05-01', { spent: 100 }));
    const second = await store.putSnapshot(snap('a1', '2026-05-01', { spent: 999 }));
    expect(second).toEqual({ written: false });
    // First-write-wins: stored row still reflects the earlier spend.
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0]!.month_spent_cents).toBe(100);
  });

  it('idempotency survives a simulated cold start (new store, same db)', async () => {
    const fake = createFakeSql();
    const first = new PostgresBurnSnapshotStore(fake.client);
    await first.putSnapshot(snap('a1', '2026-05-01'));

    // Simulate the serverless function tearing down and a new instance
    // booting against the same Postgres backend.
    const second = new PostgresBurnSnapshotStore(fake.client);
    const result = await second.putSnapshot(snap('a1', '2026-05-01'));
    expect(result).toEqual({ written: false });
    expect(fake.rows).toHaveLength(1);
  });

  it('listForAgent returns rows in date order, inclusive of range bounds', async () => {
    const fake = createFakeSql();
    const store = new PostgresBurnSnapshotStore(fake.client);
    // Insert out-of-order to prove ORDER BY date_utc ASC works through the
    // adapter rather than relying on insert order.
    await store.putSnapshot(snap('a1', '2026-05-03', { spent: 300 }));
    await store.putSnapshot(snap('a1', '2026-05-01', { spent: 100 }));
    await store.putSnapshot(snap('a1', '2026-05-02', { spent: 200 }));
    await store.putSnapshot(snap('a2', '2026-05-02', { spent: 999 }));

    const out = await store.listForAgent('a1', {
      fromDateUtc: '2026-05-01',
      toDateUtc: '2026-05-03'
    });
    expect(out.map((r) => r.dateUtc)).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
    expect(out.map((r) => r.monthSpentCents)).toEqual([100, 200, 300]);
    // Cross-agent isolation: the a2 row never leaks into a1's range query.
    expect(out.every((r) => r.agentId === 'a1')).toBe(true);
  });

  it('listForAgent clips rows outside the requested range', async () => {
    const fake = createFakeSql();
    const store = new PostgresBurnSnapshotStore(fake.client);
    await store.putSnapshot(snap('a1', '2026-04-30'));
    await store.putSnapshot(snap('a1', '2026-05-01'));
    await store.putSnapshot(snap('a1', '2026-05-15'));
    await store.putSnapshot(snap('a1', '2026-05-16'));

    const out = await store.listForAgent('a1', {
      fromDateUtc: '2026-05-01',
      toDateUtc: '2026-05-15'
    });
    expect(out.map((r) => r.dateUtc)).toEqual(['2026-05-01', '2026-05-15']);
  });

  it('listForAgent normalises Date snapshot_at into ISO strings', async () => {
    // Real Postgres driver returns timestamptz as a Date instance. The
    // adapter must coerce so callers see the same shape the seam contract
    // (snapshotAt: string) promises.
    const fake = createFakeSql();
    const store = new PostgresBurnSnapshotStore(fake.client);
    const isoDate = new Date('2026-05-01T08:30:00.000Z');
    fake.rows.push({
      agent_id: 'a1',
      date_utc: '2026-05-01',
      snapshot_at: isoDate as unknown as string,
      month_spent_cents: 42,
      month_budget_cents: 100
    });
    const out = await store.listForAgent('a1', {
      fromDateUtc: '2026-05-01',
      toDateUtc: '2026-05-01'
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.snapshotAt).toBe('2026-05-01T08:30:00.000Z');
  });
});
