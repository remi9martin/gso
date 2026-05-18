import { describe, expect, it, vi } from 'vitest';

import {
  readUpstreamConfigFromEnv,
  upstreamRead,
  upstreamWrite,
  UpstreamError,
  type UpstreamConfig
} from '@/lib/memory-mcp/upstream';

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function makeConfig(fetchImpl: FetchMock): UpstreamConfig {
  return {
    url: 'https://example.test/gso/memory/api.php',
    readToken: 'read-tok',
    syncToken: 'sync-tok',
    fetchImpl: fetchImpl as unknown as typeof fetch
  };
}

describe('readUpstreamConfigFromEnv', () => {
  it('throws if read/sync tokens are missing', () => {
    expect(() => readUpstreamConfigFromEnv({} as unknown as NodeJS.ProcessEnv)).toThrow(
      UpstreamError
    );
  });

  it('uses the default URL when GSO_MEMORY_API_URL is unset', () => {
    const config = readUpstreamConfigFromEnv({
      GSO_MEMORY_READ_TOKEN: 'r',
      GSO_MEMORY_SYNC_TOKEN: 's'
    } as unknown as NodeJS.ProcessEnv);
    expect(config.url).toBe('https://damgsolutions.com/gso/memory/api.php');
    expect(config.readToken).toBe('r');
    expect(config.syncToken).toBe('s');
  });
});

describe('upstreamRead', () => {
  it('calls api.php with action=read and the read token, parses content', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'ok',
            path: 'identity/who-is-remi.md',
            tier: 'tier3',
            content: 'hi',
            sha256: 'abc'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );
    const config = makeConfig(fetchMock);

    const out = await upstreamRead(config, 'identity/who-is-remi.md');

    expect(out).toEqual({
      path: 'identity/who-is-remi.md',
      tier: 'tier3',
      content: 'hi',
      sha256: 'abc'
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call;
    expect(String(url)).toContain('action=read');
    expect(String(url)).toContain('path=identity%2Fwho-is-remi.md');
    expect((init?.headers as Record<string, string>)['X-GSO-Memory-Read']).toBe('read-tok');
    expect(init?.method).toBe('GET');
  });

  it('translates a 404 from api.php into UpstreamError(404)', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'error', message: 'Not in manifest' }), {
          status: 404
        })
    );
    const config = makeConfig(fetchMock);
    await expect(upstreamRead(config, 'missing.md')).rejects.toMatchObject({
      name: 'UpstreamError',
      status: 404
    });
  });

  it('treats non-JSON upstream responses as a 502', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () => new Response('<html>nope</html>', { status: 200 })
    );
    const config = makeConfig(fetchMock);
    await expect(upstreamRead(config, 'a.md')).rejects.toMatchObject({ status: 502 });
  });
});

describe('upstreamWrite', () => {
  it('posts JSON with action=put, sync token, and tier3', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'ok', path: 'shared/note.md', sha256: 'sha' }), {
          status: 200
        })
    );
    const config = makeConfig(fetchMock);

    const out = await upstreamWrite(config, 'shared/note.md', 'hello world');

    expect(out).toEqual({ path: 'shared/note.md', sha256: 'sha' });
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [, init] = call;
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['X-GSO-Memory-Sync']).toBe('sync-tok');
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      action: 'put',
      path: 'shared/note.md',
      content: 'hello world',
      tier: 'tier3'
    });
  });

  it('translates a 401 from api.php into UpstreamError(401)', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'error', message: 'Bad sync token' }), {
          status: 401
        })
    );
    const config = makeConfig(fetchMock);
    await expect(upstreamWrite(config, 'a.md', 'x')).rejects.toMatchObject({ status: 401 });
  });
});
