import 'server-only';

import {
  LlmPermanentError,
  LlmTransientError,
  type LlmGenerateRequest,
  type LlmGenerateResponse,
  type LlmProvider
} from './types';

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
  defaultMaxOutputTokens?: number;
}

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TOKENS = 1024;

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini' as const;

  constructor(private readonly opts: GeminiProviderOptions) {
    if (!opts.apiKey) {
      throw new Error('GeminiProvider requires apiKey');
    }
  }

  async generate(req: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const model = this.opts.model ?? DEFAULT_MODEL;
    const base = this.opts.apiUrl ?? DEFAULT_API_BASE;
    const url = `${base}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.opts.apiKey)}`;
    const timeoutMs = req.timeoutMs ?? this.opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxTokens = req.maxOutputTokens ?? this.opts.defaultMaxOutputTokens ?? DEFAULT_MAX_TOKENS;

    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: req.temperature ?? 0,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json'
      }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      throw new LlmTransientError(`Gemini request failed: ${(err as Error).message}`, err);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const trimmed = text.slice(0, 200);
      if (res.status >= 500 || res.status === 408 || res.status === 429) {
        throw new LlmTransientError(`Gemini ${res.status}: ${trimmed}`, undefined, res.status);
      }
      throw new LlmPermanentError(`Gemini ${res.status}: ${trimmed}`, res.status);
    }

    const payload = (await res.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      modelVersion?: string;
    };
    const text = (payload.candidates ?? [])
      .flatMap((c) => c.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');
    if (!text) {
      throw new LlmTransientError('Gemini returned empty text content');
    }
    return { text, model: payload.modelVersion ?? model };
  }
}
