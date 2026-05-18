// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

import { handleIntakeRequest } from '@/lib/intake/handler';
import { MemoryApiTokenStore } from '@/lib/intake/api-token-store-memory';
import { generateToken, type ApiTokenRecord } from '@/lib/intake/api-tokens';
import { MemoryIntakePayloadStore } from '@/lib/intake/payload-store';
import { SlidingWindowRateLimiter } from '@/lib/intake/rate-limit';
import { MAX_ATTACHMENT_BYTES } from '@/lib/intake/security';
import type { CreatedDraftIssue } from '@/lib/intake/create-draft-issue';

// Integration tests for the /api/intake handler. We mount the pure
// handleIntakeRequest function with in-memory stores and a stub
// createDraftIssue — so the tests exercise the auth, rate-limit, parsing,
// hashing, and idempotency wiring without hitting Paperclip's network API.

const VALID_USER_ID = 'user-remi';
const PROJECT_ID = 'intake-project';

interface Harness {
  payloadStore: MemoryIntakePayloadStore;
  tokenStore: MemoryApiTokenStore;
  rawToken: string;
  rateLimiter: SlidingWindowRateLimiter;
  draftCalls: Array<{ rawPayloadId: string; title: string }>;
  callHandler: (request: Request) => Promise<Response>;
}

async function buildHarness(): Promise<Harness> {
  const payloadStore = new MemoryIntakePayloadStore();
  const tokenStore = new MemoryApiTokenStore();
  const rateLimiter = new SlidingWindowRateLimiter();

  const { rawToken, tokenHash } = generateToken();
  const record: ApiTokenRecord = {
    id: randomUUID(),
    userId: VALID_USER_ID,
    label: 'test-token',
    tokenHash,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null
  };
  await tokenStore.insert(record);

  const draftCalls: Array<{ rawPayloadId: string; title: string }> = [];
  const seenPayloadIds = new Map<string, CreatedDraftIssue>();
  let counter = 200;
  const stubCreateDraft = async (
    input: Parameters<(typeof import('@/lib/intake/create-draft-issue'))['createDraftIssue']>[0]
  ) => {
    draftCalls.push({ rawPayloadId: input.frontMatter.rawPayloadId, title: input.title });
    const existing = seenPayloadIds.get(input.frontMatter.rawPayloadId);
    if (existing) return existing;
    counter += 1;
    const result: CreatedDraftIssue = {
      id: `issue-${counter}`,
      identifier: `GSO-${counter}`,
      rawPayloadId: input.frontMatter.rawPayloadId,
      created: true
    };
    seenPayloadIds.set(input.frontMatter.rawPayloadId, { ...result, created: false });
    return result;
  };

  const callHandler = (request: Request) =>
    handleIntakeRequest(request, {
      payloadStore,
      tokenStore,
      config: { projectId: PROJECT_ID, assigneeUserId: VALID_USER_ID, uiUserId: VALID_USER_ID },
      rateLimiter,
      createDraftFn: stubCreateDraft,
      logger: { info: () => undefined }
    });

  return { payloadStore, tokenStore, rawToken, rateLimiter, draftCalls, callHandler };
}

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/intake', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

describe('POST /api/intake — auth', () => {
  it('rejects missing Authorization header with 401', async () => {
    const h = await buildHarness();
    const res = await h.callHandler(jsonRequest({ body: 'hello' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('missing_authorization');
  });

  it('rejects malformed bearer token with 401', async () => {
    const h = await buildHarness();
    const res = await h.callHandler(
      jsonRequest({ body: 'hi' }, { authorization: 'Bearer not-a-real-token' })
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_authorization');
  });

  it('rejects unknown but well-formed token with 401', async () => {
    const h = await buildHarness();
    const { rawToken } = generateToken(); // never inserted into the store
    const res = await h.callHandler(
      jsonRequest({ body: 'hi' }, { authorization: `Bearer ${rawToken}` })
    );
    expect(res.status).toBe(401);
  });

  it('rejects revoked token with 401', async () => {
    const h = await buildHarness();
    const tokens = await h.tokenStore.listActiveForUser(VALID_USER_ID);
    await h.tokenStore.revoke(tokens[0].id);
    const res = await h.callHandler(
      jsonRequest({ body: 'hi' }, { authorization: `Bearer ${h.rawToken}` })
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('token_revoked');
  });

  it('accepts a valid token and returns the draft id', async () => {
    const h = await buildHarness();
    const res = await h.callHandler(
      jsonRequest(
        { body: 'A free-form paragraph for triage.' },
        {
          authorization: `Bearer ${h.rawToken}`
        }
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.draftIssueId).toMatch(/^issue-\d+$/);
    expect(body.identifier).toMatch(/^GSO-\d+$/);
    expect(body.rawPayloadId).toBeTypeOf('string');
    expect(body.draftUrl).toBe(`/GSO/issues/${body.identifier}`);
  });
});

describe('POST /api/intake — idempotency', () => {
  it('a second call with the same body returns the same draft without re-creating', async () => {
    const h = await buildHarness();
    const text = 'Same canonical bytes for a retry.';
    const first = await h.callHandler(
      jsonRequest({ body: text }, { authorization: `Bearer ${h.rawToken}` })
    );
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await h.callHandler(
      jsonRequest({ body: text }, { authorization: `Bearer ${h.rawToken}` })
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.identifier).toBe(firstBody.identifier);
    expect(secondBody.rawPayloadId).toBe(firstBody.rawPayloadId);
    expect(secondBody.payloadCreated).toBe(false);
    expect(secondBody.draftCreated).toBe(false);
  });
});

describe('POST /api/intake — rate limit', () => {
  it('returns 429 with Retry-After after 10 successful requests in a minute', async () => {
    const h = await buildHarness();
    for (let i = 0; i < 10; i++) {
      const res = await h.callHandler(
        jsonRequest({ body: `unique body ${i}` }, { authorization: `Bearer ${h.rawToken}` })
      );
      expect(res.status).toBe(201);
    }
    const limited = await h.callHandler(
      jsonRequest({ body: 'one more for luck' }, { authorization: `Bearer ${h.rawToken}` })
    );
    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body.error).toBe('rate_limited');
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(limited.headers.get('X-RateLimit-Limit')).toBe('10');
  });
});

describe('POST /api/intake — payload guards', () => {
  it('rejects unsupported Content-Type with 415', async () => {
    const h = await buildHarness();
    const req = new Request('http://localhost/api/intake', {
      method: 'POST',
      headers: { authorization: `Bearer ${h.rawToken}`, 'content-type': 'application/xml' },
      body: '<x>hi</x>'
    });
    const res = await h.callHandler(req);
    expect(res.status).toBe(415);
  });

  it('rejects empty body with 400', async () => {
    const h = await buildHarness();
    const res = await h.callHandler(
      jsonRequest({ body: '' }, { authorization: `Bearer ${h.rawToken}` })
    );
    expect(res.status).toBe(400);
  });

  it('rejects unknown kind with 400', async () => {
    const h = await buildHarness();
    const res = await h.callHandler(
      jsonRequest(
        { body: 'hi', kind: 'something-weird' },
        { authorization: `Bearer ${h.rawToken}` }
      )
    );
    expect(res.status).toBe(400);
  });

  it('rejects oversize attachment with 413', async () => {
    const h = await buildHarness();
    const oversize = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x61);
    const form = new FormData();
    form.set('body', 'with big attachment');
    form.append(
      'attachment',
      new File([new Uint8Array(oversize)], 'big.bin', { type: 'application/octet-stream' })
    );
    const req = new Request('http://localhost/api/intake', {
      method: 'POST',
      headers: { authorization: `Bearer ${h.rawToken}` },
      body: form
    });
    const res = await h.callHandler(req);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe('attachment_too_large');
  });

  it('rejects executable MIME with 415', async () => {
    const h = await buildHarness();
    const form = new FormData();
    form.set('body', 'with exe');
    form.append(
      'attachment',
      new File([new Uint8Array([0x4d, 0x5a])], 'evil.exe', { type: 'application/x-msdownload' })
    );
    const req = new Request('http://localhost/api/intake', {
      method: 'POST',
      headers: { authorization: `Bearer ${h.rawToken}` },
      body: form
    });
    const res = await h.callHandler(req);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toBe('attachment_denied_mime');
  });

  it('rejects an attachment by extension even with a benign MIME', async () => {
    const h = await buildHarness();
    const form = new FormData();
    form.set('body', 'sneaky extension');
    form.append(
      'attachment',
      new File([new Uint8Array([0x00])], 'payload.sh', { type: 'application/octet-stream' })
    );
    const req = new Request('http://localhost/api/intake', {
      method: 'POST',
      headers: { authorization: `Bearer ${h.rawToken}` },
      body: form
    });
    const res = await h.callHandler(req);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toBe('attachment_denied_extension');
  });
});

describe('POST /api/intake — audit trail', () => {
  it('does not leak the raw body into the log shape descriptor', async () => {
    const harness = await buildHarness();
    const secret = 'top-secret-string-that-must-not-leak-into-logs';
    const captured: Array<{ msg: string; meta: Record<string, unknown> }> = [];
    const logger = {
      info(msg: string, meta: Record<string, unknown>) {
        captured.push({ msg, meta });
      }
    };
    const customHandler = (request: Request) =>
      handleIntakeRequest(request, {
        payloadStore: harness.payloadStore,
        tokenStore: harness.tokenStore,
        config: { projectId: PROJECT_ID, assigneeUserId: VALID_USER_ID, uiUserId: VALID_USER_ID },
        rateLimiter: harness.rateLimiter,
        createDraftFn: async (input) => ({
          id: 'issue-x',
          identifier: 'GSO-X',
          rawPayloadId: input.frontMatter.rawPayloadId,
          created: true
        }),
        logger
      });
    const res = await customHandler(
      jsonRequest({ body: secret }, { authorization: `Bearer ${harness.rawToken}` })
    );
    expect(res.status).toBe(201);
    expect(captured.length).toBe(1);
    const serialized = JSON.stringify(captured[0]);
    expect(serialized).not.toContain(secret);
    expect(captured[0].meta.bodyShape).toMatch(/text\(len=\d+,lines=\d+\)/);
  });
});

describe('POST /api/intake — happy path latency', () => {
  beforeEach(() => undefined);

  it('completes well under 5s in the in-memory test path', async () => {
    const h = await buildHarness();
    const start = Date.now();
    const res = await h.callHandler(
      jsonRequest({ body: 'fast capture' }, { authorization: `Bearer ${h.rawToken}` })
    );
    const elapsed = Date.now() - start;
    expect(res.status).toBe(201);
    expect(elapsed).toBeLessThan(5_000);
  });
});
