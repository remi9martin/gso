#!/usr/bin/env -S node --experimental-strip-types

// Mint the bearer token shared between the Cloudflare Email Worker and
// /api/intake/email.
//
// The raw token goes into the Cloudflare worker's secret store
// (`wrangler secret put EMAIL_INTAKE_TOKEN`) and 1Password (per the v0
// rotation policy). The sha256 hash goes into Vercel as
// EMAIL_INTAKE_BEARER_HASH. The API only ever sees the hash.

import { createHash, randomBytes } from 'node:crypto';

function generate(): { rawToken: string; tokenHash: string } {
  // 32 raw bytes → 43-char base64url string. Plenty of entropy for a single
  // bearer token shared with one CF worker.
  const raw = randomBytes(32).toString('base64url');
  const rawToken = `gso_email_${raw}`;
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
}

function main(): void {
  const { rawToken, tokenHash } = generate();
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        note: 'Save rawToken in 1Password AND as the Cloudflare worker secret EMAIL_INTAKE_TOKEN. Set tokenHash in Vercel as EMAIL_INTAKE_BEARER_HASH.',
        rawToken,
        tokenHash
      },
      null,
      2
    )
  );
}

main();
