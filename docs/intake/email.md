# Email intake — Cloudflare Email Routing → `/api/intake/email`

GSO-126 ships the always-on email channel. Forward any email to a dedicated
inbox; within seconds it becomes a Draft in the Intake project, triagable
alongside `/intake` UI captures and `/api/intake` bearer-token submissions.

## Address

- **Production:** `intake@damgsolutions.com`
- Dedicated mailbox, not an alias on a primary inbox. CEO decision logged on
  GSO-126: a busted parser fails in isolation, and the From-domain is a clean
  signal for the L1.3 normalizer.

## Topology

```
Sender ─► Cloudflare Email Routing ─► email-intake Worker ─► POST /api/intake/email
                                                                   │
                                                                   ▼
                                       intake_payloads (raw)  ─►  L1.3 normalizer  ─►  Draft issue (Intake project)
```

1. **DNS / Cloudflare Email Routing** receives mail for the routed address.
2. **`workers/email-intake`** runs on the `email()` event. It:
   - parses the MIME body with `postal-mime`,
   - reads `Authentication-Results` for SPF/DKIM/DMARC,
   - hard-rejects forgery (`spf=fail`, `dkim=fail`, or `dmarc=fail`),
   - POSTs a JSON envelope to `/api/intake/email` with a bearer token.
3. **`POST /api/intake/email`** double-checks auth results, validates the
   envelope, persists the raw payload (`intake_payloads.kind = 'email'`), runs
   the L1.3 normalizer, and creates the Draft issue with idempotency keyed on
   the canonical payload hash.

## Setup

### 1. DNS (Cloudflare)

Add Cloudflare Email Routing for `damgsolutions.com`. The dashboard provisions
the MX + TXT records automatically.

Verify the following are in place after Cloudflare provisioning:

- `MX  damgsolutions.com  →  isaac.mx.cloudflare.net / linda.mx.cloudflare.net / amir.mx.cloudflare.net` (priority 10/20/30; exact values from the dashboard)
- `TXT damgsolutions.com  →  "v=spf1 include:_spf.mx.cloudflare.net ~all"`
- `TXT _dmarc.damgsolutions.com  →  "v=DMARC1; p=reject; rua=mailto:dmarc@damgsolutions.com"`
- DKIM is enabled at the per-sender level; Cloudflare adds `Authentication-Results: dkim=...` headers for the worker to read. Senders to this address must publish their own DKIM.

The L1.2 threat model (`docs/intake/security.md` §3) requires SPF/DKIM/DMARC
enforcement. Both layers enforce: the worker rejects with `setReject()`, and
the API returns `550 email_auth_failed`. Either gate fails closed.

### 2. Worker deploy

```
cd workers/email-intake
npm install
npx wrangler secret put EMAIL_INTAKE_TOKEN   # paste the raw bearer token
npx wrangler deploy
```

In the Cloudflare Email Routing dashboard, set the rule for
`intake@damgsolutions.com` to deliver to the `gso-email-intake` worker.

### 3. App config

Add to the Vercel project:

```
EMAIL_INTAKE_BEARER_HASH = sha256(EMAIL_INTAKE_TOKEN)
GSO_INTAKE_EMAIL_USER_ID = <user id for email-sourced drafts; optional>
```

Generate the hash locally:

```
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" <RAW_TOKEN>
```

Rotation: regenerate the token, update both Cloudflare secret and Vercel env,
deploy in either order. The intake API only ever sees the hash; the worker
only ever holds the raw token.

## Forwarding from your inbox

The intake address accepts mail from any sender that passes SPF/DKIM/DMARC.
"Forward as attachment" is preferred — the original headers stay intact so
the venture-domain hint flows to the normalizer.

### Gmail

1. Settings → **Forwarding and POP/IMAP** → **Add a forwarding address** →
   `intake@damgsolutions.com`.
2. Confirm the verification email (it lands as the first Draft — accept it
   from the Intake inbox).
3. For one-off forwards: open the message, **More menu (⋮) → Forward as
   attachment**, send to `intake@damgsolutions.com`.
4. For automatic routing: Settings → **Filters and Blocked Addresses** →
   create a filter that matches the subset you want forwarded, action
   "Forward to" the intake address.

### iCloud / iOS Mail

1. iCloud → Settings → Mail → **Rules** → **Add a Rule** → "Forward to" the
   intake address. iCloud forwards inline; the worker handles both.
2. On iPhone / iPad: open the message, tap the reply arrow → **Forward**,
   address it to `intake@damgsolutions.com`, send. The system app strips
   most attachments by default — use Mail.app on macOS for full forwarding.

### iOS Mail (any account)

iOS Mail forwards the message body inline by default. Attachments under 10 MB
are preserved; larger attachments are dropped at the worker boundary with a
`413 attachment_too_large` response logged to Cloudflare tail.

### Other clients (Outlook, Spark, etc.)

Any "forward as attachment" path works as long as SPF/DKIM/DMARC on the
forwarding account are intact. Cloudflare's ARC support means most consumer
clients pass through cleanly, but corporate inboxes with strict DMARC may
have their forwards rejected. If you see `email_auth_failed` in the worker
tail, switch that account to "forward as attachment" instead of inline.

## Limits

| Limit                  | Value                    | Source                                             |
| ---------------------- | ------------------------ | -------------------------------------------------- |
| Plain text + HTML body | 2 MB combined            | `EMAIL_INTAKE_MAX_BODY_BYTES`                      |
| Per attachment         | 10 MB                    | shared with `/api/intake` (`MAX_ATTACHMENT_BYTES`) |
| Total envelope         | 25 MB                    | `EMAIL_INTAKE_MAX_TOTAL_BYTES`                     |
| Attachment count       | 5                        | shared (`MAX_ATTACHMENTS`)                         |
| MIME types denied      | executable list          | `lib/intake/security.ts` (`DENIED_MIME_TYPES`)     |
| Extensions denied      | `.exe`, `.sh`, `.bat`, … | `lib/intake/security.ts` (`DENIED_EXTENSIONS`)     |

## Expected latency

- **Worker run:** 200–500 ms for typical email (no large attachments).
- **API + normalizer:** 1–3 s for Claude primary; 3–6 s on Gemini fallback.
- **End-to-end:** under 60 s from send to Draft visible in the Intake project,
  per the GSO-126 acceptance criterion. A worker retry on transient API
  failure adds at most one MTA-side retry interval.

## Idempotency

The canonical payload hash in `intake_payloads` is computed from the body
(normalized line endings) plus the attachment digest list. A duplicate
forward of the same message will:

- find the existing `intake_payloads` row (`payloadCreated: false`),
- find the existing Draft issue via `rawPayloadId` front-matter
  (`draftCreated: false`),
- return `200 OK` with the existing draft id.

`Message-ID` is recorded in `source_meta.hints.messageId` for audit
correlation but is not the idempotency key — multiple forwards of the same
underlying message body are de-duplicated even when their resend-Message-ID
differs.

## Failure modes

| Code | Where | Meaning                                           | Worker behaviour            |
| ---- | ----- | ------------------------------------------------- | --------------------------- |
| 401  | API   | Worker token mismatch                             | `setReject` — message drops |
| 415  | API   | Non-JSON body or denied attachment MIME           | log + drop                  |
| 413  | API   | Body or attachment over limit                     | log + drop                  |
| 429  | API   | (Not implemented; reserved for future rate limit) | retry                       |
| 502  | API   | Paperclip API call to create draft failed         | retry                       |
| 550  | API   | SPF/DKIM/DMARC failed at the API gate             | `setReject` — message drops |

Worker-side rejection uses `message.setReject(reason)` which tells the
Cloudflare MTA to bounce. API-side `5xx` responses cause the Worker to
re-throw, which the Workers runtime translates into a retry (subject to
Cloudflare's MTA retry policy).

## Verification

End-to-end smoke test (after deploy):

```
echo "Test forward $(date)" | mail -s "GSO intake smoke" -aFrom:remi@digitaltrvst.com intake@damgsolutions.com
```

Within ~60 s, a Draft titled "Test forward ..." should appear in the Intake
project assigned to the configured email user. The Draft front-matter will
contain `sourcePointer: email:user=...,bytes=...`, and
`source_meta.hints.fromDomain = "digitaltrvst.com"`.

For local development:

```
curl -X POST http://localhost:3000/api/intake/email \
  -H "Authorization: Bearer $EMAIL_INTAKE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "Remi <remi@digitaltrvst.com>",
    "to": ["intake@damgsolutions.com"],
    "subject": "Local smoke test",
    "messageId": "<local-1@digitaltrvst.com>",
    "receivedAt": "2026-05-18T10:00:00.000Z",
    "text": "Forwarded note for local smoke testing.",
    "auth": { "spf": "pass", "dkim": "pass", "dmarc": "pass" }
  }'
```

## Related

- [GSO-123](/GSO/issues/GSO-123) — L1.1 data model (`intake_payloads`)
- [GSO-124](/GSO/issues/GSO-124) — L1.2 `/api/intake` + threat model (security gate shared)
- [GSO-125](/GSO/issues/GSO-125) — L1.3 LLM normalizer
- [GSO-126](/GSO/issues/GSO-126) — this email channel
- Plan: [GSO-116](/GSO/issues/GSO-116#document-plan)
