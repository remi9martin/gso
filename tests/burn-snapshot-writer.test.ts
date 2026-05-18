import { describe, it, expect } from 'vitest';
import { MemoryBurnSnapshotStore } from '@/lib/canvas/burn-snapshot/memory-store';
import { writeBurnSnapshotsForBundle } from '@/lib/canvas/burn-snapshot/writer';
import type { CanvasBundle } from '@/lib/canvas/types';

function makeBundle(
  agents: { agentId: string; spent: number | null; budget: number | null }[]
): CanvasBundle {
  return {
    companyId: 'co-test',
    generatedAt: new Date().toISOString(),
    nodes: agents.map(({ agentId, spent, budget }) => ({
      org: {
        agentId,
        displayName: agentId,
        roleKey: 'engineer',
        title: null,
        icon: null,
        urlKey: agentId,
        reportsToAgentId: null,
        runtimeStatus: 'idle',
        runtimeStatusRaw: 'idle',
        pauseReason: null,
        pausedAt: null,
        lastHeartbeatAt: null,
        maxConcurrentRuns: 1,
        heartbeatEnabled: false,
        adapterType: 'claude_local'
      },
      capacity: { slotsTotal: 1, slotsActive: 0, slotsFree: 1, utilizationPct: 0 },
      workload: {
        openCount: 0,
        inProgressCount: 0,
        inReviewCount: 0,
        blockedCount: 0,
        highPriorityOpenCount: 0,
        currentIssueRef: null
      },
      budget: {
        monthBudgetCents: budget,
        monthSpentCents: spent,
        monthUtilizationPct: budget && spent ? spent / budget : null,
        attentionThresholdPct: 0.8,
        pauseThresholdPct: 1.0
      },
      flags: []
    }))
  };
}

describe('writeBurnSnapshotsForBundle', () => {
  it('writes one row per agent on first call', async () => {
    const store = new MemoryBurnSnapshotStore();
    const bundle = makeBundle([
      { agentId: 'a1', spent: 100, budget: 1000 },
      { agentId: 'a2', spent: 500, budget: 1000 }
    ]);
    const result = await writeBurnSnapshotsForBundle(
      store,
      bundle,
      new Date('2026-05-01T12:00:00Z')
    );
    expect(result.written).toBe(2);
    expect(result.deduped).toBe(0);
    expect(result.skippedMissingBudget).toBe(0);
  });

  it('deduplicates on second call for same day', async () => {
    const store = new MemoryBurnSnapshotStore();
    const bundle = makeBundle([{ agentId: 'a1', spent: 100, budget: 1000 }]);
    const day = new Date('2026-05-01T10:00:00Z');
    await writeBurnSnapshotsForBundle(store, bundle, day);
    const r2 = await writeBurnSnapshotsForBundle(store, bundle, new Date('2026-05-01T22:00:00Z'));
    expect(r2.written).toBe(0);
    expect(r2.deduped).toBe(1);
  });

  it('writes new row on the next calendar day (UTC)', async () => {
    const store = new MemoryBurnSnapshotStore();
    const bundle = makeBundle([{ agentId: 'a1', spent: 100, budget: 1000 }]);
    await writeBurnSnapshotsForBundle(store, bundle, new Date('2026-05-01T23:59:59Z'));
    const r2 = await writeBurnSnapshotsForBundle(store, bundle, new Date('2026-05-02T00:00:01Z'));
    expect(r2.written).toBe(1);
    expect(r2.deduped).toBe(0);
  });

  it('skips agents with null budget', async () => {
    const store = new MemoryBurnSnapshotStore();
    const bundle = makeBundle([{ agentId: 'a1', spent: 100, budget: null }]);
    const result = await writeBurnSnapshotsForBundle(
      store,
      bundle,
      new Date('2026-05-01T12:00:00Z')
    );
    expect(result.written).toBe(0);
    expect(result.skippedMissingBudget).toBe(1);
  });

  it('skips agents with zero budget', async () => {
    const store = new MemoryBurnSnapshotStore();
    const bundle = makeBundle([{ agentId: 'a1', spent: 0, budget: 0 }]);
    const result = await writeBurnSnapshotsForBundle(
      store,
      bundle,
      new Date('2026-05-01T12:00:00Z')
    );
    expect(result.skippedMissingBudget).toBe(1);
  });

  it('skips agents with null spent', async () => {
    const store = new MemoryBurnSnapshotStore();
    const bundle = makeBundle([{ agentId: 'a1', spent: null, budget: 1000 }]);
    const result = await writeBurnSnapshotsForBundle(
      store,
      bundle,
      new Date('2026-05-01T12:00:00Z')
    );
    expect(result.skippedMissingBudget).toBe(1);
  });
});
