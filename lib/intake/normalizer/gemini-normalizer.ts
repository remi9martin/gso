import type { LlmProvider } from '../../llm/types';
import { LlmNormalizer, type LlmNormalizerOptions } from './llm-normalizer';

/**
 * Fallback normalizer path: routes through a Gemini-backed LlmProvider.
 *
 * Production wiring constructs this with a `GeminiProvider` from
 * `lib/llm/gemini-provider.ts` and reuses Remi's existing Gemini 2.5-flash key
 * from the MVP.
 */
export class GeminiNormalizer extends LlmNormalizer {
  constructor(provider: LlmProvider, options: LlmNormalizerOptions = {}) {
    super(provider, { ...options, servedByLabel: options.servedByLabel ?? 'gemini' });
  }
}
