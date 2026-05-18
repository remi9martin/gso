#!/usr/bin/env -S node --experimental-strip-types

// Mint a personal intake API token for /api/intake.
//
// Prints the raw token ONCE (capture it into 1Password — that is the v0
// storage policy per the CEO decision on GSO-124). Only the sha256 hash is
// persisted, so a lost token must be revoked and re-minted.
//
// Usage:
//   npx tsx scripts/intake/mint-token.ts --user <userId> --label "Remi laptop"
//
// In v0 this writes to the in-memory token store, which is process-local.
// When the Postgres adapter ships (follow-up issue), this script will write
// to the same table the route handler reads from.

import { generateToken, type ApiTokenRecord } from '../../lib/intake/api-tokens';
import { MemoryApiTokenStore } from '../../lib/intake/api-token-store-memory';
import { randomUUID } from 'node:crypto';

interface Args {
  userId: string;
  label: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--user' || flag === '--user-id') {
      out.userId = value;
      i++;
    } else if (flag === '--label') {
      out.label = value;
      i++;
    }
  }
  if (!out.userId) throw new Error('Required: --user <userId>');
  if (!out.label) out.label = `intake-${new Date().toISOString().slice(0, 10)}`;
  return out as Args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const store = new MemoryApiTokenStore();
  const { rawToken, tokenHash } = generateToken();
  const record: ApiTokenRecord = {
    id: randomUUID(),
    userId: args.userId,
    label: args.label,
    tokenHash,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null
  };
  await store.insert(record);

   
  console.log(
    JSON.stringify(
      {
        note: 'Save the rawToken in 1Password — it will NOT be shown again.',
        rawToken,
        record: { ...record, tokenHash: '<redacted>' }
      },
      null,
      2
    )
  );
}

main().catch((err) => {
   
  console.error(err);
  process.exit(1);
});
