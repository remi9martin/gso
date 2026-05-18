// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import {
  handleEmailIntake,
  parseAddress,
  type EmailIntakeEnvelope
} from '@/lib/intake/email-handler';
import { MemoryIntakePayloadStore } from '@/lib/intake/payload-store';
import { SlidingWindowRateLimiter } from '@/lib/intake/rate-limit';
import type { CreatedDraftIssue } from '@/lib/intake/create-draft-issue';
import type { Draft, Normalizer } from '@/lib/intake/normalizer/types';

// Integration tests for /api/intake/email. We mount handleEmailIntake with an
// in-memory payload store, a stub createDraftFn, and a static normalizer — so
// we exercise auth, SPF/DKIM/DMARC enforcement, payload validation, and the
// envelope → draft pipeline without hitting Paperclip or the real LLM.

const VALID_USER_ID = 'user-remi';
const PROJECT_ID = 'intake-project';
const RAW_TOKEN = 'email-worker-secret-123';
const BEARER_HASH = createHash('sha256').update(RAW_TOKEN).digest('hex');

interface Harness {
  payloadStore: MemoryIntakePayloadStore;
  rateLimiter: SlidingWindowRateLimiter;
  draftCalls: Array<{ rawPayloadId: string; title: string; description: string }>;
  call: (envelope: Partial<EmailIntakeEnvelope>, opts?: { token?: string }) => Promise<Response>;
}

function fixedDraft(title: string, tag: Draft['suggestedTag']): Normalizer {
  return {
    async normalize(payload) {
      return {
        title,
        description: payload.body.slice(0, 200),
        sourcePointer: `email:${payload.id}`,
        suggestedTag: tag,
        suggestedNextAction: 'Triage in the inbox.',
        rawPayloadId: payload.id,
        confidence: 0.85,
        servedBy: 'test-normalizer'
      };
    }
  };
}

function buildHarness(opts?: {
  normalizer?: Normalizer | null;
  rateLimiter?: SlidingWindowRateLimiter;
}): Harness {
  const payloadStore = new MemoryIntakePayloadStore();
  // Fresh limiter per harness so per-test buckets stay isolated. Production
  // singleton has DEFAULT_INTAKE_RATE_LIMIT; tests get the same defaults
  // unless they override (see rate-limit suite).
  const rateLimiter = opts?.rateLimiter ?? new SlidingWindowRateLimiter();
  const draftCalls: Harness['draftCalls'] = [];
  const seen = new Map<string, CreatedDraftIssue>();
  let counter = 500;
  const stubCreateDraft = async (
    input: Parameters<(typeof import('@/lib/intake/create-draft-issue'))['createDraftIssue']>[0]
  ): Promise<CreatedDraftIssue> => {
    draftCalls.push({
      rawPayloadId: input.frontMatter.rawPayloadId,
      title: input.title,
      description: input.summary
    });
    const existing = seen.get(input.frontMatter.rawPayloadId);
    if (existing) return existing;
    counter += 1;
    const result: CreatedDraftIssue = {
      id: `issue-${counter}`,
      identifier: `GSO-${counter}`,
      rawPayloadId: input.frontMatter.rawPayloadId,
      created: true
    };
    seen.set(input.frontMatter.rawPayloadId, { ...result, created: false });
    return result;
  };

  const normalizer =
    opts && 'normalizer' in opts ? opts.normalizer : fixedDraft('Email triage', 'todo');

  const call: Harness['call'] = (envelope, callOpts) => {
    const token = callOpts?.token ?? RAW_TOKEN;
    const fullEnvelope: EmailIntakeEnvelope = {
      from: 'Remi <remi@digitaltrvst.com>',
      to: ['intake@damgsolutions.com'],
      subject: 'A captured idea',
      messageId: '<msg-001@digitaltrvst.com>',
      receivedAt: '2026-05-18T10:00:00.000Z',
      text: 'Forwarded idea — build a thing.',
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
      ...envelope
    } as EmailIntakeEnvelope;
    const request = new Request('http://localhost/api/intake/email', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(fullEnvelope)
    });
    return handleEmailIntake(request, {
      payloadStore,
      bearerHash: BEARER_HASH,
      config: { projectId: PROJECT_ID, assigneeUserId: VALID_USER_ID, uiUserId: VALID_USER_ID },
      normalizer,
      rateLimiter,
      createDraftFn: stubCreateDraft,
      logger: { info: () => undefined }
    });
  };

  return { payloadStore, rateLimiter, draftCalls, call };
}

describe('POST /api/intake/email — auth', () => {
  it('rejects missing Authorization with 401', async () => {
    const payloadStore = new MemoryIntakePayloadStore();
    const request = new Request('http://localhost/api/intake/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: 'x',
        subject: 'x',
        messageId: 'x',
        receivedAt: 'x',
        text: 'x',
        auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass' }
      })
    });
    const res = await handleEmailIntake(request, {
      payloadStore,
      bearerHash: BEARER_HASH,
      config: { projectId: PROJECT_ID, assigneeUserId: VALID_USER_ID, uiUserId: VALID_USER_ID }
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('missing_authorization');
  });

  it('rejects a wrong token with 401', async () => {
    const h = buildHarness();
    const res = await h.call({}, { token: 'not-the-secret' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_authorization');
  });

  it('returns 503 when EMAIL_INTAKE_BEARER_HASH is unset', async () => {
    const payloadStore = new MemoryIntakePayloadStore();
    const request = new Request('http://localhost/api/intake/email', {
      method: 'POST',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      body: '{}'
    });
    const res = await handleEmailIntake(request, {
      payloadStore,
      bearerHash: undefined
    });
    expect(res.status).toBe(503);
  });
});

describe('POST /api/intake/email — happy path', () => {
  it('creates a draft when SPF/DKIM/DMARC all pass', async () => {
    const h = buildHarness();
    const res = await h.call({});
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.draftIssueId).toMatch(/^issue-\d+$/);
    expect(body.identifier).toMatch(/^GSO-\d+$/);
    expect(body.draftUrl).toBe(`/GSO/issues/${body.identifier}`);
    expect(body.servedBy).toBe('test-normalizer');
    expect(h.draftCalls).toHaveLength(1);
    expect(h.draftCalls[0].title).toBe('Email triage');
  });

  it('is idempotent on a repeated Message-ID + body', async () => {
    const h = buildHarness();
    const envelope = {
      subject: 'Same email twice',
      messageId: '<dupe@digitaltrvst.com>',
      text: 'Repeat this exact body so the canonical hash collides.'
    };
    const first = await h.call(envelope);
    expect(first.status).toBe(201);
    const second = await h.call(envelope);
    expect(second.status).toBe(200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.identifier).toBe(firstBody.identifier);
    expect(secondBody.payloadCreated).toBe(false);
    expect(secondBody.draftCreated).toBe(false);
    expect(h.draftCalls).toHaveLength(2);
  });

  it('passes from-domain through to the persisted source meta', async () => {
    const h = buildHarness();
    await h.call({
      from: 'Cofounder <bob@madeup-venture.com>',
      messageId: '<from-domain@x.com>',
      text: 'Venture-tagged idea.'
    });
    const records = await Promise.all(Array.from({ length: 1 }, (_, i) => h.payloadStore.findById));
    void records;
    const recordList = await listAllPayloads(h.payloadStore);
    expect(recordList).toHaveLength(1);
    const meta = recordList[0].sourceMeta as Record<string, unknown>;
    const hints = meta.hints as Record<string, unknown>;
    expect(hints.fromDomain).toBe('madeup-venture.com');
    expect(hints.fromName).toBe('Cofounder');
    expect(hints.subject).toBe('A captured idea');
  });

  it('uses GSO_INTAKE_EMAIL_USER_ID override when set', async () => {
    const original = process.env.GSO_INTAKE_EMAIL_USER_ID;
    process.env.GSO_INTAKE_EMAIL_USER_ID = 'email-specific-user';
    try {
      const h = buildHarness();
      const res = await h.call({ messageId: '<override@x.com>' });
      expect(res.status).toBe(201);
      // The override flows into source.userId; verify by inspecting the
      // persisted payload's source meta.
      const payloads = await listAllPayloads(h.payloadStore);
      const meta = payloads[0].sourceMeta as Record<string, unknown>;
      expect(meta.userId).toBe('email-specific-user');
    } finally {
      if (original === undefined) delete process.env.GSO_INTAKE_EMAIL_USER_ID;
      else process.env.GSO_INTAKE_EMAIL_USER_ID = original;
    }
  });
});

describe('POST /api/intake/email — SPF/DKIM/DMARC enforcement', () => {
  it('returns 550 when DKIM fails', async () => {
    const h = buildHarness();
    const res = await h.call({
      messageId: '<dkim-fail@x.com>',
      auth: { spf: 'pass', dkim: 'fail', dmarc: 'pass' }
    });
    expect(res.status).toBe(550);
    const body = await res.json();
    expect(body.error).toBe('email_auth_failed');
  });

  it('returns 550 when SPF fails', async () => {
    const h = buildHarness();
    const res = await h.call({
      messageId: '<spf-fail@x.com>',
      auth: { spf: 'fail', dkim: 'pass', dmarc: 'pass' }
    });
    expect(res.status).toBe(550);
  });

  it('returns 550 when DMARC fails (with SPF/DKIM neutral)', async () => {
    const h = buildHarness();
    const res = await h.call({
      messageId: '<dmarc-fail@x.com>',
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'fail' }
    });
    expect(res.status).toBe(550);
  });

  it('accepts mail with auth=none (sender publishes no SPF/DKIM)', async () => {
    const h = buildHarness();
    const res = await h.call({
      messageId: '<no-auth@x.com>',
      auth: { spf: 'none', dkim: 'none', dmarc: 'none' }
    });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/intake/email — envelope validation', () => {
  it('rejects missing required fields with 400', async () => {
    const h = buildHarness();
    const res = await h.call({ subject: '' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_envelope');
  });

  it('rejects an envelope with neither text nor html body', async () => {
    const h = buildHarness();
    const res = await h.call({ messageId: '<empty@x.com>', text: '', html: '' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('empty_body');
  });

  it('rejects bodies larger than 2MB with 413', async () => {
    const h = buildHarness();
    const huge = 'a'.repeat(2_000_001);
    const res = await h.call({ messageId: '<huge@x.com>', text: huge });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe('body_too_large');
  });

  it('rejects an attachment larger than 10MB with 413', async () => {
    const h = buildHarness();
    const big = Buffer.alloc(10_000_001, 0x61).toString('base64');
    const res = await h.call({
      messageId: '<big-att@x.com>',
      attachments: [
        { filename: 'big.bin', mimeType: 'application/octet-stream', contentBase64: big }
      ]
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe('attachment_too_large');
  });

  it('rejects an executable attachment with 415', async () => {
    const h = buildHarness();
    const exeBytes = Buffer.from([0x4d, 0x5a, 0x00]).toString('base64');
    const res = await h.call({
      messageId: '<exe@x.com>',
      attachments: [
        { filename: 'evil.exe', mimeType: 'application/x-msdownload', contentBase64: exeBytes }
      ]
    });
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toBe('attachment_denied_mime');
  });

  it('returns 415 when Content-Type is not JSON', async () => {
    const payloadStore = new MemoryIntakePayloadStore();
    const request = new Request('http://localhost/api/intake/email', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${RAW_TOKEN}`,
        'content-type': 'text/plain'
      },
      body: 'not-json'
    });
    const res = await handleEmailIntake(request, {
      payloadStore,
      bearerHash: BEARER_HASH,
      config: { projectId: PROJECT_ID, assigneeUserId: VALID_USER_ID, uiUserId: VALID_USER_ID }
    });
    expect(res.status).toBe(415);
  });

  it('returns 400 on malformed JSON', async () => {
    const payloadStore = new MemoryIntakePayloadStore();
    const request = new Request('http://localhost/api/intake/email', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${RAW_TOKEN}`,
        'content-type': 'application/json'
      },
      body: '{not-json'
    });
    const res = await handleEmailIntake(request, {
      payloadStore,
      bearerHash: BEARER_HASH,
      config: { projectId: PROJECT_ID, assigneeUserId: VALID_USER_ID, uiUserId: VALID_USER_ID }
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
  });
});

describe('POST /api/intake/email — normalizer fallback', () => {
  it('still produces a triagable draft when no normalizer is configured', async () => {
    const h = buildHarness({ normalizer: null });
    const res = await h.call({
      messageId: '<no-normalizer@x.com>',
      subject: 'No normalizer wired'
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.servedBy).toBe('stub-no-normalizer');
  });
});

describe('POST /api/intake/email — rate limiting', () => {
  it('returns 429 with Retry-After once the bucket is exhausted', async () => {
    // 2/min so we don't need 10 envelope round-trips per test.
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 2 });
    const h = buildHarness({ rateLimiter: limiter });

    const first = await h.call({ messageId: '<rl-1@x.com>', text: 'first' });
    const second = await h.call({ messageId: '<rl-2@x.com>', text: 'second' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const blocked = await h.call({ messageId: '<rl-3@x.com>', text: 'third' });
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toBe('rate_limited');
    expect(blocked.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(blocked.headers.get('X-RateLimit-Limit')).toMatch(/^\d+$/);
    expect(blocked.headers.get('X-RateLimit-Reset')).toMatch(/^\d+$/);
  });

  it('rate-limits a flood of wrong-token requests too (limiter runs before auth)', async () => {
    // The single static "email-worker" bucket catches both authenticated
    // floods (leaked token) and unauth probing. We don't want an attacker to
    // burn unbounded payload-store work just because they have a token, nor
    // do we want bearer-brute-force to skip the cap.
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 1 });
    const h = buildHarness({ rateLimiter: limiter });

    const wrong = await h.call({ messageId: '<rl-bad-1@x.com>' }, { token: 'not-the-secret' });
    expect(wrong.status).toBe(401); // first request: limiter passes, auth fails

    const blocked = await h.call({ messageId: '<rl-bad-2@x.com>' }, { token: 'not-the-secret' });
    expect(blocked.status).toBe(429); // second request: limiter trips
  });
});

describe('parseAddress', () => {
  it('parses Display Name <addr@domain>', () => {
    expect(parseAddress('Remi <remi@digitaltrvst.com>')).toEqual({
      address: 'remi@digitaltrvst.com',
      domain: 'digitaltrvst.com',
      name: 'Remi'
    });
  });

  it('parses quoted "Display Name" <addr@domain>', () => {
    expect(parseAddress('"Remi M" <remi@digitaltrvst.com>')).toEqual({
      address: 'remi@digitaltrvst.com',
      domain: 'digitaltrvst.com',
      name: 'Remi M'
    });
  });

  it('parses a bare addr@domain', () => {
    expect(parseAddress('remi@digitaltrvst.com')).toEqual({
      address: 'remi@digitaltrvst.com',
      domain: 'digitaltrvst.com',
      name: null
    });
  });
});

async function listAllPayloads(
  store: MemoryIntakePayloadStore
): Promise<Array<{ id: string; sourceMeta: Record<string, unknown> }>> {
  return store.entriesForTest().map((r) => ({ id: r.id, sourceMeta: r.sourceMeta }));
}
