import { describe, expect, it } from 'vitest';

import { checkMemoryMcpAuth } from '@/lib/memory-mcp/auth';

describe('checkMemoryMcpAuth', () => {
  it('rejects when MEMORY_MCP_BEARER_TOKEN is unset', () => {
    const res = checkMemoryMcpAuth(new Headers({ Authorization: 'Bearer foo' }), '');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(503);
  });

  it('rejects requests with no Authorization header', () => {
    const res = checkMemoryMcpAuth(new Headers(), 'sekret');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });

  it('rejects an empty Bearer token', () => {
    const res = checkMemoryMcpAuth(new Headers({ Authorization: 'Bearer ' }), 'sekret');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });

  it('accepts a matching Bearer token', () => {
    const res = checkMemoryMcpAuth(new Headers({ Authorization: 'Bearer sekret' }), 'sekret');
    expect(res.ok).toBe(true);
  });

  it('accepts a bare token (no Bearer prefix)', () => {
    const res = checkMemoryMcpAuth(new Headers({ Authorization: 'sekret' }), 'sekret');
    expect(res.ok).toBe(true);
  });

  it('rejects a mismatched token', () => {
    const res = checkMemoryMcpAuth(new Headers({ Authorization: 'Bearer nope' }), 'sekret');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });
});
