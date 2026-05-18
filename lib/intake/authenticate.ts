import 'server-only';

import type { ApiTokenStore } from './api-tokens';
import { extractBearer, hashToken, isWellFormedToken } from './api-tokens';

export type AuthenticateResult =
  | { ok: true; userId: string; tokenId: string }
  | { ok: false; status: 401; error: string; message: string };

export interface AuthenticateOptions {
  tokenStore: ApiTokenStore;
  markUsed?: boolean;
}

export async function authenticateIntakeRequest(
  headers: Headers,
  opts: AuthenticateOptions
): Promise<AuthenticateResult> {
  const presented = extractBearer(headers.get('authorization'));
  if (!presented) {
    return {
      ok: false,
      status: 401,
      error: 'missing_authorization',
      message: 'Authorization: Bearer gso_intake_<token> is required.'
    };
  }

  if (!isWellFormedToken(presented)) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_authorization',
      message: 'Bearer token is not a well-formed intake token.'
    };
  }

  const tokenHash = hashToken(presented);
  const record = await opts.tokenStore.findByHash(tokenHash);
  if (!record) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_authorization',
      message: 'Bearer token is not recognized.'
    };
  }
  if (record.revokedAt) {
    return {
      ok: false,
      status: 401,
      error: 'token_revoked',
      message: 'This token has been revoked.'
    };
  }

  if (opts.markUsed !== false) {
    // Fire-and-forget: a slow last-used update should not block the response.
    opts.tokenStore.markUsed(record.id).catch(() => undefined);
  }

  return { ok: true, userId: record.userId, tokenId: record.id };
}
