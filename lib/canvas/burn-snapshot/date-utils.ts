export function toUtcDate(d: Date): string {
  // YYYY-MM-DD in UTC. Avoids locale ambiguity at day boundaries.
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function utcDateDaysAgo(now: Date, daysAgo: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return toUtcDate(d);
}

export function enumerateUtcDays(fromDateUtc: string, toDateUtc: string): string[] {
  const out: string[] = [];
  const start = parseUtcDate(fromDateUtc);
  const end = parseUtcDate(toDateUtc);
  for (
    let cursor = new Date(start.getTime());
    cursor.getTime() <= end.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    out.push(toUtcDate(cursor));
  }
  return out;
}

function parseUtcDate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split('-').map((s) => Number(s));
  return new Date(Date.UTC(y, m - 1, d));
}
