export const DEFAULT_UPSTREAM_URL = 'https://damgsolutions.com/gso/memory/api.php';

export interface UpstreamConfig {
  url: string;
  readToken: string;
  syncToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface UpstreamReadResult {
  path: string;
  tier: string;
  content: string;
  sha256: string;
}

export interface UpstreamWriteResult {
  path: string;
  sha256: string;
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    public status: number,
    public upstreamStatus: number | null = null
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export function readUpstreamConfigFromEnv(env: NodeJS.ProcessEnv = process.env): UpstreamConfig {
  const url = env.GSO_MEMORY_API_URL?.trim() || DEFAULT_UPSTREAM_URL;
  const readToken = env.GSO_MEMORY_READ_TOKEN?.trim() ?? '';
  const syncToken = env.GSO_MEMORY_SYNC_TOKEN?.trim() ?? '';
  if (!readToken || !syncToken) {
    throw new UpstreamError(
      'GSO_MEMORY_READ_TOKEN and GSO_MEMORY_SYNC_TOKEN must both be configured',
      503
    );
  }
  return { url, readToken, syncToken };
}

async function callUpstream(
  config: UpstreamConfig,
  init: RequestInit,
  searchParams?: Record<string, string>
): Promise<unknown> {
  const fetchFn = config.fetchImpl ?? fetch;
  const target = new URL(config.url);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      target.searchParams.set(key, value);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);

  let res: Response;
  try {
    res = await fetchFn(target.toString(), { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new UpstreamError('Upstream request timed out', 504);
    }
    throw new UpstreamError(`Upstream fetch failed: ${(err as Error).message}`, 502);
  } finally {
    clearTimeout(timeout);
  }

  const text = await res.text();
  let parsed: { status?: string; message?: string; [key: string]: unknown } = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new UpstreamError(
      `Upstream returned non-JSON response (HTTP ${res.status})`,
      502,
      res.status
    );
  }

  if (!res.ok || parsed.status !== 'ok') {
    const message = typeof parsed.message === 'string' ? parsed.message : `HTTP ${res.status}`;
    throw new UpstreamError(message, res.status >= 400 ? res.status : 502, res.status);
  }
  return parsed;
}

export async function upstreamRead(
  config: UpstreamConfig,
  path: string
): Promise<UpstreamReadResult> {
  const data = (await callUpstream(
    config,
    {
      method: 'GET',
      headers: { 'X-GSO-Memory-Read': config.readToken }
    },
    { action: 'read', path }
  )) as Record<string, unknown>;
  return {
    path: String(data.path ?? path),
    tier: String(data.tier ?? 'tier3'),
    content: String(data.content ?? ''),
    sha256: String(data.sha256 ?? '')
  };
}

export async function upstreamWrite(
  config: UpstreamConfig,
  path: string,
  content: string,
  tier: 'tier3' | 'tier2' = 'tier3'
): Promise<UpstreamWriteResult> {
  const data = (await callUpstream(config, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GSO-Memory-Sync': config.syncToken
    },
    body: JSON.stringify({ action: 'put', path, content, tier })
  })) as Record<string, unknown>;
  return {
    path: String(data.path ?? path),
    sha256: String(data.sha256 ?? '')
  };
}
