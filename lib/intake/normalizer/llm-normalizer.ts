import { LlmTransientError, type LlmProvider } from '../../llm/types';
import { DraftSchemaError, parseLlmDraft } from './draft-schema';
import { SYSTEM_PROMPT, buildSourcePointer, buildUserPrompt } from './prompt';
import type { Draft, IntakePayload, Normalizer } from './types';

export interface LlmNormalizerOptions {
  /** 0 = deterministic. Default 0 — required for the idempotency criterion. */
  temperature?: number;
  /** Max tokens per attempt. Defaults to provider default. */
  maxOutputTokens?: number;
  /** Per-attempt LLM timeout in ms. Defaults to provider default. */
  timeoutMs?: number;
  /** Optional structured logger for "served by X / fell back to Y" lines. */
  logger?: NormalizerLogger;
  /**
   * Override the label written to Draft.servedBy. Defaults to the provider's
   * own `name`. The composite fallback uses this to record which leg served.
   */
  servedByLabel?: string;
}

export interface NormalizerLogger {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
}

const SCHEMA_RETRY_HINT =
  '\n\nIMPORTANT: Your previous response did not parse as a single JSON object matching the required schema. Return ONLY the JSON object — no prose, no fences, no commentary.';

/**
 * Generic LLM-backed Normalizer. Sends a single user prompt and retries once on
 * schema-validation failure with an explicit reminder. On a second failure, the
 * caller is expected to either fall back to another normalizer or invoke the
 * hallucination guard.
 */
export class LlmNormalizer implements Normalizer {
  constructor(
    private readonly provider: LlmProvider,
    private readonly options: LlmNormalizerOptions = {}
  ) {}

  async normalize(payload: IntakePayload): Promise<Draft> {
    const baseUserPrompt = buildUserPrompt(payload);
    const temperature = this.options.temperature ?? 0;
    const servedBy = this.options.servedByLabel ?? this.provider.name;

    let lastError: DraftSchemaError | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const prompt = attempt === 1 ? baseUserPrompt : `${baseUserPrompt}${SCHEMA_RETRY_HINT}`;
      const response = await this.provider.generate({
        system: SYSTEM_PROMPT,
        prompt,
        temperature,
        maxOutputTokens: this.options.maxOutputTokens,
        timeoutMs: this.options.timeoutMs
      });
      try {
        const llmDraft = parseLlmDraft(response.text, attempt);
        if (attempt > 1) {
          this.options.logger?.info('intake.normalizer.schema_retry_succeeded', {
            provider: this.provider.name,
            model: response.model,
            payloadId: payload.id
          });
        }
        return {
          title: llmDraft.title,
          description: llmDraft.description,
          sourcePointer: buildSourcePointer(payload),
          suggestedTag: llmDraft.suggestedTag,
          suggestedNextAction: llmDraft.suggestedNextAction,
          rawPayloadId: payload.id,
          confidence: llmDraft.confidence,
          servedBy
        };
      } catch (err) {
        if (err instanceof DraftSchemaError) {
          lastError = err;
          this.options.logger?.warn('intake.normalizer.schema_failure', {
            provider: this.provider.name,
            attempt,
            payloadId: payload.id,
            message: err.message
          });
          continue;
        }
        throw err;
      }
    }

    // Both attempts failed schema validation. Surface as a transient error so
    // the composite fallback can try the secondary provider.
    throw new LlmTransientError(
      `Normalizer ${this.provider.name} failed JSON schema validation twice: ${lastError?.message ?? 'unknown'}`,
      lastError ?? undefined
    );
  }
}
