import { describe, it, expect } from 'vitest';
import { buildHealthPayload } from '@/lib/health';

describe('health payload', () => {
  it('returns the well-known status shape', () => {
    const fixedNow = Date.parse('2026-01-01T00:00:00.000Z');
    const payload = buildHealthPayload(() => fixedNow);

    expect(payload.status).toBe('ok');
    expect(payload.service).toBe('gso');
    expect(payload.timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(payload.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof payload.version).toBe('string');
    expect(typeof payload.commit).toBe('string');
  });

  it('uses GSO_VERSION and GSO_COMMIT when present', () => {
    const originalVersion = process.env.GSO_VERSION;
    const originalCommit = process.env.GSO_COMMIT;
    process.env.GSO_VERSION = '9.9.9';
    process.env.GSO_COMMIT = 'abc1234';

    try {
      const payload = buildHealthPayload();
      expect(payload.version).toBe('9.9.9');
      expect(payload.commit).toBe('abc1234');
    } finally {
      if (originalVersion === undefined) delete process.env.GSO_VERSION;
      else process.env.GSO_VERSION = originalVersion;
      if (originalCommit === undefined) delete process.env.GSO_COMMIT;
      else process.env.GSO_COMMIT = originalCommit;
    }
  });
});
