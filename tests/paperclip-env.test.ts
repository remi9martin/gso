import { describe, expect, it } from 'vitest';

import { PaperclipEnvError, readPaperclipEnv } from '@/lib/paperclip/env';

describe('readPaperclipEnv', () => {
  it('reads the three required vars and trims trailing slash on the url', () => {
    const env = readPaperclipEnv({
      PAPERCLIP_API_URL: 'http://localhost:3101/',
      PAPERCLIP_API_KEY: 'secret',
      PAPERCLIP_COMPANY_ID: 'company-1'
    });
    expect(env.apiUrl).toBe('http://localhost:3101');
    expect(env.apiKey).toBe('secret');
    expect(env.companyId).toBe('company-1');
  });

  it('throws PaperclipEnvError listing all missing vars', () => {
    expect(() => readPaperclipEnv({ PAPERCLIP_API_URL: 'http://x' })).toThrowError(
      PaperclipEnvError
    );
    try {
      readPaperclipEnv({});
    } catch (e) {
      expect(e).toBeInstanceOf(PaperclipEnvError);
      expect((e as PaperclipEnvError).missing).toEqual([
        'PAPERCLIP_API_URL',
        'PAPERCLIP_API_KEY',
        'PAPERCLIP_COMPANY_ID'
      ]);
    }
  });
});
