import 'server-only';

import { createPaperclipClient, type PaperclipClient } from '../paperclip/client';
import { PaperclipEnvError, readPaperclipEnv } from '../paperclip/env';
import { buildCanvasBundle } from './projection';
import { readCanvasBundle, type CanvasCacheReadResult } from './cache';
import { fixtureBundle } from './fixture';
import type { CanvasBundle } from './types';

let cachedClient: PaperclipClient | null = null;

function getClient(): PaperclipClient {
  if (!cachedClient) cachedClient = createPaperclipClient();
  return cachedClient;
}

export function __setCanvasClientForTests(client: PaperclipClient | null): void {
  cachedClient = client;
}

async function loadFromPaperclip(): Promise<CanvasBundle> {
  const env = readPaperclipEnv();
  const client = getClient();
  const [agents, issues] = await Promise.all([client.listAgents(), client.listOpenIssues()]);
  return buildCanvasBundle({ companyId: env.companyId, agents, issues });
}

export interface CanvasLoadResult extends CanvasCacheReadResult {
  mode: 'live' | 'fixture';
  missingEnv: string[] | null;
}

export async function loadCanvas(): Promise<CanvasLoadResult> {
  try {
    readPaperclipEnv();
  } catch (err) {
    if (err instanceof PaperclipEnvError) {
      return {
        bundle: fixtureBundle(),
        source: 'miss',
        mode: 'fixture',
        missingEnv: err.missing
      };
    }
    throw err;
  }

  const result = await readCanvasBundle(loadFromPaperclip);
  return { ...result, mode: 'live', missingEnv: null };
}
