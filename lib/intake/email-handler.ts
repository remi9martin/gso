import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

import { readIntakeConfig, IntakeConfigError } from './config';
import { processIntake, type IntakeAttachmentRef } from './intake-service';
import type { Normalizer } from './normalizer/types';
import type { IntakePayloadStore } from './payload-store';
import {
  DEFAULT_INTAKE_RATE_LIMIT,
  EMAIL_INTAKE_BUCKET_KEY,
  getEmailIntakeRateLimiter,
  type SlidingWindowRateLimiter
} from './rate-limit';
import { checkAttachment, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from './security';

// /api/intake/email — Cloudflare Email Worker → Paperclip Draft pipeline.
//
// The worker performs MIME parsing + SPF/DKIM/DMARC validation in the email()
// event handler and forwards a normalized JSON envelope here. This endpoint
// validates the envelope, persists via processIntake, and returns the draft id.
//
// Auth: bearer token presented by the worker (stored in Cloudflare secrets).
// We compare against EMAIL_INTAKE_BEARER_HASH (sha256 of the raw token).
//
// Anti-forgery: the worker is expected to enforce SPF/DKIM/DMARC and reject
// failing mail before the webhook fires. The webhook double-checks
// `auth.dkim`/`spf`/`dmarc` and returns 5xx for failures so the sending MTA
// gives up cleanly (and so a worker-bypass attacker still hits a gate).

export const EMAIL_INTAKE_MAX_BODY_BYTES = 2_000_000; // 2 MB plaintext+html combined
export const EMAIL_INTAKE_MAX_TOTAL_BYTES = 25_000_000; // 25 MB envelope cap

export interface EmailIntakeEnvelope {
  /** RFC 822 From: header value as a single string. */
  from: string;
  /** Optional list of To: addresses; first is preferred for sourceMeta. */
  to?: string[];
  subject: string;
  /** RFC 822 Message-ID — drives idempotency at the envelope layer. */
  messageId: string;
  /** ISO-8601 instant the worker received the message. */
  receivedAt: string;
  /** Plain-text body. Empty string when the message was html-only. */
  text: string;
  /** Optional html body — preserved on the payload but not parsed. */
  html?: string;
  /** Worker-asserted authentication results. */
  auth: EmailAuthResults;
  attachments?: EmailAttachmentInput[];
}

export interface EmailAuthResults {
  spf: 'pass' | 'fail' | 'neutral' | 'softfail' | 'temperror' | 'permerror' | 'none';
  dkim: 'pass' | 'fail' | 'neutral' | 'temperror' | 'permerror' | 'none';
  dmarc: 'pass' | 'fail' | 'temperror' | 'permerror' | 'none';
}

export interface EmailAttachmentInput {
  filename: string;
  mimeType: string;
  /** Raw bytes as base64. */
  contentBase64: string;
}

export interface EmailIntakeHandlerDeps {
  payloadStore: IntakePayloadStore;
  normalizer?: Normalizer | null;
  config?: ReturnType<typeof readIntakeConfig>;
  /** Sha256 hex of the bearer token shared with the worker. */
  bearerHash?: string;
  rateLimiter?: SlidingWindowRateLimiter;
  createDraftFn?: Parameters<typeof processIntake>[1]['createDraftFn'];
  logger?: Parameters<typeof processIntake>[1]['logger'];
}

export async function handleEmailIntake(
  request: Request,
  deps: EmailIntakeHandlerDeps
): Promise<Response> {
  const bearerHash = deps.bearerHash ?? process.env.EMAIL_INTAKE_BEARER_HASH;
  if (!bearerHash) {
    return jsonResponse(503, {
      error: 'email_intake_not_configured',
      message: 'EMAIL_INTAKE_BEARER_HASH is not set. See .env.example.'
    });
  }

  // Rate-limit before bearer auth: the single worker token is the only
  // legitimate caller, so a per-key segmentation would be cosmetic. Capping at
  // the route entrance means brute-force/token-leak floods both fall on the
  // same bucket and can't burn payload-store cycles past the limit.
  const limiter = deps.rateLimiter ?? getEmailIntakeRateLimiter();
  const limit = limiter.consume(EMAIL_INTAKE_BUCKET_KEY);
  if (!limit.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
    return jsonResponse(
      429,
      {
        error: 'rate_limited',
        message: `Email intake rate limit exceeded; retry after ${retryAfterSeconds}s.`
      },
      {
        'Retry-After': String(retryAfterSeconds),
        'X-RateLimit-Limit': String(DEFAULT_INTAKE_RATE_LIMIT.maxRequests),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(limit.resetAtMs / 1000))
      }
    );
  }

  const auth = authenticateBearer(request.headers, bearerHash);
  if (!auth.ok) return jsonResponse(auth.status, { error: auth.error, message: auth.message });

  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return jsonResponse(415, {
      error: 'unsupported_media_type',
      message: 'Email intake accepts application/json envelopes from the Cloudflare worker.'
    });
  }

  let envelope: EmailIntakeEnvelope;
  try {
    envelope = (await request.json()) as EmailIntakeEnvelope;
  } catch {
    return jsonResponse(400, {
      error: 'invalid_json',
      message: 'Request body is not valid JSON.'
    });
  }

  const validation = validateEnvelope(envelope);
  if (!validation.ok) {
    return jsonResponse(validation.status, {
      error: validation.error,
      message: validation.message
    });
  }

  // SPF/DKIM/DMARC enforcement. We treat any explicit "fail" as forgery and
  // return 5xx so the originating MTA gives up. "none" is allowed (some
  // legitimate senders don't publish DKIM); "neutral"/"softfail"/"temperror"
  // are permissive — they don't pass forgery and shouldn't bounce a real user.
  if (envelope.auth.dkim === 'fail' || envelope.auth.spf === 'fail') {
    return jsonResponse(550, {
      error: 'email_auth_failed',
      message: `Rejected: SPF=${envelope.auth.spf}, DKIM=${envelope.auth.dkim}, DMARC=${envelope.auth.dmarc}.`
    });
  }
  if (envelope.auth.dmarc === 'fail') {
    return jsonResponse(550, {
      error: 'email_auth_failed',
      message: `Rejected: DMARC=fail (SPF=${envelope.auth.spf}, DKIM=${envelope.auth.dkim}).`
    });
  }

  let config: ReturnType<typeof readIntakeConfig>;
  try {
    config = deps.config ?? readIntakeConfig();
  } catch (err) {
    if (err instanceof IntakeConfigError) {
      return jsonResponse(503, { error: 'intake_not_configured', message: err.message });
    }
    throw err;
  }

  const assigneeUserId = process.env.GSO_INTAKE_EMAIL_USER_ID?.trim() || config.assigneeUserId;

  const attachments = (envelope.attachments ?? []).map<IntakeAttachmentRef>((a) => {
    const bytes = Buffer.from(a.contentBase64, 'base64');
    return {
      storageKey: `email:${envelope.messageId}:${a.filename}`,
      filename: a.filename,
      mimeType: a.mimeType,
      byteLength: bytes.length
    };
  });

  for (const att of attachments) {
    const result = checkAttachment(att);
    if (!result.ok) {
      const status = result.reason === 'too_large' ? 413 : 415;
      return jsonResponse(status, {
        error: `attachment_${result.reason}`,
        message: result.detail
      });
    }
  }

  const body = composeBody(envelope);
  const fromAddress = parseAddress(envelope.from);

  try {
    const result = await processIntake(
      {
        body,
        attachments,
        source: {
          kind: 'email',
          userId: assigneeUserId,
          client: 'cloudflare-email-worker',
          capturedAt: new Date(envelope.receivedAt)
        },
        hints: {
          fromAddress: fromAddress.address,
          fromDomain: fromAddress.domain,
          fromName: fromAddress.name ?? null,
          subject: envelope.subject,
          messageId: envelope.messageId,
          receivedAt: envelope.receivedAt,
          to: envelope.to ?? [],
          authResults: envelope.auth,
          hasHtml: typeof envelope.html === 'string' && envelope.html.length > 0
        }
      },
      {
        payloadStore: deps.payloadStore,
        projectId: config.projectId,
        assigneeUserId,
        normalizer: deps.normalizer ?? undefined,
        createDraftFn: deps.createDraftFn,
        logger: deps.logger
      }
    );

    return jsonResponse(result.draftCreated ? 201 : 200, {
      draftIssueId: result.draftIssueId,
      identifier: result.identifier,
      rawPayloadId: result.rawPayloadId,
      payloadCreated: result.payloadCreated,
      draftCreated: result.draftCreated,
      draftUrl: `/GSO/issues/${result.identifier}`,
      servedBy: result.servedBy
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[intake/email] processIntake failed', err instanceof Error ? err.message : err);
    // 5xx so the Cloudflare worker retries via its built-in MTA-side retry.
    return jsonResponse(502, {
      error: 'draft_create_failed',
      message: 'Failed to create the draft issue. Cloudflare will retry.'
    });
  }
}

function validateEnvelope(
  envelope: unknown
): { ok: true } | { ok: false; status: number; error: string; message: string } {
  if (!envelope || typeof envelope !== 'object') {
    return {
      ok: false,
      status: 400,
      error: 'invalid_envelope',
      message: 'Body must be an object.'
    };
  }
  const e = envelope as Record<string, unknown>;
  for (const key of ['from', 'subject', 'messageId', 'receivedAt']) {
    if (typeof e[key] !== 'string' || (e[key] as string).length === 0) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_envelope',
        message: `Missing required string field "${key}".`
      };
    }
  }
  const text = typeof e.text === 'string' ? e.text : '';
  const html = typeof e.html === 'string' ? e.html : '';
  if (text.length === 0 && html.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'empty_body',
      message: 'Email envelope has neither text nor html body.'
    };
  }
  const combinedLen = Buffer.byteLength(text, 'utf8') + Buffer.byteLength(html, 'utf8');
  if (combinedLen > EMAIL_INTAKE_MAX_BODY_BYTES) {
    return {
      ok: false,
      status: 413,
      error: 'body_too_large',
      message: `Email body (${combinedLen} bytes) exceeds ${EMAIL_INTAKE_MAX_BODY_BYTES} byte limit.`
    };
  }
  if (!e.auth || typeof e.auth !== 'object') {
    return {
      ok: false,
      status: 400,
      error: 'missing_auth',
      message: 'Envelope is missing the SPF/DKIM/DMARC auth block.'
    };
  }
  const attachments = e.attachments;
  if (attachments !== undefined) {
    if (!Array.isArray(attachments)) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_attachments',
        message: '"attachments" must be an array when present.'
      };
    }
    if (attachments.length > MAX_ATTACHMENTS) {
      return {
        ok: false,
        status: 413,
        error: 'too_many_attachments',
        message: `${attachments.length} attachments exceed the ${MAX_ATTACHMENTS} max.`
      };
    }
    let total = combinedLen;
    for (const att of attachments) {
      if (!att || typeof att !== 'object') {
        return {
          ok: false,
          status: 400,
          error: 'invalid_attachment',
          message: 'Each attachment must be an object.'
        };
      }
      const a = att as Record<string, unknown>;
      if (typeof a.filename !== 'string' || typeof a.contentBase64 !== 'string') {
        return {
          ok: false,
          status: 400,
          error: 'invalid_attachment',
          message: 'Each attachment requires filename and contentBase64 strings.'
        };
      }
      const decodedLen = base64DecodedLength(a.contentBase64);
      if (decodedLen > MAX_ATTACHMENT_BYTES) {
        return {
          ok: false,
          status: 413,
          error: 'attachment_too_large',
          message: `${a.filename}: ${decodedLen} bytes exceeds ${MAX_ATTACHMENT_BYTES} byte limit.`
        };
      }
      total += decodedLen;
    }
    if (total > EMAIL_INTAKE_MAX_TOTAL_BYTES) {
      return {
        ok: false,
        status: 413,
        error: 'envelope_too_large',
        message: `Envelope total (${total} bytes) exceeds ${EMAIL_INTAKE_MAX_TOTAL_BYTES} byte limit.`
      };
    }
  }
  return { ok: true };
}

function authenticateBearer(
  headers: Headers,
  expectedHashHex: string
): { ok: true } | { ok: false; status: number; error: string; message: string } {
  const header = headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    return {
      ok: false,
      status: 401,
      error: 'missing_authorization',
      message: 'Bearer token required.'
    };
  }
  const raw = header.slice(7).trim();
  if (raw.length === 0) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_authorization',
      message: 'Bearer token is empty.'
    };
  }
  const presentedHash = createHash('sha256').update(raw).digest('hex');
  const a = Buffer.from(presentedHash, 'hex');
  const b = Buffer.from(expectedHashHex, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_authorization',
      message: 'Bearer token does not match the configured email-intake hash.'
    };
  }
  return { ok: true };
}

function composeBody(envelope: EmailIntakeEnvelope): string {
  const header = [
    `From: ${envelope.from}`,
    envelope.to && envelope.to.length > 0 ? `To: ${envelope.to.join(', ')}` : null,
    `Subject: ${envelope.subject}`,
    `Date: ${envelope.receivedAt}`,
    `Message-ID: ${envelope.messageId}`
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const text = envelope.text ?? '';
  // Plain text is the source of truth for the LLM normalizer. We append a
  // marker when only HTML was sent so the normalizer doesn't see an empty body.
  const body =
    text.length > 0
      ? text
      : '[email had no plain-text body; html-only message — see raw payload for details]';

  return `${header}\n\n${body}`;
}

interface ParsedAddress {
  address: string;
  domain: string | null;
  name: string | null;
}

export function parseAddress(value: string): ParsedAddress {
  const trimmed = value.trim();
  // "Display Name" <addr@domain> | Display Name <addr@domain> | addr@domain
  const bracketed = /^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/.exec(trimmed);
  if (bracketed) {
    const name = bracketed[1]?.trim() || null;
    const address = bracketed[2].trim();
    return { address, domain: domainOf(address), name };
  }
  return { address: trimmed, domain: domainOf(trimmed), name: null };
}

function domainOf(address: string): string | null {
  const at = address.lastIndexOf('@');
  if (at < 0 || at === address.length - 1) return null;
  return address.slice(at + 1).toLowerCase();
}

function base64DecodedLength(b64: string): number {
  const padded = b64.replace(/\s/g, '');
  if (padded.length === 0) return 0;
  let pad = 0;
  if (padded.endsWith('==')) pad = 2;
  else if (padded.endsWith('=')) pad = 1;
  return Math.floor((padded.length * 3) / 4) - pad;
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders }
  });
}
