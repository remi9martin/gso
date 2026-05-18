import 'server-only';

import {
  LlmPermanentError,
  LlmTransientError,
  type LlmGenerateRequest,
  type LlmGenerateResponse,
  type LlmProvider
} from './types';

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
  defaultMaxOutputTokens?: number;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TOKENS = 1024;

export class AnthropicProvider implements LlmProvider {
  readonly name = 'claude' as const;

  constructor(private readonly opts: AnthropicProviderOptions) {
    if (!opts.apiKey) {
      throw new Error('AnthropicProvider requires apiKey');
    }
  }

  async generate(req: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const url = this.opts.apiUrl ?? DEFAULT_URL;
    const model = this.opts.model ?? DEFAULT_MODEL;
    const timeoutMs = req.timeoutMs ?? this.opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxTokens = req.maxOutputTokens ?? this.opts.defaultMaxOutputTokens ?? DEFAULT_MAX_TOKENS;

    const body = {
      model,
      max_tokens: maxTokens,
      temperature: req.temperature ?? 0,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }]
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.opts.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      throw new LlmTransientError(`Anthropic request failed: ${(err as Error).message}`, err);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const trimmed = text.slice(0, 200);
      if (res.status >= 500 || res.status === 408 || res.status === 429) {
        throw new LlmTransientError(`Anthropic ${res.status}: ${trimmed}`, undefined, res.status);
      }
      throw new LlmPermanentError(`Anthropic ${res.status}: ${trimmed}`, res.status);
    }

    const payload = (await res.json().catch(() => ({}))) as {
      content?: Array<{ type?: string; text?: string }>;
      model?: string;
    };
    const text = (payload.content ?? [])
      .filter((p) => p?.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    if (!text) {
      throw new LlmTransientError('Anthropic returned empty text content');
    }
    return { text, model: payload.model ?? model };
  }
}
