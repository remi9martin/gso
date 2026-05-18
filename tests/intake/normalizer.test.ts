import { describe, expect, it } from 'vitest';

import {
  ClaudeNormalizer,
  GeminiNormalizer,
  NormalizerWithFallback,
  buildHallucinationGuardDraft,
  type Draft,
  type IntakePayload,
  type NormalizerLogger
} from '@/lib/intake/normalizer';
import {
  LlmPermanentError,
  LlmTransientError,
  type LlmGenerateRequest,
  type LlmGenerateResponse,
  type LlmProvider,
  type LlmProviderName
} from '@/lib/llm/types';

// --- Test helpers --------------------------------------------------------

interface MockProvider extends LlmProvider {
  readonly calls: LlmGenerateRequest[];
}

function makeMockProvider(
  name: LlmProviderName,
  handler: (
    req: LlmGenerateRequest,
    callIndex: number
  ) => LlmGenerateResponse | Promise<LlmGenerateResponse>
): MockProvider {
  const calls: LlmGenerateRequest[] = [];
  return {
    name,
    calls,
    async generate(req) {
      const index = calls.length;
      calls.push(req);
      return handler(req, index);
    }
  };
}

function llmJson(obj: unknown): string {
  return JSON.stringify(obj);
}

const GOOD_LLM_DRAFT = {
  title: 'AI-powered inbox sweeper for founders',
  description:
    'A single canonical view that consolidates email, Slack, and Linear into one founder inbox.',
  suggestedTag: 'venture' as const,
  suggestedNextAction: 'Draft the one-pager for the inbox sweeper venture.',
  confidence: 0.82
};

function makeCollectingLogger(): NormalizerLogger & {
  events: Array<{ level: 'info' | 'warn'; event: string; fields: Record<string, unknown> }>;
} {
  const events: Array<{ level: 'info' | 'warn'; event: string; fields: Record<string, unknown> }> =
    [];
  return {
    events,
    info(event, fields) {
      events.push({ level: 'info', event, fields });
    },
    warn(event, fields) {
      events.push({ level: 'warn', event, fields });
    }
  };
}

const TYPED_NOTE: IntakePayload = {
  id: 'pl_typed_01',
  kind: 'capture',
  body: 'ai-powered inbox sweeper for founders — single canonical view across email, slack, linear.',
  sourceMeta: { client: 'web' }
};

const FORWARDED_EMAIL: IntakePayload = {
  id: 'pl_email_01',
  kind: 'email',
  body: 'Quick follow-up — can you send the revised term sheet by Friday?',
  sourceMeta: { from: 'sam@example.com', subject: 'Re: Q3 partnership terms' }
};

const RAW_URL: IntakePayload = {
  id: 'pl_url_01',
  kind: 'capture',
  body: 'https://example.com/blog/post-on-vector-databases',
  sourceMeta: { client: 'shortcut' }
};

const SCREENSHOT_CAPTION: IntakePayload = {
  id: 'pl_screen_01',
  kind: 'capture',
  body: 'Caption: slack #leads channel\nOCR: "we need to ship the new pricing page by end of month"',
  sourceMeta: { client: 'screenshot', caption: 'slack #leads channel' }
};

// --- Fixture payloads: each shape produces a fully populated Draft -------

describe('ClaudeNormalizer (fixture payloads)', () => {
  const fixtures: Array<[string, IntakePayload]> = [
    ['typed note', TYPED_NOTE],
    ['forwarded email', FORWARDED_EMAIL],
    ['raw URL', RAW_URL],
    ['screenshot caption', SCREENSHOT_CAPTION]
  ];

  for (const [label, payload] of fixtures) {
    it(`returns a fully populated Draft for a ${label}`, async () => {
      const provider = makeMockProvider('claude', () => ({
        text: llmJson(GOOD_LLM_DRAFT),
        model: 'claude-sonnet-4-6'
      }));
      const normalizer = new ClaudeNormalizer(provider);
      const draft = await normalizer.normalize(payload);

      // All required Draft fields populated.
      expect(draft.title).toBe(GOOD_LLM_DRAFT.title);
      expect(draft.description).toBe(GOOD_LLM_DRAFT.description);
      expect(draft.suggestedTag).toBe(GOOD_LLM_DRAFT.suggestedTag);
      expect(draft.suggestedNextAction).toBe(GOOD_LLM_DRAFT.suggestedNextAction);
      expect(draft.confidence).toBe(GOOD_LLM_DRAFT.confidence);
      expect(draft.rawPayloadId).toBe(payload.id);
      expect(draft.servedBy).toBe('claude');

      // sourcePointer is constructed deterministically, not from the LLM.
      expect(draft.sourcePointer).toContain(payload.kind);
      expect(draft.sourcePointer).toMatch(/bytes=\d+/);
    });
  }
});

// --- Idempotency ---------------------------------------------------------

describe('Idempotency (deterministic temperature=0)', () => {
  it('returns the same Draft for the same payload + same mocked model output', async () => {
    let callCount = 0;
    const provider = makeMockProvider('claude', () => {
      callCount++;
      return { text: llmJson(GOOD_LLM_DRAFT), model: 'claude-sonnet-4-6' };
    });
    const normalizer = new ClaudeNormalizer(provider);

    const first = await normalizer.normalize(TYPED_NOTE);
    const second = await normalizer.normalize(TYPED_NOTE);

    expect(first).toEqual(second);
    expect(callCount).toBe(2);
  });

  it('forces temperature=0 by default', async () => {
    const provider = makeMockProvider('claude', () => ({
      text: llmJson(GOOD_LLM_DRAFT),
      model: 'claude-sonnet-4-6'
    }));
    const normalizer = new ClaudeNormalizer(provider);
    await normalizer.normalize(TYPED_NOTE);
    expect(provider.calls[0].temperature).toBe(0);
  });
});

// --- Fallback ------------------------------------------------------------

describe('NormalizerWithFallback', () => {
  it('falls back to Gemini when Claude returns 5xx', async () => {
    const primary = makeMockProvider('claude', () => {
      throw new LlmTransientError('Anthropic 502: bad gateway', undefined, 502);
    });
    const fallback = makeMockProvider('gemini', () => ({
      text: llmJson(GOOD_LLM_DRAFT),
      model: 'gemini-2.5-flash'
    }));
    const logger = makeCollectingLogger();

    const normalizer = new NormalizerWithFallback(
      new ClaudeNormalizer(primary),
      new GeminiNormalizer(fallback),
      { logger }
    );

    const draft = await normalizer.normalize(TYPED_NOTE);
    expect(draft.servedBy).toBe('gemini');
    expect(draft.suggestedTag).toBe(GOOD_LLM_DRAFT.suggestedTag);
    expect(draft.rawPayloadId).toBe(TYPED_NOTE.id);
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(1);

    const events = logger.events.map((e) => e.event);
    expect(events).toContain('intake.normalizer.fallback');
    expect(events).toContain('intake.normalizer.served');
  });

  it('does not fall back on a permanent 4xx error (e.g. bad API key)', async () => {
    const primary = makeMockProvider('claude', () => {
      throw new LlmPermanentError('Anthropic 401: invalid key', 401);
    });
    const fallback = makeMockProvider('gemini', () => ({
      text: llmJson(GOOD_LLM_DRAFT),
      model: 'gemini-2.5-flash'
    }));

    const normalizer = new NormalizerWithFallback(
      new ClaudeNormalizer(primary),
      new GeminiNormalizer(fallback)
    );

    await expect(normalizer.normalize(TYPED_NOTE)).rejects.toBeInstanceOf(LlmPermanentError);
    expect(fallback.calls).toHaveLength(0);
  });

  it('falls back when Claude returns malformed JSON twice in a row', async () => {
    const primary = makeMockProvider('claude', () => ({
      text: 'I cannot help with that.', // no JSON at all
      model: 'claude-sonnet-4-6'
    }));
    const fallback = makeMockProvider('gemini', () => ({
      text: llmJson(GOOD_LLM_DRAFT),
      model: 'gemini-2.5-flash'
    }));

    const normalizer = new NormalizerWithFallback(
      new ClaudeNormalizer(primary),
      new GeminiNormalizer(fallback)
    );

    const draft = await normalizer.normalize(TYPED_NOTE);
    expect(draft.servedBy).toBe('gemini');
    // Claude was called twice — once normally, once with the schema retry hint.
    expect(primary.calls).toHaveLength(2);
    expect(primary.calls[1].prompt).toContain('IMPORTANT');
  });
});

// --- Hallucination guard -------------------------------------------------

describe('Hallucination guard', () => {
  it('returns the guard Draft when BOTH primary and fallback fail schema validation twice', async () => {
    const primary = makeMockProvider('claude', () => ({
      text: 'not json',
      model: 'claude-sonnet-4-6'
    }));
    const fallback = makeMockProvider('gemini', () => ({
      text: '{"this":"is","not":"the schema"}',
      model: 'gemini-2.5-flash'
    }));
    const logger = makeCollectingLogger();

    const normalizer = new NormalizerWithFallback(
      new ClaudeNormalizer(primary),
      new GeminiNormalizer(fallback),
      { logger }
    );

    const draft = await normalizer.normalize(TYPED_NOTE);
    expect(draft.servedBy).toBe('fallback-guard');
    expect(draft.suggestedTag).toBe('needs_human');
    expect(draft.confidence).toBe(0);
    expect(draft.title).toBe(TYPED_NOTE.body.split('\n')[0]);
    expect(draft.description).toBe(TYPED_NOTE.body);
    expect(draft.rawPayloadId).toBe(TYPED_NOTE.id);

    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(2);
    const events = logger.events.map((e) => e.event);
    expect(events).toContain('intake.normalizer.hallucination_guard');
  });

  it('buildHallucinationGuardDraft uses the raw first line as title', () => {
    const draft: Draft = buildHallucinationGuardDraft({
      ...TYPED_NOTE,
      body: 'first line of the capture\nsecond line ignored'
    });
    expect(draft.title).toBe('first line of the capture');
    expect(draft.suggestedTag).toBe('needs_human');
    expect(draft.confidence).toBe(0);
  });

  it('buildHallucinationGuardDraft handles empty body', () => {
    const draft: Draft = buildHallucinationGuardDraft({
      ...TYPED_NOTE,
      body: ''
    });
    expect(draft.title).toBe('Unparsed intake payload');
    expect(draft.description).toBe('');
  });
});

// --- Schema retry on transient parse failure -----------------------------

describe('Single-provider schema retry', () => {
  it('retries once on a malformed first attempt and succeeds on the second', async () => {
    const responses: LlmGenerateResponse[] = [
      { text: 'preamble that breaks parsing', model: 'claude-sonnet-4-6' },
      { text: llmJson(GOOD_LLM_DRAFT), model: 'claude-sonnet-4-6' }
    ];
    const provider = makeMockProvider('claude', (_req, index) => responses[index]);
    const normalizer = new ClaudeNormalizer(provider);

    const draft = await normalizer.normalize(TYPED_NOTE);
    expect(draft.title).toBe(GOOD_LLM_DRAFT.title);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].prompt).toContain('IMPORTANT');
  });

  it('throws LlmTransientError when both attempts fail schema validation', async () => {
    const provider = makeMockProvider('claude', () => ({
      text: 'never json',
      model: 'claude-sonnet-4-6'
    }));
    const normalizer = new ClaudeNormalizer(provider);
    await expect(normalizer.normalize(TYPED_NOTE)).rejects.toBeInstanceOf(LlmTransientError);
    expect(provider.calls).toHaveLength(2);
  });
});

// --- JSON extraction tolerance -------------------------------------------

describe('JSON extraction tolerance', () => {
  it('parses output wrapped in a fenced code block', async () => {
    const provider = makeMockProvider('claude', () => ({
      text: '```json\n' + llmJson(GOOD_LLM_DRAFT) + '\n```',
      model: 'claude-sonnet-4-6'
    }));
    const normalizer = new ClaudeNormalizer(provider);
    const draft = await normalizer.normalize(TYPED_NOTE);
    expect(draft.title).toBe(GOOD_LLM_DRAFT.title);
  });

  it('rejects output with confidence > 1', async () => {
    const provider = makeMockProvider('claude', () => ({
      text: llmJson({ ...GOOD_LLM_DRAFT, confidence: 1.5 }),
      model: 'claude-sonnet-4-6'
    }));
    const normalizer = new ClaudeNormalizer(provider);
    await expect(normalizer.normalize(TYPED_NOTE)).rejects.toBeInstanceOf(LlmTransientError);
  });

  it('rejects output with an unknown suggestedTag', async () => {
    const provider = makeMockProvider('claude', () => ({
      text: llmJson({ ...GOOD_LLM_DRAFT, suggestedTag: 'something-else' }),
      model: 'claude-sonnet-4-6'
    }));
    const normalizer = new ClaudeNormalizer(provider);
    await expect(normalizer.normalize(TYPED_NOTE)).rejects.toBeInstanceOf(LlmTransientError);
  });
});
