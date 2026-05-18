import { describe, expect, it } from 'vitest';

import {
  extractBearer,
  generateToken,
  hashToken,
  isWellFormedToken,
  timingSafeStringEqual
} from '@/lib/intake/api-tokens';

describe('api token helpers', () => {
  it('generates a well-formed token and a hex sha256 hash', () => {
    const { rawToken, tokenHash } = generateToken();
    expect(rawToken.startsWith('gso_intake_')).toBe(true);
    expect(isWellFormedToken(rawToken)).toBe(true);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(rawToken)).toBe(tokenHash);
  });

  it('rejects malformed tokens', () => {
    expect(isWellFormedToken('')).toBe(false);
    expect(isWellFormedToken('not-prefixed-anything')).toBe(false);
    expect(isWellFormedToken('gso_intake_')).toBe(false);
    expect(isWellFormedToken('gso_intake_with spaces')).toBe(false);
  });

  it('extracts bearer tokens', () => {
    expect(extractBearer(null)).toBeNull();
    expect(extractBearer('Basic foo')).toBeNull();
    expect(extractBearer('Bearer abc')).toBe('abc');
    expect(extractBearer('bearer abc')).toBe('abc');
    expect(extractBearer('Bearer   ')).toBeNull();
  });

  it('timing-safe string compare', () => {
    expect(timingSafeStringEqual('abc', 'abc')).toBe(true);
    expect(timingSafeStringEqual('abc', 'abd')).toBe(false);
    expect(timingSafeStringEqual('abc', 'abcd')).toBe(false);
  });
});
