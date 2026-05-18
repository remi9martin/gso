import { describe, it, expect, beforeEach } from 'vitest';
import { readBurnSeries, __resetBurnSeriesCacheForTests } from '@/lib/canvas/burn-snapshot/series-cache';
import type { BurnSnapshotSeries } from '@/lib/canvas/burn-snapshot/types';

function makeSeries(agentId: string): BurnSnapshotSeries {
  return {
    agentId,
    fromDateUtc: '2026-04-19',
    toDateUtc: '2026-05-18',
    days: [],
    generatedAt: new Date().toISOString()
  };
}

describe('readBurnSeries cache', () => {
  beforeEach(() => {
    __resetBurnSeriesCacheForTests();
  });

  it('returns miss on first load, hit on second', async () => {
    let calls = 0;
    const loader = async () => { calls++; return makeSeries('a1'); };
    const r1 = await readBurnSeries('a1', loader);
    const r2 = await readBurnSeries('a1', loader);
    expect(r1.source).toBe('miss');
    expect(r2.source).toBe('hit');
    expect(calls).toBe(1);
  });

  it('expires after TTL', async () => {
    let calls = 0;
    const loader = async () => { calls++; return makeSeries('a1'); };
    let t = 1000;
    const now = () => t;
    await readBurnSeries('a1', loader, 100, now);
    t = 1200; // past TTL
    const r2 = await readBurnSeries('a1', loader, 100, now);
    expect(r2.source).toBe('miss');
    expect(calls).toBe(2);
  });

  it('caches per agentId independently', async () => {
    let a1calls = 0, a2calls = 0;
    const r1 = await readBurnSeries('a1', async () => { a1calls++; return makeSeries('a1'); });
    const r2 = await readBurnSeries('a2', async () => { a2calls++; return makeSeries('a2'); });
    expect(r1.source).toBe('miss');
    expect(r2.source).toBe('miss');
    expect(a1calls).toBe(1);
    expect(a2calls).toBe(1);
    const r3 = await readBurnSeries('a1', async () => { a1calls++; return makeSeries('a1'); });
    expect(r3.source).toBe('hit');
    expect(a1calls).toBe(1);
  });
});
