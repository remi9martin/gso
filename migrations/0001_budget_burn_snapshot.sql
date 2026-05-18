-- GSO-81: budget burn snapshot table for production storage.
-- Implements the persistence side of lib/canvas/burn-snapshot/postgres-store.ts.
-- See lib/canvas/burn-snapshot/types.ts for the row contract.
--
-- Idempotent: safe to re-run against an existing database.

CREATE TABLE IF NOT EXISTS budget_burn_snapshot (
  agent_id           text not null,
  date_utc           date not null,
  snapshot_at        timestamptz not null,
  month_spent_cents  int not null,
  month_budget_cents int not null,
  primary key (agent_id, date_utc)
);

CREATE INDEX IF NOT EXISTS budget_burn_snapshot_agent_date_desc_idx
  ON budget_burn_snapshot (agent_id, date_utc DESC);
