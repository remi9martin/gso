import 'server-only';

import { readPaperclipEnv, type PaperclipEnv } from './env';
import type { PaperclipAgent, PaperclipIssue } from './types';

export class PaperclipApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    public readonly bodyText: string
  ) {
    super(`Paperclip ${endpoint} returned ${status}: ${bodyText.slice(0, 200)}`);
    this.name = 'PaperclipApiError';
  }
}

export interface PaperclipClient {
  listAgents(): Promise<PaperclipAgent[]>;
  listOpenIssues(): Promise<PaperclipIssue[]>;
}

const OPEN_ISSUE_STATUSES = 'todo,in_progress,in_review,blocked';

export interface PaperclipClientOptions {
  env?: PaperclipEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createPaperclipClient(options: PaperclipClientOptions = {}): PaperclipClient {
  const env = options.env ?? readPaperclipEnv();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;

  async function request<T>(path: string): Promise<T> {
    const url = `${env.apiUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${env.apiKey}`,
          Accept: 'application/json'
        },
        signal: controller.signal,
        cache: 'no-store'
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new PaperclipApiError(res.status, path, text);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    listAgents() {
      return request<PaperclipAgent[]>(`/api/companies/${env.companyId}/agents`);
    },
    listOpenIssues() {
      const qs = `status=${OPEN_ISSUE_STATUSES}`;
      return request<PaperclipIssue[]>(`/api/companies/${env.companyId}/issues?${qs}`);
    }
  };
}
