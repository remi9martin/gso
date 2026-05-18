import { describe, expect, it, vi } from 'vitest';

import { handleMemoryRead, handleMemoryWrite } from '@/lib/memory-mcp/tools';
import type { UpstreamConfig } from '@/lib/memory-mcp/upstream';

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function makeConfig(fetchImpl: FetchMock): UpstreamConfig {
  return {
    url: 'https://example.test/gso/memory/api.php',
    readToken: 'r',
    syncToken: 's',
    fetchImpl: fetchImpl as unknown as typeof fetch
  };
}

describe('handleMemoryRead', () => {
  it('refuses unsafe paths before calling upstream', async () => {
    const fetchMock: FetchMock = vi.fn();
    const res = await handleMemoryRead(makeConfig(fetchMock), {
      path: '../escape.md'
    });
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns upstream data on success', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ status: 'ok', path: 'a.md', tier: 'tier3', content: 'hi', sha256: 'x' }),
          { status: 200 }
        )
    );
    const res = await handleMemoryRead(makeConfig(fetchMock), { path: 'a.md' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toMatchObject({ content: 'hi' });
  });

  it('reports upstream errors', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'error', message: 'Not in manifest' }), {
          status: 404
        })
    );
    const res = await handleMemoryRead(makeConfig(fetchMock), { path: 'a.md' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('404');
  });
});

describe('handleMemoryWrite', () => {
  it('rejects non-string content', async () => {
    const fetchMock: FetchMock = vi.fn();
    const res = await handleMemoryWrite(makeConfig(fetchMock), {
      path: 'a.md',
      content: 123
    });
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects non-tier3 writes', async () => {
    const fetchMock: FetchMock = vi.fn();
    const res = await handleMemoryWrite(makeConfig(fetchMock), {
      path: 'a.md',
      content: 'x',
      tier: 'tier2'
    });
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('round-trips a write/read pair against a faked upstream', async () => {
    const store = new Map<string, string>();
    const fetchMock: FetchMock = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        store.set(body.path, body.content);
        return new Response(JSON.stringify({ status: 'ok', path: body.path, sha256: 'sha' }), {
          status: 200
        });
      }
      const path = url.searchParams.get('path')!;
      if (!store.has(path)) {
        return new Response(JSON.stringify({ status: 'error', message: 'Not in manifest' }), {
          status: 404
        });
      }
      return new Response(
        JSON.stringify({
          status: 'ok',
          path,
          tier: 'tier3',
          content: store.get(path),
          sha256: 'sha'
        }),
        { status: 200 }
      );
    });
    const config = makeConfig(fetchMock);

    const w = await handleMemoryWrite(config, { path: 'shared/note.md', content: 'hello' });
    expect(w.ok).toBe(true);

    const r = await handleMemoryRead(config, { path: 'shared/note.md' });
    expect(r.ok).toBe(true);
    if (r.ok && 'content' in r.data) expect(r.data.content).toBe('hello');
  });
});
