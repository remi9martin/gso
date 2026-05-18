import 'server-only';

import { MemoryBurnSnapshotStore } from './memory-store';
import { PostgresBurnSnapshotStore } from './postgres-store';
import type { BurnSnapshotStore } from './types';

interface BurnStoreState {
  store: BurnSnapshotStore | null;
}

const globalRef = globalThis as typeof globalThis & {
  __gsoBurnStore?: BurnStoreState;
};

function state(): BurnStoreState {
  if (!globalRef.__gsoBurnStore) {
    globalRef.__gsoBurnStore = { store: null };
  }
  return globalRef.__gsoBurnStore;
}

function createStoreFromEnv(): BurnSnapshotStore {
  // Env-gated so production can flip the adapter without code changes;
  // default 'memory' keeps dev and existing test suites unchanged.
  const mode = (process.env.BURN_SNAPSHOT_STORE ?? 'memory').toLowerCase();
  if (mode === 'postgres') {
    return new PostgresBurnSnapshotStore();
  }
  return new MemoryBurnSnapshotStore();
}

export function getBurnSnapshotStore(): BurnSnapshotStore {
  const s = state();
  if (!s.store) {
    s.store = createStoreFromEnv();
  }
  return s.store;
}

export function __setBurnSnapshotStoreForTests(store: BurnSnapshotStore | null): void {
  state().store = store;
}
