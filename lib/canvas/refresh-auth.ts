import 'server-only';

import { timingSafeEqual } from 'node:crypto';

const HEADER_NAME = 'authorization';

export type RefreshAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string; message: string };

export function checkRefreshAuth(
  headers: Headers,
  envValue: string | undefined = process.env.CANVAS_REFRESH_TOKEN
): RefreshAuthResult {
  const configured = envValue?.trim();
  if (!configured) {
    return {
      ok: false,
      status: 503,
      error: 'refresh_disabled',
      message: 'CANVAS_REFRESH_TOKEN is not configured on the server.'
    };
  }

  const header = headers.get(HEADER_NAME);
  if (!header) {
    return {
      ok: false,
      status: 401,
      error: 'missing_authorization',
      message: 'Authorization header is required.'
    };
  }

  const presented = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : header.trim();

  if (!presented) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_authorization',
      message: 'Bearer token was empty.'
    };
  }

  const a = Buffer.from(presented);
  const b = Buffer.from(configured);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_authorization',
      message: 'Bearer token does not match CANVAS_REFRESH_TOKEN.'
    };
  }

  return { ok: true };
}
