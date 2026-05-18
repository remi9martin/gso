// Minimal LLM provider abstraction used by the L1 normalizer.
//
// Mirrors the `LlmProvider` shape shipped in the legacy MVP under GSO-70 so
// callers can think about Claude and Gemini behind a single seam. This is a
// fresh TypeScript implementation — the legacy bridge is plain JS in another
// repo and is not import-compatible with this Next.js app.

export type LlmProviderName = 'claude' | 'gemini' | 'mock';

export interface LlmGenerateRequest {
  /** System prompt — vendor-specific framing applied by each provider. */
  system: string;
  /** User prompt sent as the single user-turn message. */
  prompt: string;
  /** 0 = deterministic. Default 0 across L1 normalizer paths. */
  temperature?: number;
  /** Hard cap on tokens. Defaults set per provider. */
  maxOutputTokens?: number;
  /** Per-request timeout in ms. Defaults applied per provider. */
  timeoutMs?: number;
}

export interface LlmGenerateResponse {
  /** Raw model text. Normalizer is responsible for parsing JSON out of it. */
  text: string;
  /** The model id that served the request, for audit logs. */
  model: string;
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  generate(req: LlmGenerateRequest): Promise<LlmGenerateResponse>;
}

/** Transient failure the normalizer must trigger a fallback on. */
export class LlmTransientError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'LlmTransientError';
  }
}

/** Hard failure that should not trigger a fallback (e.g. auth, 4xx). */
export class LlmPermanentError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'LlmPermanentError';
  }
}
