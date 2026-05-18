import 'server-only';

import { authenticateIntakeRequest } from './authenticate';
import type { ApiTokenStore } from './api-tokens';
import { readIntakeConfig, IntakeConfigError, type IntakeRuntimeConfig } from './config';
import { processIntake, type ProcessIntakeResult } from './intake-service';
import type { IntakePayloadStore } from './payload-store';
import { parseIntakeRequest } from './request-parser';
import {
  DEFAULT_INTAKE_RATE_LIMIT,
  getIntakeRateLimiter,
  type SlidingWindowRateLimiter
} from './rate-limit';

// Pure (request-in, response-out) handler. The Next route adapter at
// app/api/intake/route.ts is a thin wrapper that wires the singletons.
//
// Returning a Response keeps this testable without spinning up Next — the
// route file imports this and forwards the request.

export interface IntakeHandlerDeps {
  payloadStore: IntakePayloadStore;
  tokenStore: ApiTokenStore;
  config: IntakeRuntimeConfig;
  rateLimiter?: SlidingWindowRateLimiter;
  createDraftFn?: Parameters<typeof processIntake>[1]['createDraftFn'];
  logger?: Parameters<typeof processIntake>[1]['logger'];
}

export interface SuccessBody {
  draftIssueId: string;
  identifier: string;
  rawPayloadId: string;
  payloadCreated: boolean;
  draftCreated: boolean;
  draftUrl: string;
}

export interface ErrorBody {
  error: string;
  message: string;
}

export async function handleIntakeRequest(
  request: Request,
  deps: IntakeHandlerDeps
): Promise<Response> {
  const auth = await authenticateIntakeRequest(request.headers, { tokenStore: deps.tokenStore });
  if (!auth.ok) {
    return jsonResponse(auth.status, { error: auth.error, message: auth.message });
  }

  const limiter = deps.rateLimiter ?? getIntakeRateLimiter();
  const limit = limiter.consume(`user:${auth.userId}`);
  if (!limit.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
    return jsonResponse(
      429,
      { error: 'rate_limited', message: `Rate limit exceeded; retry after ${retryAfterSeconds}s.` },
      {
        'Retry-After': String(retryAfterSeconds),
        'X-RateLimit-Limit': String(DEFAULT_INTAKE_RATE_LIMIT.maxRequests),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(limit.resetAtMs / 1000))
      }
    );
  }

  const parsed = await parseIntakeRequest(request);
  if (!parsed.ok) {
    return jsonResponse(parsed.status, { error: parsed.error, message: parsed.message });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
  const userAgent = request.headers.get('user-agent') ?? undefined;

  let result: ProcessIntakeResult;
  try {
    result = await processIntake(
      {
        body: parsed.value.body,
        attachments: parsed.value.attachments,
        source: {
          kind: parsed.value.kind,
          userId: auth.userId,
          client:
            typeof parsed.value.sourceMeta.client === 'string'
              ? (parsed.value.sourceMeta.client as string)
              : 'api',
          ip,
          userAgent
        }
      },
      {
        payloadStore: deps.payloadStore,
        projectId: deps.config.projectId,
        assigneeUserId: deps.config.assigneeUserId,
        createDraftFn: deps.createDraftFn,
        logger: deps.logger
      }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[intake] processIntake failed', err instanceof Error ? err.message : err);
    return jsonResponse(502, {
      error: 'draft_create_failed',
      message: 'Failed to create the draft issue. Try again or contact support.'
    });
  }

  const draftUrl = `/GSO/issues/${result.identifier}`;
  return jsonResponse(
    result.draftCreated ? 201 : 200,
    {
      draftIssueId: result.draftIssueId,
      identifier: result.identifier,
      rawPayloadId: result.rawPayloadId,
      payloadCreated: result.payloadCreated,
      draftCreated: result.draftCreated,
      draftUrl
    },
    {
      'X-RateLimit-Limit': String(DEFAULT_INTAKE_RATE_LIMIT.maxRequests),
      'X-RateLimit-Remaining': String(limit.remaining)
    }
  );
}

export function loadIntakeConfigOr503(): Response | IntakeRuntimeConfig {
  try {
    return readIntakeConfig();
  } catch (err) {
    if (err instanceof IntakeConfigError) {
      return jsonResponse(503, {
        error: 'intake_not_configured',
        message: err.message
      });
    }
    throw err;
  }
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  extra: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extra
    }
  });
}
