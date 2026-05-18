import 'server-only';

import type { BurnSnapshotSeries } from './types';

const DEFAULT_TTL_MS = 30_000;

interface CacheEntry {
  series: BurnSnapshotSeries;
  expiresAt: number;
}

interface SeriesCacheState {
  entries: Map<string, CacheEntry>;
  inflight: Map<string, Promise<BurnSnapshotSeries>>;
}

const globalRef = globalThis as typeof globalThis & {
  __gsoBurnSeriesCache?: SeriesCacheState;
};

function state(): SeriesCacheState {
  if (!globalRef.__gsoBurnSeriesCache) {
    globalRef.__gsoBurnSeriesCache = { entries: new Map(), inflight: new Map() };
  }
  return globalRef.__gsoBurnSeriesCache;
}

export interface BurnSeriesCacheReadResult {
  series: BurnSnapshotSeries;
  source: 'hit' | 'miss';
}

export async function readBurnSeries(
  agentId: string,
  loader: () => Promise<BurnSnapshotSeries>,
  ttlMs: number = DEFAULT_TTL_MS,
  now: () => number = Date.now
): Promise<BurnSeriesCacheReadResult> {
  const s = state();
  const t = now();
  const cached = s.entries.get(agentId);
  if (cached && cached.expiresAt > t) {
    return { series: cached.series, source: 'hit' };
  }

  const inflight = s.inflight.get(agentId);
  if (inflight) {
    const series = await inflight;
    return { series, source: 'hit' };
  }

  const pending = (async () => {
    const series = await loader();
    s.entries.set(agentId, { series, expiresAt: now() + ttlMs });
    return series;
  })();
  s.inflight.set(agentId, pending);

  try {
    const series = await pending;
    return { series, source: 'miss' };
  } finally {
    s.inflight.delete(agentId);
  }
}

export function __resetBurnSeriesCacheForTests(): void {
  const s = state();
  s.entries.clear();
  s.inflight.clear();
}
