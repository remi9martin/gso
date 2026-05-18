# L1 CONSOLIDATOR — LLM normalizer

Status: shipped in GSO-125. Architecture context lives in the [GSO-116 plan](/GSO/issues/GSO-116#document-plan), sections "Architecture → pipeline" and "Risk → hallucination".

## What this module does

Turns an `IntakePayload` (raw text + minimal metadata captured by the L1.2 ingest endpoint) into a structured `Draft` the L1.1 helper can persist as a Paperclip issue. The Draft carries:

| Field                 | Source                                              |
| --------------------- | --------------------------------------------------- |
| `title`               | LLM                                                 |
| `description`         | LLM (one-paragraph normalized summary)              |
| `suggestedTag`        | LLM (`venture` \| `project` \| `idea` \| `todo`)    |
| `suggestedNextAction` | LLM (verb-led, <30-minute action)                   |
| `confidence`          | LLM self-report, `[0, 1]`                           |
| `sourcePointer`       | Deterministic from payload (cannot be hallucinated) |
| `rawPayloadId`        | Pass-through from `payload.id`                      |
| `servedBy`            | `claude` \| `gemini` \| `fallback-guard`            |

The LLM never produces `sourcePointer` or `rawPayloadId` — those come from the capture layer so the audit trail stays trustworthy.

## Pluggable provider

```
Normalizer
  └─ LlmNormalizer (generic)
      ├─ ClaudeNormalizer  →  LlmProvider (AnthropicProvider)
      └─ GeminiNormalizer  →  LlmProvider (GeminiProvider)

NormalizerWithFallback(primary: Normalizer, fallback: Normalizer)
```

- `LlmProvider` is the seam — the legacy MVP's multi-LLM bridge from [GSO-70](/GSO/issues/GSO-70) follows the same shape (`generate({system, prompt})`). The Next.js stack ships its own TypeScript implementation; the JS bridge in `RRR-GSO-GSCRT` is not import-compatible.
- Swapping a model = swap the `LlmProvider` passed to the Normalizer. Callers see only `Normalizer.normalize(payload)`.

## Determinism / idempotency

- `temperature` defaults to **0** on every call. Documented in `lib/intake/normalizer/llm-normalizer.ts`.
- Same payload + same model + same prompt → same model output → same `Draft`. Tested in `tests/intake/normalizer.test.ts` (`Idempotency` block).
- The `sourcePointer` is deterministic over `(kind, sorted sourceMeta keys, body bytes)`.

## Fallback behaviour

`NormalizerWithFallback`:

1. Tries the primary normalizer (Claude).
2. On `LlmTransientError` (5xx, 408, 429, timeout, network failure, schema-validation failure on **two** consecutive attempts) → tries the fallback (Gemini).
3. If the fallback also raises `LlmTransientError` → returns the hallucination-guard Draft (see below).
4. On `LlmPermanentError` (4xx — bad key, blocked content) → re-throws. No silent fallback for permanent failures; fix the config.

Each step is logged via the optional `NormalizerLogger` so operations can see which path served any given request.

## Hallucination guard

Per the GSO-125 acceptance criteria: when the model returns output that fails JSON-schema validation **twice in a row** on **both** the primary and fallback paths, the L1 pipeline must not crash. `buildHallucinationGuardDraft(payload)` returns:

- `title` = the first non-empty line of the raw body (or `Unparsed intake payload`).
- `description` = the raw body verbatim.
- `suggestedTag` = `needs_human` (a tag the Triage Inbox can badge for review).
- `suggestedNextAction` = `Review this payload manually — the L1 normalizer could not parse it.`
- `confidence` = `0`.
- `servedBy` = `fallback-guard`.

`needs_human` was added to the persisted `SuggestedTag` enum in `lib/intake/front-matter.ts` so the guard Draft is fully round-trip-able through `createDraftIssue`.

## Few-shot examples

Live in `lib/intake/normalizer/prompt.ts`. The four starter examples cover the four payload shapes named in the GSO-125 acceptance criteria (typed note, forwarded email, raw URL, screenshot caption). The file header carries a calibration note — when Remi provides 5–10 real intake samples, swap them into `FEW_SHOTS`; the surrounding prompt structure does not need to change.

## Wiring in production

```ts
import { AnthropicProvider } from '@/lib/llm/anthropic-provider';
import { GeminiProvider } from '@/lib/llm/gemini-provider';
import {
  ClaudeNormalizer,
  GeminiNormalizer,
  NormalizerWithFallback
} from '@/lib/intake/normalizer';

const claude = new ClaudeNormalizer(
  new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! })
);
const gemini = new GeminiNormalizer(new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY! }));

const normalizer = new NormalizerWithFallback(claude, gemini, {
  logger: pinoLogger // any { info, warn } shape
});

const draft = await normalizer.normalize(payload);
```

## Verification

- `npx vitest run tests/intake/normalizer.test.ts` → 17/17 green.
- `npx tsc --noEmit` → clean.
- Acceptance criteria coverage:
  - Fixture payloads (4 kinds) → fully-populated Draft ✅
  - Idempotency at `temperature=0` ✅
  - Claude 5xx routes to Gemini ✅
  - Schema-violation guard (twice → guard Draft) ✅
