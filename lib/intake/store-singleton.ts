import 'server-only';

import { MemoryApiTokenStore } from './api-token-store-memory';
import type { ApiTokenStore } from './api-tokens';
import { MemoryIntakePayloadStore, type IntakePayloadStore } from './payload-store';

// v0 uses in-memory stores. The Postgres adapters land in a follow-up issue
// alongside the Neon migration the burn-snapshot work already uses
// (see lib/canvas/burn-snapshot/postgres-store.ts).
//
// Both stores are process-scoped singletons so multiple route invocations in
// the same Node process share state (token validation, idempotency).

let payloadStoreSingleton: IntakePayloadStore | null = null;
let tokenStoreSingleton: ApiTokenStore | null = null;

export function getIntakePayloadStore(): IntakePayloadStore {
  if (!payloadStoreSingleton) payloadStoreSingleton = new MemoryIntakePayloadStore();
  return payloadStoreSingleton;
}

export function getIntakeTokenStore(): ApiTokenStore {
  if (!tokenStoreSingleton) tokenStoreSingleton = new MemoryApiTokenStore();
  return tokenStoreSingleton;
}

// Test-only overrides.
export function __setIntakePayloadStore(store: IntakePayloadStore | null): void {
  payloadStoreSingleton = store;
}
export function __setIntakeTokenStore(store: ApiTokenStore | null): void {
  tokenStoreSingleton = store;
}
