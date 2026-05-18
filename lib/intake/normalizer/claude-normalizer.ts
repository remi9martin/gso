import type { LlmProvider } from '../../llm/types';
import { LlmNormalizer, type LlmNormalizerOptions } from './llm-normalizer';

/**
 * Primary normalizer path: routes through a Claude-backed LlmProvider.
 *
 * Production wiring constructs this with an `AnthropicProvider` from
 * `lib/llm/anthropic-provider.ts`. Tests inject a mock provider so no real
 * network calls happen.
 */
export class ClaudeNormalizer extends LlmNormalizer {
  constructor(provider: LlmProvider, options: LlmNormalizerOptions = {}) {
    super(provider, { ...options, servedByLabel: options.servedByLabel ?? 'claude' });
  }
}
