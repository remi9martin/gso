import 'server-only';

import { AnthropicProvider } from '../llm/anthropic-provider';
import { GeminiProvider } from '../llm/gemini-provider';
import { MemoryApiTokenStore } from './api-token-store-memory';
import type { ApiTokenStore } from './api-tokens';
import { ClaudeNormalizer } from './normalizer/claude-normalizer';
import { GeminiNormalizer } from './normalizer/gemini-normalizer';
import type { Normalizer } from './normalizer/types';
import { NormalizerWithFallback } from './normalizer/with-fallback';
import { MemoryIntakePayloadStore, type IntakePayloadStore } from './payload-store';

// v0 uses in-memory stores. The Postgres adapters land in a follow-up issue
// alongside the Neon migration the burn-snapshot work already uses
// (see lib/canvas/burn-snapshot/postgres-store.ts).
//
// Both stores are process-scoped singletons so multiple route invocations in
// the same Node process share state (token validation, idempotency).
//
// The normalizer singleton wraps Claude (primary) + Gemini (fallback). The
// composite returns the hallucination-guard Draft if both providers fail —
// the L1 pipeline never crashes on an upstream model wobble.

let payloadStoreSingleton: IntakePayloadStore | null = null;
let tokenStoreSingleton: ApiTokenStore | null = null;
let normalizerSingleton: Normalizer | null = null;
let normalizerLoadAttempted = false;

export function getIntakePayloadStore(): IntakePayloadStore {
  if (!payloadStoreSingleton) payloadStoreSingleton = new MemoryIntakePayloadStore();
  return payloadStoreSingleton;
}

export function getIntakeTokenStore(): ApiTokenStore {
  if (!tokenStoreSingleton) tokenStoreSingleton = new MemoryApiTokenStore();
  return tokenStoreSingleton;
}

/**
 * Returns the production normalizer if both LLM keys are configured. Returns
 * `null` when keys are missing — callers should fall back to the stub draft
 * path so dev/test instances without keys still produce a triagable issue.
 */
export function getIntakeNormalizer(): Normalizer | null {
  if (normalizerSingleton) return normalizerSingleton;
  if (normalizerLoadAttempted) return null;
  normalizerLoadAttempted = true;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!anthropicKey || !geminiKey) return null;

  const claude = new ClaudeNormalizer(new AnthropicProvider({ apiKey: anthropicKey }));
  const gemini = new GeminiNormalizer(new GeminiProvider({ apiKey: geminiKey }));
  normalizerSingleton = new NormalizerWithFallback(claude, gemini);
  return normalizerSingleton;
}

// Test-only overrides.
export function __setIntakePayloadStore(store: IntakePayloadStore | null): void {
  payloadStoreSingleton = store;
}
export function __setIntakeTokenStore(store: ApiTokenStore | null): void {
  tokenStoreSingleton = store;
}
export function __setIntakeNormalizer(normalizer: Normalizer | null): void {
  normalizerSingleton = normalizer;
  normalizerLoadAttempted = true;
}
