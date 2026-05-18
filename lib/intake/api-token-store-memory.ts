import 'server-only';

import type { ApiTokenRecord, ApiTokenStore } from './api-tokens';

// In-process token store used by tests and the default dev path. Production
// runs against `PostgresApiTokenStore`. Keeps the same surface so the route
// handler is store-agnostic.

export class MemoryApiTokenStore implements ApiTokenStore {
  private readonly byId = new Map<string, ApiTokenRecord>();
  private readonly byHash = new Map<string, string>();

  async insert(record: ApiTokenRecord): Promise<void> {
    if (this.byHash.has(record.tokenHash)) {
      throw new Error(`intake_api_tokens token_hash collision for id=${record.id}`);
    }
    this.byId.set(record.id, { ...record });
    this.byHash.set(record.tokenHash, record.id);
  }

  async findByHash(tokenHash: string): Promise<ApiTokenRecord | null> {
    const id = this.byHash.get(tokenHash);
    if (!id) return null;
    const row = this.byId.get(id);
    return row ? { ...row } : null;
  }

  async markUsed(id: string, when: Date = new Date()): Promise<void> {
    const row = this.byId.get(id);
    if (!row) return;
    row.lastUsedAt = when.toISOString();
  }

  async revoke(id: string, when: Date = new Date()): Promise<void> {
    const row = this.byId.get(id);
    if (!row) return;
    row.revokedAt = when.toISOString();
  }

  async listActiveForUser(userId: string): Promise<ApiTokenRecord[]> {
    const rows: ApiTokenRecord[] = [];
    for (const row of this.byId.values()) {
      if (row.userId === userId && !row.revokedAt) rows.push({ ...row });
    }
    return rows;
  }
}
