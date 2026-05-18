import * as util from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  DispatcherKeyMissingError,
  dispatcherKeyEnvVar,
  loadDispatcherKey,
  redactKey
} from '@/lib/dispatch/secrets';
import {
  DispatchAuthorizationError,
  checkDispatchAuthorization
} from '@/lib/dispatch/authorization';

describe('dispatcherKeyEnvVar', () => {
  it('normalizes a UUID into an upper-snake env name', () => {
    expect(dispatcherKeyEnvVar('abc-123-def')).toBe('GSO_DISPATCHER_KEY_ABC_123_DEF');
  });

  it('collapses non-alphanumerics into single underscores', () => {
    expect(dispatcherKeyEnvVar('a.b.c__d')).toBe('GSO_DISPATCHER_KEY_A_B_C_D');
  });

  it('throws on empty input', () => {
    expect(() => dispatcherKeyEnvVar('')).toThrowError(/empty/i);
  });
});

describe('loadDispatcherKey', () => {
  it('returns an opaque holder whose toString never reveals the value', () => {
    const env = { GSO_DISPATCHER_KEY_TARGET: 'super-secret-token' };
    const key = loadDispatcherKey('target', env);
    expect(key.reveal()).toBe('super-secret-token');
    expect(String(key)).not.toContain('super-secret-token');
    expect(JSON.stringify(key)).not.toContain('super-secret-token');
  });

  it('throws DispatcherKeyMissingError when the env var is absent', () => {
    expect(() => loadDispatcherKey('missing-company', {})).toThrowError(DispatcherKeyMissingError);
  });

  it('error message names the env var but never includes the (absent) value', () => {
    try {
      loadDispatcherKey('missing-company', {});
      throw new Error('expected throw');
    } catch (err) {
      const e = err as DispatcherKeyMissingError;
      expect(e.envVarName).toBe('GSO_DISPATCHER_KEY_MISSING_COMPANY');
      expect(e.message).toContain('GSO_DISPATCHER_KEY_MISSING_COMPANY');
    }
  });

  it('util.inspect renders a single redacted line — no function bodies, no raw value', () => {
    const env = { GSO_DISPATCHER_KEY_TARGET: 'super-secret-token' };
    const key = loadDispatcherKey('target', env);
    const inspected = util.inspect(key);
    expect(inspected).not.toContain('super-secret-token');
    expect(inspected).not.toContain('[Function');
    expect(inspected).toContain('GSO_DISPATCHER_KEY_TARGET');
    expect(inspected).toContain('target');
    // Single-line: no embedded newlines.
    expect(inspected.includes('\n')).toBe(false);
  });
});

describe('redactKey', () => {
  it('removes the secret from arbitrary text', () => {
    const key = loadDispatcherKey('target', { GSO_DISPATCHER_KEY_TARGET: 'top-secret' });
    expect(redactKey('error: top-secret leaked here', key)).toBe('error: [REDACTED] leaked here');
  });
});

describe('checkDispatchAuthorization', () => {
  it('throws no-marker when the document is absent', () => {
    try {
      checkDispatchAuthorization('GSO-1', null);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as DispatchAuthorizationError).code).toBe('no-marker');
    }
  });

  it('accepts YAML-style `authorized: true`', () => {
    expect(() =>
      checkDispatchAuthorization('GSO-1', { body: 'authorized: true\nby: triage' })
    ).not.toThrow();
  });

  it('accepts bare `true`', () => {
    expect(() => checkDispatchAuthorization('GSO-1', { body: 'true' })).not.toThrow();
  });

  it('refuses `authorized: false`', () => {
    try {
      checkDispatchAuthorization('GSO-1', { body: 'authorized: false' });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as DispatchAuthorizationError).code).toBe('marker-false');
    }
  });

  it('refuses an empty document body', () => {
    expect(() => checkDispatchAuthorization('GSO-1', { body: '' })).toThrowError(
      DispatchAuthorizationError
    );
  });

  it('refuses a body with neither true nor false', () => {
    try {
      checkDispatchAuthorization('GSO-1', { body: 'maybe' });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as DispatchAuthorizationError).code).toBe('marker-malformed');
    }
  });

  it('refuses prose that embeds "authorized: true" mid-sentence', () => {
    // The regex must be line-anchored — `not authorized: true` is NOT
    // permission. (See GSO-148 item 1.)
    try {
      checkDispatchAuthorization('GSO-1', { body: 'not authorized: true' });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as DispatchAuthorizationError).code).toBe('marker-malformed');
    }
  });

  it('refuses prose that embeds bare "true" mid-sentence', () => {
    try {
      checkDispatchAuthorization('GSO-1', { body: 'definitely not true here' });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as DispatchAuthorizationError).code).toBe('marker-malformed');
    }
  });

  it('accepts indented `authorized: true` (line-anchored, not column-anchored)', () => {
    expect(() => checkDispatchAuthorization('GSO-1', { body: '  authorized: true' })).not.toThrow();
  });

  it('accepts `authorized: true` on a later line (multi-line YAML)', () => {
    expect(() =>
      checkDispatchAuthorization('GSO-1', { body: 'by: triage\nauthorized: true\n' })
    ).not.toThrow();
  });
});
