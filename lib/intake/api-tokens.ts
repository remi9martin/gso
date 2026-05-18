import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Tokens are formatted as `gso_intake_<base64url(32 random bytes)>`. We never
// persist the raw token — only the sha256 hash of the random part. Hashing is
// deterministic so lookups are a single indexed read against `token_hash`.
//
// Per CEO decision on GSO-124, tokens are scoped to /api/intake only. Issuing
// or validating a token here grants no Paperclip-wide capability.

const PREFIX = 'gso_intake_';
const RANDOM_BYTES = 32;

export interface ApiTokenRecord {
  id: string;
  userId: string;
  label: string;
  tokenHash: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiTokenStore {
  insert(record: ApiTokenRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<ApiTokenRecord | null>;
  markUsed(id: string, when?: Date): Promise<void>;
  revoke(id: string, when?: Date): Promise<void>;
  listActiveForUser(userId: string): Promise<ApiTokenRecord[]>;
}

export interface MintedToken {
  record: ApiTokenRecord;
  rawToken: string;
}

export function generateToken(): { rawToken: string; tokenHash: string } {
  const random = randomBytes(RANDOM_BYTES);
  const rawToken = `${PREFIX}${toBase64Url(random)}`;
  const tokenHash = hashToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function isWellFormedToken(rawToken: string): boolean {
  if (!rawToken.startsWith(PREFIX)) return false;
  const body = rawToken.slice(PREFIX.length);
  if (body.length === 0) return false;
  return /^[A-Za-z0-9_-]+$/.test(body);
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function extractBearer(authorization: string | null): string | null {
  if (!authorization) return null;
  const trimmed = authorization.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return null;
  const value = trimmed.slice('bearer '.length).trim();
  return value || null;
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
