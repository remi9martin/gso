import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __setCanvasClientForTests, loadCanvas } from '@/lib/canvas/loader';
import { __resetCanvasCacheForTests } from '@/lib/canvas/cache';

const PAPERCLIP_VARS = ['PAPERCLIP_API_URL', 'PAPERCLIP_API_KEY', 'PAPERCLIP_COMPANY_ID'] as const;

describe('loadCanvas — fixture fallback when env is absent', () => {
  const original: Partial<Record<(typeof PAPERCLIP_VARS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of PAPERCLIP_VARS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    __resetCanvasCacheForTests();
    __setCanvasClientForTests(null);
  });

  afterEach(() => {
    for (const key of PAPERCLIP_VARS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('returns fixture mode + the list of missing env vars when env is absent', async () => {
    const result = await loadCanvas();
    expect(result.mode).toBe('fixture');
    expect(result.missingEnv).toEqual([
      'PAPERCLIP_API_URL',
      'PAPERCLIP_API_KEY',
      'PAPERCLIP_COMPANY_ID'
    ]);
    expect(result.bundle.nodes.length).toBeGreaterThan(0);
  });

  it('returns live mode when env is present (mocked client returns empty)', async () => {
    process.env.PAPERCLIP_API_URL = 'http://localhost:3101';
    process.env.PAPERCLIP_API_KEY = 'secret';
    process.env.PAPERCLIP_COMPANY_ID = 'company-1';
    __setCanvasClientForTests({
      listAgents: async () => [],
      listOpenIssues: async () => []
    });
    const result = await loadCanvas();
    expect(result.mode).toBe('live');
    expect(result.missingEnv).toBeNull();
    expect(result.bundle.nodes).toEqual([]);
  });
});
