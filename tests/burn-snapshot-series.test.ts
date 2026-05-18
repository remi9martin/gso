import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryBurnSnapshotStore } from '@/lib/canvas/burn-snapshot/memory-store';
import { loadBurnSeries } from '@/lib/canvas/burn-snapshot/series';

describe('loadBurnSeries', () => {
  let store: MemoryBurnSnapshotStore;

  beforeEach(() => {
    store = new MemoryBurnSnapshotStore();
  });

  it('returns 30 days with nulls when no data exists', async () => {
    const series = await loadBurnSeries(store, 'a1', { now: new Date('2026-05-18T12:00:00Z') });
    expect(series.days).toHaveLength(30);
    expect(series.days[0].dateUtc).toBe('2026-04-19');
    expect(series.days[29].dateUtc).toBe('2026-05-18');
    expect(series.days.every((d) => d.monthSpentCents === null)).toBe(true);
  });

  it('fills in recorded days and leaves gaps null', async () => {
    await store.putSnapshot({
      agentId: 'a1',
      dateUtc: '2026-05-15',
      snapshotAt: '2026-05-15T12:00:00Z',
      monthSpentCents: 200,
      monthBudgetCents: 1000
    });
    const series = await loadBurnSeries(store, 'a1', { now: new Date('2026-05-18T12:00:00Z') });
    const may15 = series.days.find((d) => d.dateUtc === '2026-05-15');
    expect(may15?.monthSpentCents).toBe(200);
    expect(may15?.monthUtilizationPct).toBeCloseTo(0.2);
    const may16 = series.days.find((d) => d.dateUtc === '2026-05-16');
    expect(may16?.monthSpentCents).toBeNull();
  });

  it('respects the days parameter', async () => {
    const series = await loadBurnSeries(store, 'a1', {
      now: new Date('2026-05-18T12:00:00Z'),
      days: 7
    });
    expect(series.days).toHaveLength(7);
    expect(series.days[0].dateUtc).toBe('2026-05-12');
  });

  it('computes utilization pct correctly', async () => {
    await store.putSnapshot({
      agentId: 'a1',
      dateUtc: '2026-05-18',
      snapshotAt: '2026-05-18T12:00:00Z',
      monthSpentCents: 250,
      monthBudgetCents: 1000
    });
    const series = await loadBurnSeries(store, 'a1', { now: new Date('2026-05-18T12:00:00Z') });
    const today = series.days.find((d) => d.dateUtc === '2026-05-18')!;
    expect(today.monthUtilizationPct).toBeCloseTo(0.25);
  });
});
