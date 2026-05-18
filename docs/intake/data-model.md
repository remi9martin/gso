# L1 CONSOLIDATOR — Intake data model

Status: shipped in GSO-123. Architecture context lives in the [GSO-116 plan](/GSO/issues/GSO-116#document-plan).

## What L1 produces

Every raw input (typed text, paste, email forward, future voice/Shortcuts) lands as **one Draft issue** in the `Intake` project plus **one append-only row** in `intake_payloads` that preserves the unparsed source.

Two surfaces, two reasons:

- The **Draft issue** is the L2 boundary — it is what Triage / Remi sees in the Intake inbox.
- The **`intake_payloads` row** is the audit trail. We keep raw bytes separate from the parsed issue so the LLM normalizer can be retried/upgraded without losing the source.

## Intake project

- Name: `Intake`
- urlKey: `intake`
- Created via `POST /api/companies/{companyId}/projects`.
- Verifiable with `GET /api/companies/{companyId}/projects`.

## `intake_payloads` table

Defined in [`migrations/0002_intake_payloads.sql`](../../migrations/0002_intake_payloads.sql).

| Column            | Type          | Notes                                                               |
| ----------------- | ------------- | ------------------------------------------------------------------- |
| `id`              | `uuid` PK     | Caller-provided; future drafts reference this as `rawPayloadId`.    |
| `kind`            | `text`        | `email` \| `capture` \| `api` (check constraint).                   |
| `payload_hash`    | `text`        | sha256 of canonical raw bytes. **UNIQUE** — drives row idempotency. |
| `body`            | `text`        | Raw blob (text / html / json) — whatever the source produced.       |
| `attachment_refs` | `jsonb`       | Array of attachment storage keys; defaults to `[]`.                 |
| `source_meta`     | `jsonb`       | Free-form (sender, subject, capture client, ip, etc.).              |
| `captured_at`     | `timestamptz` | When the source produced the payload.                               |
| `created_at`      | `timestamptz` | When we wrote the row. Defaults to `now()`.                         |

Indexes:

- `intake_payloads_payload_hash_key` (UNIQUE) — retry safety.
- `intake_payloads_captured_at_desc_idx` — recent-first browsing.

Append-only on purpose: never UPDATE/DELETE a row in service code. Reparses produce new draft issues, not in-place edits.

## Draft issue convention

A Draft is a regular Paperclip issue with a deliberate shape — **no new table**:

- `projectId` = the Intake project id.
- `assigneeUserId` = Remi (CEO) for now. A future Triage agent will take over the inbox; the field stays user-owned until then.
- `status` = `todo`.
- `description` begins with a fenced front-matter block, followed by a blank line and a one-paragraph normalized summary.

Front-matter block:

```text
---
sourcePointer: capture:client=web,bytes=412
suggestedTag: idea
suggestedNextAction: Draft outline for the AI inbox sweeper.
rawPayloadId: pl_01HXZ8K2C0DEMOPAYLOAD123456789
confidence: 0.78
---

A normalized one-paragraph summary of the raw capture.
```

| Key                   | Type   | Notes                                                                   |
| --------------------- | ------ | ----------------------------------------------------------------------- |
| `sourcePointer`       | string | Compact pointer back to the originating channel (audit trail).          |
| `suggestedTag`        | enum   | `venture` \| `project` \| `idea` \| `todo`.                             |
| `suggestedNextAction` | string | One verb-led sentence the Triage UI can offer as a one-click action.    |
| `rawPayloadId`        | string | UUID matching `intake_payloads.id`. **Drives idempotency** (see below). |
| `confidence`          | number | LLM normalizer confidence, `[0, 1]`.                                    |

Implementation: see [`lib/intake/front-matter.ts`](../../lib/intake/front-matter.ts) for `renderDraftDescription` / `parseDraftDescription`.

## Helper: `createDraftIssue`

Defined in [`lib/intake/create-draft-issue.ts`](../../lib/intake/create-draft-issue.ts). Wraps `POST /api/companies/{companyId}/issues` with the front-matter convention applied. Sends the `X-Paperclip-Run-Id` audit header when a run id is available.

### Idempotency

Idempotency runs on **two layers**, both keyed off the same canonical raw bytes:

1. **Row layer** — the writer of `intake_payloads` should `INSERT ... ON CONFLICT (payload_hash) DO NOTHING` and return the existing `id`. The unique index makes retries safe.
2. **Issue layer** — `createDraftIssue` first calls `GET /api/companies/{companyId}/issues?projectId=<intake>&q=<rawPayloadId>` and scans descriptions for the exact `rawPayloadId: <id>` front-matter line. If a match exists, the helper returns its id with `created: false` and **does not POST** a new issue.

End-to-end guarantee: the same canonical raw bytes produce the same `intake_payloads.id` and at most one Draft issue, no matter how many times the L1 pipeline retries.

### Why scan descriptions instead of a side table

Paperclip issues don't have user-defined columns. A separate `intake_drafts` mapping table would re-implement state that is already in the issue description and create a second source of truth to keep in sync (and to migrate when the normalizer changes). The current scan is bounded by `projectId=intake` and the `q` search, so the cost stays low — and the description is the durable record either way.

If the Intake project grows beyond what `q` search can resolve quickly we can add an index — `intake_payloads.draft_issue_id` (nullable, set after the first successful create) — without changing the helper's public surface.

## Verification

- `pnpm test intake/data-model` exercises the front-matter round-trip, the create path, idempotency, and the "incidental text mention" non-match case.
- Smoke against the live company: `GET /api/companies/{companyId}/projects` lists `Intake`, and after L1.2 lands, a sample capture produces one row in `intake_payloads` and one Draft issue in the Intake project.
