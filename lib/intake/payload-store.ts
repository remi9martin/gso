import 'server-only';

// Storage adapters for `intake_payloads`. Matches the schema in
// migrations/0002_intake_payloads.sql (GSO-123).
//
// Idempotency is enforced at the row layer by the UNIQUE index on
// `payload_hash`. The store's `upsert` returns the existing id when the same
// hash already exists, so retries are safe end-to-end.

export type IntakeKind = 'email' | 'capture' | 'api';

export interface IntakePayloadInput {
  id: string;
  kind: IntakeKind;
  payloadHash: string;
  body: string;
  attachmentRefs: string[];
  sourceMeta: Record<string, unknown>;
  capturedAt: Date;
}

export interface IntakePayloadRecord extends IntakePayloadInput {
  createdAt: string;
}

export interface UpsertResult {
  record: IntakePayloadRecord;
  created: boolean;
}

export interface IntakePayloadStore {
  upsert(input: IntakePayloadInput): Promise<UpsertResult>;
  findById(id: string): Promise<IntakePayloadRecord | null>;
  findByHash(payloadHash: string): Promise<IntakePayloadRecord | null>;
}

export class MemoryIntakePayloadStore implements IntakePayloadStore {
  private readonly byId = new Map<string, IntakePayloadRecord>();
  private readonly byHash = new Map<string, string>();

  async upsert(input: IntakePayloadInput): Promise<UpsertResult> {
    const existingId = this.byHash.get(input.payloadHash);
    if (existingId) {
      const record = this.byId.get(existingId);
      if (record) return { record: { ...record }, created: false };
    }
    const record: IntakePayloadRecord = {
      ...input,
      createdAt: new Date().toISOString()
    };
    this.byId.set(record.id, record);
    this.byHash.set(record.payloadHash, record.id);
    return { record: { ...record }, created: true };
  }

  async findById(id: string): Promise<IntakePayloadRecord | null> {
    const row = this.byId.get(id);
    return row ? { ...row } : null;
  }

  async findByHash(payloadHash: string): Promise<IntakePayloadRecord | null> {
    const id = this.byHash.get(payloadHash);
    if (!id) return null;
    const row = this.byId.get(id);
    return row ? { ...row } : null;
  }

  // Test-only: enumerate every persisted record. Lives on the in-memory store
  // because the durable adapter (lib/canvas/.../postgres-store-style) will get
  // a proper SQL listing endpoint; tests should not poke at the private map.
  entriesForTest(): IntakePayloadRecord[] {
    return Array.from(this.byId.values()).map((row) => ({ ...row }));
  }
}
