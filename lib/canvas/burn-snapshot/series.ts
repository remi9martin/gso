import { enumerateUtcDays, utcDateDaysAgo, toUtcDate } from './date-utils';
import type { BurnSnapshotSeries, BurnSnapshotSeriesPoint, BurnSnapshotStore } from './types';

export const DEFAULT_BURN_SERIES_DAYS = 30;

export async function loadBurnSeries(
  store: BurnSnapshotStore,
  agentId: string,
  options: { now?: Date; days?: number } = {}
): Promise<BurnSnapshotSeries> {
  const now = options.now ?? new Date();
  const days = options.days ?? DEFAULT_BURN_SERIES_DAYS;
  const fromDateUtc = utcDateDaysAgo(now, days - 1);
  const toDateUtc = toUtcDate(now);

  const rows = await store.listForAgent(agentId, { fromDateUtc, toDateUtc });
  const byDay = new Map<string, BurnSnapshotSeriesPoint>();
  for (const row of rows) {
    const utilization =
      row.monthBudgetCents > 0 ? row.monthSpentCents / row.monthBudgetCents : null;
    byDay.set(row.dateUtc, {
      dateUtc: row.dateUtc,
      monthSpentCents: row.monthSpentCents,
      monthBudgetCents: row.monthBudgetCents,
      monthUtilizationPct: utilization
    });
  }

  const ordered: BurnSnapshotSeriesPoint[] = enumerateUtcDays(fromDateUtc, toDateUtc).map(
    (dateUtc) =>
      byDay.get(dateUtc) ?? {
        dateUtc,
        monthSpentCents: null,
        monthBudgetCents: null,
        monthUtilizationPct: null
      }
  );

  return {
    agentId,
    fromDateUtc,
    toDateUtc,
    days: ordered,
    generatedAt: now.toISOString()
  };
}
