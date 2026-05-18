import { describe, expect, it } from 'vitest';

import { checkRefreshAuth } from '@/lib/canvas/refresh-auth';

describe('checkRefreshAuth', () => {
  it('rejects when the token is not configured', () => {
    const res = checkRefreshAuth(new Headers({ Authorization: 'Bearer hunter2' }), '');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(503);
  });

  it('rejects requests with no Authorization header', () => {
    const res = checkRefreshAuth(new Headers(), 'sekret');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });

  it('accepts a matching Bearer token', () => {
    const res = checkRefreshAuth(new Headers({ Authorization: 'Bearer sekret' }), 'sekret');
    expect(res.ok).toBe(true);
  });

  it('rejects a mismatched token', () => {
    const res = checkRefreshAuth(new Headers({ Authorization: 'Bearer nope' }), 'sekret');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });

  it('accepts a bare token (no Bearer prefix)', () => {
    const res = checkRefreshAuth(new Headers({ Authorization: 'sekret' }), 'sekret');
    expect(res.ok).toBe(true);
  });
});
