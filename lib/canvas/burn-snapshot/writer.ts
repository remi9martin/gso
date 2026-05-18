import type { CanvasBundle } from '../types';
import { toUtcDate } from './date-utils';
import type { BurnSnapshotStore } from './types';

export interface WriteSnapshotsResult {
  // Rows newly inserted for this read (first observation of the (agent, day)).
  written: number;
  // Rows skipped because the agent has no monthly budget (or no spend).
  skippedMissingBudget: number;
  // Rows skipped because (agent, day) was already written earlier — idempotency.
  deduped: number;
}

export async function writeBurnSnapshotsForBundle(
  store: BurnSnapshotStore,
  bundle: CanvasBundle,
  now: Date = new Date()
): Promise<WriteSnapshotsResult> {
  const dateUtc = toUtcDate(now);
  const snapshotAt = now.toISOString();
  let written = 0;
  let skippedMissingBudget = 0;
  let deduped = 0;

  for (const node of bundle.nodes) {
    const { monthBudgetCents, monthSpentCents } = node.budget;
    // Skip when we lack a budget or a spend reading — no useful row to write.
    if (
      typeof monthBudgetCents !== 'number' ||
      monthBudgetCents <= 0 ||
      typeof monthSpentCents !== 'number'
    ) {
      skippedMissingBudget += 1;
      continue;
    }

    const result = await store.putSnapshot({
      agentId: node.org.agentId,
      dateUtc,
      snapshotAt,
      monthSpentCents,
      monthBudgetCents
    });
    if (result.written) written += 1;
    else deduped += 1;
  }

  return { written, skippedMissingBudget, deduped };
}
