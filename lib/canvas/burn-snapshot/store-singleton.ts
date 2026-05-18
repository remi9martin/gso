import 'server-only';

import { MemoryBurnSnapshotStore } from './memory-store';
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

export function getBurnSnapshotStore(): BurnSnapshotStore {
  const s = state();
  if (!s.store) {
    s.store = new MemoryBurnSnapshotStore();
  }
  return s.store;
}

export function __setBurnSnapshotStoreForTests(store: BurnSnapshotStore | null): void {
  state().store = store;
}
