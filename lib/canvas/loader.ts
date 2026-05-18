import 'server-only';

import { createPaperclipClient, type PaperclipClient } from '../paperclip/client';
import { readPaperclipEnv } from '../paperclip/env';
import { buildCanvasBundle } from './projection';
import { readCanvasBundle, type CanvasCacheReadResult } from './cache';
import { getBurnSnapshotStore } from './burn-snapshot/store-singleton';
import { writeBurnSnapshotsForBundle } from './burn-snapshot/writer';

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
  const bundle = buildCanvasBundle({ companyId: env.companyId, agents, issues });
  // Piggyback: snapshot today's per-agent spend on every live Paperclip fetch.
  // Idempotent by (agentId, dateUtc) — safe to fire on every cache miss.
  void writeBurnSnapshotsForBundle(getBurnSnapshotStore(), bundle);
  return bundle;
}

export function loadCanvas(): Promise<CanvasCacheReadResult> {
  return readCanvasBundle(loadFromPaperclip);
}
