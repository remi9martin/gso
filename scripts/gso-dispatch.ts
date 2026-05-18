#!/usr/bin/env -S npx tsx
//
// scripts/gso-dispatch.ts
//
// CLI wrapper around lib/dispatch.dispatch(). Reads PAPERCLIP_API_URL,
// PAPERCLIP_API_KEY, PAPERCLIP_COMPANY_ID from process env and loads the
// sibling key from GSO_DISPATCHER_KEY_<TARGET_COMPANY_ID>.
//
// Usage:
//   npx tsx scripts/gso-dispatch.ts <sourceIssueId> <targetCompanyId>
//
// Refuses to run unless the source issue has a `dispatch-authorized: true`
// document. The sibling key value is never echoed to stdout/stderr — only
// the env var name is referenced in any output.

import { dispatch } from '../lib/dispatch';

async function main(): Promise<void> {
  const [, , sourceIssueId, targetCompanyId, ...rest] = process.argv;
  if (!sourceIssueId || !targetCompanyId || rest.length > 0) {
    process.stderr.write(
      'usage: gso-dispatch <sourceIssueId> <targetCompanyId>\n' +
        '       sibling key must be available in env as GSO_DISPATCHER_KEY_<COMPANY_ID>.\n'
    );
    process.exit(2);
  }

  try {
    const result = await dispatch(sourceIssueId, targetCompanyId);
    // Only identifiers, never tokens.
    process.stdout.write(
      JSON.stringify(
        {
          mirrorIssueId: result.mirrorIssueId,
          mirrorIdentifier: result.mirrorIdentifier,
          mirrorCompanyId: result.mirrorCompanyId,
          mirrorIssueUrl: result.mirrorIssueUrl
        },
        null,
        2
      ) + '\n'
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`dispatch failed: ${message}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`dispatch crashed: ${message}\n`);
  process.exit(1);
});
