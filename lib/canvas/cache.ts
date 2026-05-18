import 'server-only';

import type { CanvasBundle } from './types';

const DEFAULT_TTL_MS = 15_000;

interface CacheEntry {
  bundle: CanvasBundle;
  expiresAt: number;
}

interface CanvasCacheState {
  entry: CacheEntry | null;
  inflight: Promise<CanvasBundle> | null;
}

const globalRef = globalThis as typeof globalThis & {
  __gsoCanvasCache?: CanvasCacheState;
};

function state(): CanvasCacheState {
  if (!globalRef.__gsoCanvasCache) {
    globalRef.__gsoCanvasCache = { entry: null, inflight: null };
  }
  return globalRef.__gsoCanvasCache;
}

export interface CanvasCacheReadResult {
  bundle: CanvasBundle;
  source: 'hit' | 'miss';
}

export async function readCanvasBundle(
  loader: () => Promise<CanvasBundle>,
  ttlMs: number = DEFAULT_TTL_MS,
  now: () => number = Date.now
): Promise<CanvasCacheReadResult> {
  const s = state();
  const t = now();

  if (s.entry && s.entry.expiresAt > t) {
    return { bundle: s.entry.bundle, source: 'hit' };
  }

  if (s.inflight) {
    const bundle = await s.inflight;
    return { bundle, source: 'hit' };
  }

  const inflight = (async () => {
    const bundle = await loader();
    s.entry = { bundle, expiresAt: now() + ttlMs };
    return bundle;
  })();
  s.inflight = inflight;

  try {
    const bundle = await inflight;
    return { bundle, source: 'miss' };
  } finally {
    s.inflight = null;
  }
}

export function invalidateCanvasCache(): void {
  const s = state();
  s.entry = null;
}

export function __resetCanvasCacheForTests(): void {
  const s = state();
  s.entry = null;
  s.inflight = null;
}
