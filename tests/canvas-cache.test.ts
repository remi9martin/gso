import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetCanvasCacheForTests,
  invalidateCanvasCache,
  readCanvasBundle
} from '@/lib/canvas/cache';
import type { CanvasBundle } from '@/lib/canvas/types';

function bundle(stamp: string): CanvasBundle {
  return { companyId: 'c', generatedAt: stamp, nodes: [] };
}

describe('canvas cache', () => {
  afterEach(() => {
    __resetCanvasCacheForTests();
  });

  it('returns miss then hit within the TTL window', async () => {
    let now = 1000;
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return bundle(`gen-${calls}`);
    };
    const first = await readCanvasBundle(loader, 10_000, () => now);
    expect(first.source).toBe('miss');
    expect(first.bundle.generatedAt).toBe('gen-1');
    now += 1_000;
    const second = await readCanvasBundle(loader, 10_000, () => now);
    expect(second.source).toBe('hit');
    expect(calls).toBe(1);
  });

  it('refetches after the TTL expires', async () => {
    let now = 1000;
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return bundle(`gen-${calls}`);
    };
    await readCanvasBundle(loader, 5_000, () => now);
    now += 6_000;
    const next = await readCanvasBundle(loader, 5_000, () => now);
    expect(next.source).toBe('miss');
    expect(calls).toBe(2);
  });

  it('invalidate forces a refetch on the next call', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return bundle(`gen-${calls}`);
    };
    await readCanvasBundle(loader);
    invalidateCanvasCache();
    const next = await readCanvasBundle(loader);
    expect(next.source).toBe('miss');
    expect(calls).toBe(2);
  });

  it('coalesces concurrent calls into one loader invocation', async () => {
    let calls = 0;
    let resolve: ((b: CanvasBundle) => void) | null = null;
    const loader = () =>
      new Promise<CanvasBundle>((res) => {
        calls += 1;
        resolve = res;
      });
    const a = readCanvasBundle(loader);
    const b = readCanvasBundle(loader);
    resolve!(bundle('gen-1'));
    const [r1, r2] = await Promise.all([a, b]);
    expect(calls).toBe(1);
    expect(r1.bundle.generatedAt).toBe('gen-1');
    expect(r2.bundle.generatedAt).toBe('gen-1');
  });
});
