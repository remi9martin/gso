import 'server-only';

import { timingSafeEqual } from 'node:crypto';

const HEADER_NAME = 'authorization';

export type MemoryMcpAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string; message: string };

export function checkMemoryMcpAuth(
  headers: Headers,
  envValue: string | undefined = process.env.MEMORY_MCP_BEARER_TOKEN
): MemoryMcpAuthResult {
  const configured = envValue?.trim();
  if (!configured) {
    return {
      ok: false,
      status: 503,
      error: 'mcp_disabled',
      message: 'MEMORY_MCP_BEARER_TOKEN is not configured on the server.'
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
      message: 'Bearer token does not match MEMORY_MCP_BEARER_TOKEN.'
    };
  }

  return { ok: true };
}
