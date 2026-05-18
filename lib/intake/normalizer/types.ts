import type { SuggestedTag } from '../front-matter';

export type IntakeKind = 'email' | 'capture' | 'api';

export interface IntakePayload {
  /** Same value the data-model layer writes to `intake_payloads.id`. */
  id: string;
  kind: IntakeKind;
  /** Raw text / html / serialized body. */
  body: string;
  /** Optional context for sourcePointer construction and prompt grounding. */
  sourceMeta?: Record<string, unknown>;
  attachmentRefs?: string[];
  capturedAt?: string;
}

export interface Draft {
  title: string;
  description: string;
  sourcePointer: string;
  suggestedTag: SuggestedTag;
  suggestedNextAction: string;
  rawPayloadId: string;
  /** Self-reported model confidence on suggestedTag accuracy, in [0, 1]. */
  confidence: number;
  /** Which path served the request — surfaced for audit logs and metrics. */
  servedBy: 'claude' | 'gemini' | 'fallback-guard' | string;
}

export interface Normalizer {
  normalize(payload: IntakePayload): Promise<Draft>;
}
