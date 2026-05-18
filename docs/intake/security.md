# L1 CONSOLIDATOR — Public ingress threat model

Status: v0 — covers the surface shipped in [GSO-124](/GSO/issues/GSO-124). Aligns with the locked CEO decisions on that issue.

Scope: `POST /api/intake` (public bearer-token endpoint) and the `/intake` capture UI (same-origin server action). Email ingestion ([GSO-126](/GSO/issues/GSO-126)) and the LLM normalizer ([GSO-125](/GSO/issues/GSO-125)) ride on this surface; their specific risks are flagged here but their full threat models live on those issues.

This document is the **merge gate** for L1.2 per the CEO ask. The CTO [@CTO](/GSO/agents/cto) reviews and the CEO [@CEO](/GSO/agents/ceo) signs off before this branch merges.

## 1. Authentication

### Mechanism

- **External callers** (`curl`, future agents, the email-receiver in L1.4): `Authorization: Bearer gso_intake_<base64url-32-bytes>`.
- **In-app `/intake` UI**: a Next.js server action invokes the same `processIntake()` pipeline in trusted server context. No token is exposed to the browser. This satisfies the "authenticated via the existing Paperclip session — no separate login" requirement on GSO-124 without inventing a session protocol the rest of the app doesn't have yet.

### Token storage

- Per the CEO decision on GSO-124, tokens live in **1Password** for v1. We do **not** wire a Paperclip-managed secret store until a second consumer exists.
- Server-side, only the **sha256 hash** is persisted (`intake_api_tokens.token_hash`, UNIQUE). The raw token is shown to the user **once** at creation time by `scripts/intake/mint-token.ts`.
- One **active** token per user is enforced by a partial unique index (`intake_api_tokens_user_active_key`). Revoked rows are retained for audit.

### Rotation and leak response

- **Routine rotation**: Remi mints a new token, replaces the 1Password entry, and revokes the prior token via `POST /api/intake/tokens/:id/revoke` (follow-up issue: this endpoint is not in L1.2 — it ships when a second consumer needs it; in v1 Remi revokes via direct DB UPDATE).
- **Leaked token**: revoke the row immediately (`revoked_at = now()`). Auth fails with `token_revoked` (401). The audit trail in `intake_payloads.source_meta` lets us reconstruct what was posted under the leaked token; reverse a posted draft by changing its status to `cancelled` — never delete an `intake_payloads` row.
- **Blast radius of a leak**: a leaked token can create Draft issues in the Intake project **only**. It cannot read other Paperclip data, mutate agents, run code, or spend budget. This is enforced by the token never carrying a Paperclip API key — `processIntake()` calls the Paperclip API using the server's own `PAPERCLIP_API_KEY` from env, not a credential derived from the user token.

### Threats and mitigations

| Threat                                                       | Mitigation                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replay of a sniffed token                                    | Auth runs over HTTPS (Vercel-terminated TLS). Tokens have no expiry in v1; rotate manually.                                                                                                                                                                         |
| Brute force                                                  | Token entropy = 32 random bytes = 256 bits. The rate limit (Section 2) caps online guesses at 10/min per `userId` — but unknown tokens can't be tied to a user, so they fall on a separate global bucket (`anonymous`); follow-up: add a per-IP failed-auth bucket. |
| Token logging                                                | Bearer tokens are never written to logs. The authentication path only logs `tokenId` (a UUID) after a successful match.                                                                                                                                             |
| Stolen disk image leaks plaintext tokens                     | Only sha256 hashes are persisted. The token cannot be reconstructed from a hash.                                                                                                                                                                                    |
| Cross-tenant access (future)                                 | This v0 is single-company. When multi-company lands, `intake_api_tokens.company_id` will be added; the route enforces token-company match.                                                                                                                          |
| Server-action abuse (someone else triggering submitIntakeUi) | The server action runs only on same-origin POSTs from a Next-issued page render. v0 deploys behind Vercel; future multi-user deployments must add CSRF tokens to the form. Today there is only Remi.                                                                |

## 2. Rate limiting and abuse

### Limits

- **10 requests / minute / user** on `/api/intake`, sliding window.
- **10 requests / minute / UI session** for `submitIntakeUi`, keyed on the configured `uiUserId`.
- **10 requests / minute / route** on `/api/intake/email`, sliding window on a single static `email-worker` bucket (the worker is single-tenant; per-token segmentation would be cosmetic). The limiter runs **before** bearer auth so brute-force probing and an authenticated flood from a leaked token both fall on the same cap. The bucket is a separate singleton from `/api/intake`, so an email flood cannot lock out bearer-token traffic and vice-versa.
- Configured in `lib/intake/rate-limit.ts` (`DEFAULT_INTAKE_RATE_LIMIT`).

### Behavior when triggered

- Returns **HTTP 429** with `Retry-After: <seconds>` (an integer derived from the window edge) and `X-RateLimit-Limit`/`X-RateLimit-Remaining`/`X-RateLimit-Reset` headers.
- The blocked request does **not** consume payload storage — the limiter runs before the parser, so an attacker cannot fill `intake_payloads` past the rate cap.

### Logging

- Allowed and denied decisions both log to stdout via `console.log` at the route handler. Operator dashboards (future GSO Triage UI work) ingest from Vercel logs. v0 has no separate metrics emitter; this is documented and intentional for the single-user MVP.

### Threats and mitigations

| Threat                                   | Mitigation                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storm of valid tokens to exhaust storage | 10/min × 1 token = 14,400 rows / day per token. Combined with the 1 MB body cap, daily ceiling is ~14 GB which is far below any realistic free Postgres tier limit. We'd notice in burn metrics long before that.                                                         |
| Storm of invalid bearer tokens           | Same 10/min limit applies, keyed on a constant `anonymous` bucket today. **Known gap**: a single IP can flood the anonymous bucket and lock out other anonymous attempts. Follow-up issue: per-IP bucket for unauth requests.                                             |
| Slowloris / hung connection              | Vercel terminates Node functions at the platform max (10s by default). No long-poll surface on this route.                                                                                                                                                                |
| Replica drift                            | The limiter is **in-process**. Multi-replica deploys would let an attacker get N× the limit. v0 runs on a single Vercel function instance per region; if we scale to multi-region we must move the limiter to Redis/upstash. Documented as a v0 limitation, not a defect. |

## 3. Email forgery (downstream of L1.4)

`/api/intake` is the shared sink for the email-to-issue receiver ([GSO-126](/GSO/issues/GSO-126)). Forgery is checked **upstream** of this endpoint and re-checked at the webhook:

- The Cloudflare Email Worker (per the GSO-116 architecture) evaluates **SPF, DKIM, and DMARC** on inbound mail and forwards the result to `/api/intake/email`. The Worker carries a Paperclip-scoped intake token bound to the receiver's identity; that token is rate-limited like any other.
- **Policy** (enforced in `lib/intake/email-handler.ts`): explicit SPF/DKIM/DMARC `fail` results are **rejected with 5xx**, which causes the originating MTA to give up cleanly (and re-gates a worker bypass). `pass` and `none` are accepted. `neutral`, `softfail`, and `temperror` are **accepted with the auth verdict preserved in `source_meta.hints.authResults`** so the normalizer (and any later audit) can see the soft signal rather than have it silently discarded.
- This is intentionally permissive for soft-fails because most forwarded mail (Gmail → external, "forward as attachment", auto-forwarders) breaks SPF alignment in ways that don't represent real forgery — a hard policy would reject Remi's own forwards. Soft-fails escalate when the normalizer assigns low confidence; explicit `fail` never reaches the normalizer.

### Trust boundary acknowledged here

- Once mail clears the Worker, the body lands in `intake_payloads` and the LLM normalizer ([GSO-125](/GSO/issues/GSO-125)) reads it. The normalizer must treat email bodies as **untrusted text**: no prompt-injection-driven tool calls, no agent assignment writes derived from email content. L1.3's threat model owns this in detail; this document records the boundary for completeness.
- The audit row preserves the verified envelope sender (`source_meta.sender`) so a downstream reader can distinguish "from Remi" from "claiming to be Remi". The Worker's DMARC check is what makes that claim trustworthy.

## 4. Payload size cap and content-type allowlist

### Limits (see `lib/intake/security.ts`)

| Surface           | Limit          |
| ----------------- | -------------- |
| Free-form body    | **1 MB UTF-8** |
| Single attachment | **10 MB**      |
| Total multipart   | **12 MB**      |
| Attachments / req | **5**          |

### Content-type policy

- **Allowed entry MIME types**: `application/json`, `multipart/form-data`, `text/plain`. All others → 415.
- **Attachment MIME deny-list**: executables (PE/ELF/Mach-O), shell scripts, Java archives, installer images, ISO/IMG. See `DENIED_MIME_TYPES` in `lib/intake/security.ts`.
- **Attachment extension deny-list**: any of `.exe .dll .so .dylib .bat .cmd .com .msi .scr .ps1 .psm1 .sh .bash .zsh .fish .app .jar .war .pkg .deb .rpm .iso .img .vbs .vbe .js .mjs .cjs .wsf .wsh .hta .lnk`. The extension check runs independently of the MIME type — so a `.sh` file uploaded as `application/octet-stream` is still rejected.

### Denial behavior

- Size violations: **HTTP 413** with a JSON `{error, message}` body that names the limit hit. No part of the payload is stored.
- MIME/extension violations: **HTTP 415** with the same body shape. No part of the payload is stored.

### Threats and mitigations

| Threat                                             | Mitigation                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drive-by malware upload (intake as malware vector) | MIME + extension deny-list; raw bytes never auto-execute on the server. Attachments are stored as inline storage keys; they are not unpacked.     |
| Storage exhaustion via giant uploads               | Per-request and per-attachment hard caps; total cap covers multipart aggregation. The parser short-circuits before draining the request body.     |
| MIME spoofing                                      | Extension check runs in addition to MIME. We do not sniff content yet — follow-up to add `file-type` sniffing for high-risk extensions if needed. |
| Zip-bomb / pdf-bomb                                | We do not decompress or render attachments server-side. They are stored as opaque blobs; rendering is the consumer's responsibility.              |

## 5. Audit trail and source-pointer integrity

### What is recorded

For every accepted request, two persistent records are written:

1. **`intake_payloads`** (the raw audit row):

   - `id` — UUID, becomes the front-matter `rawPayloadId`.
   - `payload_hash` — sha256 of canonical body + attachment digest. UNIQUE; provides retry-safe row-layer idempotency.
   - `body` — raw bytes as received (UTF-8 normalized to `\n`). Append-only.
   - `attachment_refs` — array of opaque storage keys.
   - `source_meta` — userId, kind, client, ip, userAgent, attachment metadata.
   - `captured_at` + `created_at` — both stored separately so a delayed write doesn't lie about when the user actually captured.

2. **Draft issue front-matter** (the parsed view):
   - `sourcePointer` — compact, human-readable pointer back to the audit row (`api:user=...,bytes=...`).
   - `rawPayloadId` — the UUID linking back to `intake_payloads.id`.

### Integrity model

- The audit row is **append-only**. Service code must never UPDATE or DELETE rows in `intake_payloads`; reparses produce a new Draft, not an edit.
- `payload_hash` is sha256 over canonical bytes. It is **content-bound** — any tampering with `body` invalidates the hash. A future hardening step is to additionally sign the row at write time with a server-side HMAC key; the current single-tenant deploy doesn't justify the extra moving part, but the column slot exists conceptually.
- The Draft issue's `sourcePointer` is plain text on purpose: it is a navigational pointer, not a security claim. The security claim is `rawPayloadId` + the matching `intake_payloads` row.

### Retention

- `intake_payloads` rows are kept **indefinitely** for v1. The total size ceiling per Section 2 means storage is not a concern at our current scale.
- If a row contains content that must be removed (GDPR DSAR, accidental secrets), we **redact in place by setting `body = '[redacted: <reason>] <hash-of-original>'`** rather than deleting — to preserve the audit chain. Redaction code does not exist yet; document the policy now, ship the helper when the first request comes in.

### Logging vs storage

- The raw `body` is **never** written to operator logs. The log emits only `text(len=N,lines=M)` and the request's `userId`, `kind`, `rawPayloadId`, and `bodyShape` (`describePayloadForLog` in `lib/intake/security.ts`).
- A test (`tests/intake/api.test.ts` → "does not leak the raw body into the log shape descriptor") asserts this property: a known secret in the body never appears in the log output captured from the handler.

## 6. Known gaps (v0)

These are intentionally not in scope for L1.2 but recorded so they don't fall off the radar:

- Per-IP failed-auth bucket — needed once `/api/intake` is exposed beyond Remi's own usage.
- CSRF tokens on the `/intake` UI form — needed if the UI is ever shared with non-Remi users on the same origin.
- Postgres adapters for `intake_payloads` and `intake_api_tokens` — v0 uses in-memory singletons in the deployed Next process; sufficient for the single-user MVP because Vercel's serverless cold starts are rare during interactive use and the issue thread itself doubles as the durable record. Postgres adapters land in a follow-up issue and reuse the `@neondatabase/serverless` pattern from `lib/canvas/burn-snapshot/postgres-store.ts`.
- Distributed rate limiter — needed for multi-region or autoscale deploys.
- Real content sniffing for attachments — extension+MIME today; `file-type`-style magic-byte sniffing if attachments become a richer surface.

## 7. Reviewer sign-off

- CTO ([@CTO](/GSO/agents/cto)) — please verify the deny-lists and the audit-trail claims by reading `lib/intake/security.ts` + `lib/intake/intake-service.ts` and confirm the tests in `tests/intake/api.test.ts` cover the rate-limit + attachment guards.
- CEO ([@CEO](/GSO/agents/ceo)) — please sign off that the trade-offs in Section 6 are acceptable for v0 launch, especially:
  - In-memory token store + rate limiter (single Vercel instance, follow-up to move to Postgres/Redis).
  - 1Password as the rotation store; no Paperclip-managed secret manager yet.

A `request_confirmation` interaction will be opened on GSO-124 referencing this document as the gate. Implementation is complete; merge waits on CEO acceptance.
