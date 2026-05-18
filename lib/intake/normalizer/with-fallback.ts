import { LlmPermanentError, LlmTransientError } from '../../llm/types';
import { buildSourcePointer } from './prompt';
import type { Draft, IntakePayload, Normalizer } from './types';
import type { NormalizerLogger } from './llm-normalizer';

export interface NormalizerWithFallbackOptions {
  logger?: NormalizerLogger;
}

/**
 * Composite normalizer. Tries the primary path first; on a transient failure
 * (5xx, timeout, repeated JSON-schema violation) falls back to the secondary.
 * If the secondary also fails transiently, returns the hallucination-guard
 * Draft so the L1 pipeline never crashes on an upstream model wobble.
 */
export class NormalizerWithFallback implements Normalizer {
  constructor(
    private readonly primary: Normalizer,
    private readonly fallback: Normalizer,
    private readonly options: NormalizerWithFallbackOptions = {}
  ) {}

  async normalize(payload: IntakePayload): Promise<Draft> {
    try {
      const draft = await this.primary.normalize(payload);
      this.options.logger?.info('intake.normalizer.served', {
        path: 'primary',
        servedBy: draft.servedBy,
        payloadId: payload.id
      });
      return draft;
    } catch (err) {
      if (err instanceof LlmPermanentError) {
        // 4xx — bad key, blocked content. Do not silently fall back.
        throw err;
      }
      if (!(err instanceof LlmTransientError)) {
        throw err;
      }
      this.options.logger?.warn('intake.normalizer.fallback', {
        path: 'primary',
        payloadId: payload.id,
        reason: err.message
      });
    }

    try {
      const draft = await this.fallback.normalize(payload);
      this.options.logger?.info('intake.normalizer.served', {
        path: 'fallback',
        servedBy: draft.servedBy,
        payloadId: payload.id
      });
      return draft;
    } catch (err) {
      if (err instanceof LlmPermanentError) throw err;
      if (!(err instanceof LlmTransientError)) throw err;
      this.options.logger?.warn('intake.normalizer.hallucination_guard', {
        payloadId: payload.id,
        reason: err.message
      });
      return buildHallucinationGuardDraft(payload);
    }
  }
}

/**
 * The Draft produced when BOTH the primary and fallback normalizers fail. Per
 * GSO-125 acceptance criteria: title is the raw first line, description is the
 * raw body, confidence is 0, and the tag is `needs_human` so the Triage Inbox
 * surfaces it for review instead of routing on a guess.
 */
export function buildHallucinationGuardDraft(payload: IntakePayload): Draft {
  const firstLine = (payload.body.split(/\r?\n/)[0] ?? '').trim();
  const title = firstLine.length > 0 ? truncate(firstLine, 160) : 'Unparsed intake payload';
  return {
    title,
    description: payload.body,
    sourcePointer: buildSourcePointer(payload),
    suggestedTag: 'needs_human',
    suggestedNextAction: 'Review this payload manually — the L1 normalizer could not parse it.',
    rawPayloadId: payload.id,
    confidence: 0,
    servedBy: 'fallback-guard'
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}
