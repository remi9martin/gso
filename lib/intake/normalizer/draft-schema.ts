import { z } from 'zod';

/** Subset of the Draft that the LLM is responsible for producing. */
export const LlmDraftSchema = z
  .object({
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(2000),
    suggestedTag: z.enum(['venture', 'project', 'idea', 'todo']),
    suggestedNextAction: z.string().min(1).max(280),
    confidence: z.number().min(0).max(1)
  })
  .strict();

export type LlmDraft = z.infer<typeof LlmDraftSchema>;

export class DraftSchemaError extends Error {
  constructor(
    message: string,
    public readonly rawText: string,
    public readonly attempt: number
  ) {
    super(message);
    this.name = 'DraftSchemaError';
  }
}

/**
 * Parses the LLM response text into an LlmDraft. The LLM is asked to return a
 * single JSON object; we tolerate fenced code blocks and leading prose by
 * extracting the first `{...}` block before parsing.
 */
export function parseLlmDraft(text: string, attempt: number): LlmDraft {
  const json = extractJsonObject(text);
  if (!json) {
    throw new DraftSchemaError('No JSON object found in model output', text, attempt);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new DraftSchemaError(
      `Model output is not valid JSON: ${(err as Error).message}`,
      text,
      attempt
    );
  }
  const result = LlmDraftSchema.safeParse(parsed);
  if (!result.success) {
    throw new DraftSchemaError(
      `Model output failed Draft schema: ${result.error.message}`,
      text,
      attempt
    );
  }
  return result.data;
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const end = findMatchingBrace(trimmed);
    if (end !== -1) return trimmed.slice(0, end + 1);
  }
  const start = trimmed.indexOf('{');
  if (start === -1) return null;
  const end = findMatchingBrace(trimmed.slice(start));
  if (end === -1) return null;
  return trimmed.slice(start, start + end + 1);
}

function findMatchingBrace(s: string): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
