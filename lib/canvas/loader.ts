import 'server-only';

import { createPaperclipClient, type PaperclipClient } from '../paperclip/client';
import { readPaperclipEnv } from '../paperclip/env';
import { buildCanvasBundle } from './projection';
import { readCanvasBundle, type CanvasCacheReadResult } from './cache';

let cachedClient: PaperclipClient | null = null;

function getClient(): PaperclipClient {
  if (!cachedClient) cachedClient = createPaperclipClient();
  return cachedClient;
}

export function __setCanvasClientForTests(client: PaperclipClient | null): void {
  cachedClient = client;
}

async function loadFromPaperclip() {
  const env = readPaperclipEnv();
  const client = getClient();
  const [agents, issues] = await Promise.all([client.listAgents(), client.listOpenIssues()]);
  return buildCanvasBundle({ companyId: env.companyId, agents, issues });
}

export function loadCanvas(): Promise<CanvasCacheReadResult> {
  return readCanvasBundle(loadFromPaperclip);
}
