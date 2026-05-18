import { describe, expect, it } from 'vitest';

import { validateMemoryPath } from '@/lib/memory-mcp/path';

describe('validateMemoryPath', () => {
  it('accepts a simple path', () => {
    const res = validateMemoryPath('identity/who-is-remi.md');
    expect(res).toEqual({ ok: true, path: 'identity/who-is-remi.md' });
  });

  it('strips a leading slash', () => {
    const res = validateMemoryPath('/identity/who-is-remi.md');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.path).toBe('identity/who-is-remi.md');
  });

  it('rejects ".." segments', () => {
    const res = validateMemoryPath('../escape.md');
    expect(res.ok).toBe(false);
  });

  it('rejects empty paths', () => {
    const res = validateMemoryPath('');
    expect(res.ok).toBe(false);
  });

  it('rejects non-strings', () => {
    const res = validateMemoryPath(42 as unknown);
    expect(res.ok).toBe(false);
  });

  it('rejects whitespace / disallowed characters', () => {
    const res = validateMemoryPath('identity/who is remi.md');
    expect(res.ok).toBe(false);
  });

  it('rejects .htaccess', () => {
    const res = validateMemoryPath('subdir/.htaccess');
    expect(res.ok).toBe(false);
  });

  it('rejects very long paths', () => {
    const res = validateMemoryPath('a/'.repeat(300));
    expect(res.ok).toBe(false);
  });
});
