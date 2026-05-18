-- GSO-123: append-only raw-payload table for the L1 CONSOLIDATOR intake pipeline.
-- Pairs with the Paperclip "Intake" project (urlKey: intake) and the
-- createDraftIssue helper in lib/intake/create-draft-issue.ts.
--
-- Idempotency model:
--   - payloadHash is sha256 of canonical raw bytes; it is UNIQUE so the same
--     source bytes can be retried safely without producing duplicate rows.
--   - The issue side of the draft is idempotent via the rawPayloadId front-matter
--     field — see docs/intake/data-model.md.
--
-- Idempotent migration: safe to re-run.

CREATE TABLE IF NOT EXISTS intake_payloads (
  id              uuid primary key,
  kind            text not null check (kind in ('email', 'capture', 'api')),
  payload_hash    text not null,
  body            text not null,
  attachment_refs jsonb not null default '[]'::jsonb,
  source_meta     jsonb not null default '{}'::jsonb,
  captured_at     timestamptz not null,
  created_at      timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS intake_payloads_payload_hash_key
  ON intake_payloads (payload_hash);

CREATE INDEX IF NOT EXISTS intake_payloads_captured_at_desc_idx
  ON intake_payloads (captured_at DESC);
