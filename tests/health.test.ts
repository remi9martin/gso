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

  it('falls back to VERCEL_GIT_COMMIT_SHA when GSO_COMMIT is unset', () => {
    const originalGso = process.env.GSO_COMMIT;
    const originalVercel = process.env.VERCEL_GIT_COMMIT_SHA;
    const originalGit = process.env.GIT_COMMIT_SHA;
    delete process.env.GSO_COMMIT;
    process.env.VERCEL_GIT_COMMIT_SHA = 'deadbeefcafebabe1234567890';
    delete process.env.GIT_COMMIT_SHA;

    try {
      expect(buildHealthPayload().commit).toBe('deadbee');
    } finally {
      if (originalGso === undefined) delete process.env.GSO_COMMIT;
      else process.env.GSO_COMMIT = originalGso;
      if (originalVercel === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = originalVercel;
      if (originalGit === undefined) delete process.env.GIT_COMMIT_SHA;
      else process.env.GIT_COMMIT_SHA = originalGit;
    }
  });

  it('falls back to GIT_COMMIT_SHA when neither GSO_COMMIT nor VERCEL is set', () => {
    const originalGso = process.env.GSO_COMMIT;
    const originalVercel = process.env.VERCEL_GIT_COMMIT_SHA;
    const originalGit = process.env.GIT_COMMIT_SHA;
    delete process.env.GSO_COMMIT;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.GIT_COMMIT_SHA = '1234567890abcdef';

    try {
      expect(buildHealthPayload().commit).toBe('1234567');
    } finally {
      if (originalGso === undefined) delete process.env.GSO_COMMIT;
      else process.env.GSO_COMMIT = originalGso;
      if (originalVercel === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = originalVercel;
      if (originalGit === undefined) delete process.env.GIT_COMMIT_SHA;
      else process.env.GIT_COMMIT_SHA = originalGit;
    }
  });

  it('returns "dev" when no commit env var is set', () => {
    const originalGso = process.env.GSO_COMMIT;
    const originalVercel = process.env.VERCEL_GIT_COMMIT_SHA;
    const originalGit = process.env.GIT_COMMIT_SHA;
    delete process.env.GSO_COMMIT;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.GIT_COMMIT_SHA;

    try {
      expect(buildHealthPayload().commit).toBe('dev');
    } finally {
      if (originalGso !== undefined) process.env.GSO_COMMIT = originalGso;
      if (originalVercel !== undefined) process.env.VERCEL_GIT_COMMIT_SHA = originalVercel;
      if (originalGit !== undefined) process.env.GIT_COMMIT_SHA = originalGit;
    }
  });
});
