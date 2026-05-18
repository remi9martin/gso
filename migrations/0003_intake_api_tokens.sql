-- GSO-124: personal API tokens for /api/intake.
--
-- Only the sha256 hash is persisted; the raw token is shown to the user once
-- at creation time (e.g. via scripts/intake/create-token.ts) and stored by
-- the user in 1Password per the CEO decision on GSO-124. We do not wire a
-- Paperclip-managed secret store until a second consumer needs it.
--
-- Tokens are scoped to /api/intake only — see lib/intake/api-tokens.ts.
-- Idempotent migration: safe to re-run.

CREATE TABLE IF NOT EXISTS intake_api_tokens (
  id            uuid primary key,
  user_id       text not null,
  label         text not null,
  token_hash    text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS intake_api_tokens_token_hash_key
  ON intake_api_tokens (token_hash);

-- One active token per user. Revoked tokens are kept for audit; the partial
-- index ignores them so a user can rotate by issuing a new one.
CREATE UNIQUE INDEX IF NOT EXISTS intake_api_tokens_user_active_key
  ON intake_api_tokens (user_id)
  WHERE revoked_at IS NULL;
