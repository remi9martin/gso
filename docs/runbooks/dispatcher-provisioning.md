# Runbook — Dispatcher Provisioning

**Issue:** [GSO-141](/GSO/issues/GSO-141) — L4 child of [GSO-120](/GSO/issues/GSO-120) (Cross-Company Dispatch Bridge).
**Owner:** CTO. **Status:** v1. **Last desk-checked:** 2026-05-18 against `http://127.0.0.1:3101`.
**Blast radius:** Two-way door — pure documentation. No production state is written from this runbook; it tells humans + the CEO what to do once per sibling company.

---

## What this runbook is for

The cross-company dispatch bridge (see [design](/GSO/issues/GSO-120#document-design)) writes mirror issues into a sibling Paperclip company by authenticating as a thin **Dispatcher agent** that lives inside that company. The dispatcher's API key is held as a GSO-side secret.

This is the one-time setup you do per sibling company before GSO's Triage agent can dispatch into it. Repeat once per target.

Order matters. Each section is a hard prereq for the next.

---

## 0. Inputs you need before starting

| Input | Where it comes from | Notes |
|---|---|---|
| `SIBLING_NAME` | Board decision | Human name of the target company, e.g. `Remi Holdings`. |
| `SIBLING_PREFIX` | Board decision | 2–6 letter issue prefix, e.g. `RH`. Must not collide with an existing company prefix. |
| `SIBLING_BUDGET_CENTS` | Board decision | Monthly budget cap. |
| `GSO_COMPANY_ID` | Constant | `ffc4f197-df86-4291-8992-fbd8a324bdce` (this company). |
| Board-credentialed API key | Board console | Required for sections 1, 2 (option A), and 3. Agent keys are rejected with `403 Board access required`. |

Set them in your shell once:

```bash
export PAPERCLIP_API_URL="http://127.0.0.1:3101"      # local dev — replace for prod
export BOARD_API_KEY="<board-key>"                     # board console
export GSO_COMPANY_ID="ffc4f197-df86-4291-8992-fbd8a324bdce"
export SIBLING_NAME="Remi Holdings"
export SIBLING_PREFIX="RH"
export SIBLING_BUDGET_CENTS=20000
```

---

## 1. Pre-flight — does the sibling company exist?

Agents cannot list companies (`GET /api/companies` → `403 Board access required`, confirmed 2026-05-18). Use a board credential.

```bash
curl -s -H "Authorization: Bearer $BOARD_API_KEY" \
  "$PAPERCLIP_API_URL/api/companies" \
  | jq -r '.[] | select(.name == env.SIBLING_NAME) | .id'
```

- **Returns a UUID** → record it as `SIBLING_COMPANY_ID`, skip to section 2.
- **Returns nothing** → the company does not exist. Create it:

```bash
curl -s -X POST -H "Authorization: Bearer $BOARD_API_KEY" \
  -H "Content-Type: application/json" \
  "$PAPERCLIP_API_URL/api/companies" \
  -d '{
    "name": "'"$SIBLING_NAME"'",
    "issuePrefix": "'"$SIBLING_PREFIX"'",
    "budgetMonthlyCents": '"$SIBLING_BUDGET_CENTS"'
  }' | jq
```

Capture the returned `id` as `SIBLING_COMPANY_ID`. This is a board-user action — `POST /api/companies` is gated to board-level principals (confirmed by the agent-token probe returning 403).

```bash
export SIBLING_COMPANY_ID="<uuid-from-response>"
```

**Stop-condition for the rest of this runbook:** if `SIBLING_COMPANY_ID` is unset, do not proceed.

---

## 2. Provision the sibling-side Dispatcher agent

This agent lives inside the sibling company and is the principal that signs every cross-company write. **Required capabilities:** create issues, post comments, write documents. **Forbidden:** `canCreateAgents`, budget admin, membership admin.

There are two equivalent ways to create it; pick the one that matches who you have in the room.

### Option A — Board-direct (fastest)

```bash
curl -s -X POST -H "Authorization: Bearer $BOARD_API_KEY" \
  -H "Content-Type: application/json" \
  "$PAPERCLIP_API_URL/api/companies/$SIBLING_COMPANY_ID/agents" \
  -d '{
    "name": "GSO Dispatcher",
    "role": "system",
    "title": "Cross-company dispatch endpoint",
    "capabilities": "Receives dispatched issues from GSO Triage. Creates the mirror issue in this company and writes dispatch-metadata documents. Does not initiate work.",
    "adapterType": "system_api",
    "permissions": { "canCreateAgents": false },
    "runtimeConfig": { "heartbeat": { "enabled": false, "maxConcurrentRuns": 1 } },
    "budgetMonthlyCents": 0
  }' | jq
```

Capture the returned `id` as `DISPATCHER_AGENT_ID`.

### Option B — Through the sibling company's CEO

If the sibling already has a CEO agent who has run their strategy approval, ask that CEO to use the `paperclip-create-agent` skill to draft a `GSODispatcher` agent with the same constraints. The CEO's `paperclip-create-agent` flow handles the hire request and any company-policy approval.

### Hard checks after creation

```bash
curl -s -H "Authorization: Bearer $BOARD_API_KEY" \
  "$PAPERCLIP_API_URL/api/agents/$DISPATCHER_AGENT_ID" \
  | jq '{ name, role, runtimeHeartbeat: .runtimeConfig.heartbeat, permissions, budget: .budgetMonthlyCents }'
```

Must show:

- `runtimeConfig.heartbeat.enabled = false` — the dispatcher only acts on demand.
- `permissions.canCreateAgents = false` — no hiring, no escalation surface.
- `budgetMonthlyCents = 0` — no autonomous spend; key-driven calls do not require budget.

If any of these are wrong, `PATCH /api/agents/$DISPATCHER_AGENT_ID` to fix before continuing. Do not skip.

---

## 3. Mint the long-lived API key

`POST /api/agents/:agentId/keys` is board-only (`403 Board access required` for agent tokens, confirmed). The full key value is **shown once** in the response — there is no recovery path if you lose it.

```bash
curl -s -X POST -H "Authorization: Bearer $BOARD_API_KEY" \
  -H "Content-Type: application/json" \
  "$PAPERCLIP_API_URL/api/agents/$DISPATCHER_AGENT_ID/keys" \
  -d '{
    "label": "gso-dispatcher-'"$(date -u +%Y%m%d)"'",
    "expiresInDays": 90
  }' | jq
```

Capture `key` from the response **immediately**. Do not log it, do not paste it into a comment, do not write it to a file that lives outside the secrets store.

```bash
export DISPATCHER_KEY="<value-from-response>"
```

> **Rotation timing.** The 90-day expiry is intentional — it pairs with the quarterly rotation routine in section 6. Each rotation re-runs this section, replaces the GSO secret in section 4, then deletes the prior key.

---

## 4. Store the key as a GSO secret

The key lives in GSO's secret store (`POST /api/companies/:companyId/secrets`, board-only — agent token probe returned 403). Name the secret by **the sibling's UUID**, not its human name — companies can be renamed but their UUID is stable, so this prevents accidental collisions if `Remi Holdings` ever becomes `RH Inc.`.

```bash
curl -s -X POST -H "Authorization: Bearer $BOARD_API_KEY" \
  -H "Content-Type: application/json" \
  "$PAPERCLIP_API_URL/api/companies/$GSO_COMPANY_ID/secrets" \
  -d '{
    "name": "dispatcher_key_'"$SIBLING_COMPANY_ID"'",
    "description": "Long-lived API key for the GSODispatcher agent in '"$SIBLING_NAME"' ('"$SIBLING_COMPANY_ID"'). Used by GSO Triage to write mirror issues. Quarterly rotation per [GSO-141](/GSO/issues/GSO-141).",
    "value": "'"$DISPATCHER_KEY"'"
  }' | jq '{ id, name, description, createdAt }'
```

The response **must not** echo the secret value. If you see the literal `DISPATCHER_KEY` value in the response JSON, the secrets endpoint is broken — stop and file a platform issue before continuing.

Verify by listing:

```bash
curl -s -H "Authorization: Bearer $BOARD_API_KEY" \
  "$PAPERCLIP_API_URL/api/companies/$GSO_COMPANY_ID/secrets" \
  | jq '.[] | select(.name | startswith("dispatcher_key_")) | { name, createdAt }'
```

Then immediately unset the shell variable to limit blast radius if your shell history leaks:

```bash
unset DISPATCHER_KEY
```

The GSO dispatch script ([GSO-140](/GSO/issues/GSO-140)) reads the key by name at call time.

---

## 5. Wire the `dispatch_authorized` gate state

Per CEO verdict #3 on [GSO-120](/GSO/issues/GSO-120#comment-6aa3ad14-f9c9-4f86-9eec-5e93161fedae): every cross-company dispatch needs an explicit per-issue marker. **Default: closed.** The dispatcher script ([GSO-140](/GSO/issues/GSO-140)) must refuse to send if the marker is missing.

**Where the marker lives:** as a key on the source issue's `dispatch-metadata` document.

```yaml
# document key: dispatch-metadata on the GSO source issue
dispatchAuthorized: true
authorizedBy: triage-agent | board | <agent-id>
authorizedAt: 2026-05-18T17:30:00Z
authorizedReason: "Triage routed: source budget covered, target capacity confirmed"
```

**Who can flip it open:**

- **Triage agent**, via its routing playbook ([GSO-117](/GSO/issues/GSO-117)) — sets `authorizedBy: triage-agent` after the routing decision passes its checks.
- **Board**, by direct comment on the source issue or by issuing a `request_confirmation` interaction with `target.key = "dispatch-metadata"`. Sets `authorizedBy: board`.

**Who reads it:** the dispatcher script in [GSO-140](/GSO/issues/GSO-140) — `PUT` to the document is a no-op for closed→closed; the script asserts `dispatchAuthorized === true` before calling `POST /api/companies/$SIBLING/issues`.

**Audit:** the script writes a back-reference comment on the source issue immediately after each successful dispatch, linking to the mirror. The pair `(dispatch-metadata.dispatchAuthorized, back-reference comment)` is the full audit trail per dispatch.

---

## 6. Rotation calendar — create a quarterly reminder routine

Per CEO verdict #4: rotate keys quarterly, with a reminder fired 7 days before expiry. The agent that runs this routine assigns rotation work to the CTO.

The dispatcher key minted in section 3 has `expiresInDays: 90`. Compute the reminder anchor: `mintDate + 83 days`.

### Routine + trigger

```bash
# Create the routine
ROUTINE_RESPONSE=$(curl -s -X POST -H "Authorization: Bearer $BOARD_API_KEY" \
  -H "Content-Type: application/json" \
  "$PAPERCLIP_API_URL/api/companies/$GSO_COMPANY_ID/routines" \
  -d '{
    "title": "Rotate dispatcher key — '"$SIBLING_NAME"'",
    "description": "Quarterly reminder to rotate the GSO Dispatcher API key for '"$SIBLING_NAME"' (UUID '"$SIBLING_COMPANY_ID"'). Fires 7 days before the 90-day expiry. Each run creates a CTO-assigned rotation issue that walks sections 3 and 4 of docs/runbooks/dispatcher-provisioning.md.",
    "assigneeAgentId": "ce66203b-d725-4cf2-a5c3-4c19c47d997c",
    "priority": "high",
    "status": "active",
    "concurrencyPolicy": "skip_if_active",
    "catchUpPolicy": "enqueue_missed_with_cap"
  }')

ROUTINE_ID=$(echo "$ROUTINE_RESPONSE" | jq -r .id)

# Add the schedule trigger. Cron fires every 3 months at 09:00 America/New_York
# on day-of-month chosen as (mint day-of-month - 7) clamped to [1, 28].
# Example: minted on the 18th → reminder day 11. Substitute MINT_REMINDER_DOM
# at provisioning time.
MINT_REMINDER_DOM=11

curl -s -X POST -H "Authorization: Bearer $BOARD_API_KEY" \
  -H "Content-Type: application/json" \
  "$PAPERCLIP_API_URL/api/routines/$ROUTINE_ID/triggers" \
  -d '{
    "kind": "schedule",
    "label": "quarterly-rotation",
    "cronExpression": "0 9 '"$MINT_REMINDER_DOM"' */3 *",
    "timezone": "America/New_York"
  }' | jq
```

### Rotation issue template that the routine creates

Each fire creates an execution issue assigned to the CTO. The execution issue's title and body come from the routine — set the routine's `description` so the body is self-contained:

```markdown
## Rotate dispatcher key — <SIBLING_NAME>

The 90-day dispatcher key for **<SIBLING_NAME>** (`<SIBLING_COMPANY_ID>`) expires within 7 days.

### Acceptance

- [ ] Mint a new key: section 3 of `docs/runbooks/dispatcher-provisioning.md`.
- [ ] Replace the GSO secret value: `PATCH /api/secrets/<secretId>` (creates a new version; old version invalidated).
- [ ] Delete the previous key from the dispatcher agent: `DELETE /api/agents/<DISPATCHER_AGENT_ID>/keys/<oldKeyId>`.
- [ ] Smoke-test one dummy dispatch (section 7 of this runbook).
- [ ] Comment on this issue with the new `expiresAt` so the next quarterly reminder is calendared.

### Blast radius

🚪 **One-way door per rotation step** — invalidating the old key is irreversible. Mint the new key, update the secret, run the smoke, *then* delete.
```

> **Why this cron, why not "fire once 7 days before expiry":** Paperclip schedule triggers are pure cron (`POST /api/routines/:id/triggers` with `kind: schedule, cronExpression`), so absolute one-shot dates are not expressible. The pragmatic v0 stance: one quarterly fire per sibling, anchored to the mint day-of-month minus 7. v1 (after rotation friction shows up) can switch to a per-key one-shot reminder if Paperclip adds that primitive.

---

## 7. Smoke test — end-to-end dummy dispatch

This is the minimum verification that the secret loads, the key authenticates against the sibling, and the mirror issue lands. **Do not skip.** A bad provisioning that smoke-passes is a much smaller blast radius than a bad provisioning that ships to a real dispatch.

```bash
# Re-read the key from the GSO secret store (board-only).
DISPATCHER_KEY=$(curl -s -H "Authorization: Bearer $BOARD_API_KEY" \
  "$PAPERCLIP_API_URL/api/companies/$GSO_COMPANY_ID/secrets" \
  | jq -r '.[] | select(.name == "dispatcher_key_'"$SIBLING_COMPANY_ID"'") | .value')

# 1. Write a dummy issue into the sibling using the dispatcher key
DUMMY_RESPONSE=$(curl -s -X POST -H "Authorization: Bearer $DISPATCHER_KEY" \
  -H "Content-Type: application/json" \
  "$PAPERCLIP_API_URL/api/companies/$SIBLING_COMPANY_ID/issues" \
  -d '{
    "title": "DUMMY — dispatcher provisioning smoke test (delete me)",
    "description": "Smoke test for [GSO-141](/GSO/issues/GSO-141) provisioning. Safe to archive immediately.",
    "priority": "low",
    "status": "backlog"
  }')

DUMMY_ID=$(echo "$DUMMY_RESPONSE" | jq -r .id)
echo "Mirror issue: $DUMMY_ID"

# 2. Verify the mirror exists and is assigned correctly
curl -s -H "Authorization: Bearer $DISPATCHER_KEY" \
  "$PAPERCLIP_API_URL/api/issues/$DUMMY_ID" \
  | jq '{ id, identifier, title, status, assigneeAgentId }'

# 3. Archive it immediately — cancelled is terminal and reversible by board
curl -s -X PATCH -H "Authorization: Bearer $DISPATCHER_KEY" \
  -H "Content-Type: application/json" \
  "$PAPERCLIP_API_URL/api/issues/$DUMMY_ID" \
  -d '{ "status": "cancelled", "comment": "Dispatcher provisioning smoke test — archiving immediately." }' | jq

# 4. Burn the local copy of the key
unset DISPATCHER_KEY
```

**Pass criteria:**

- Step 1 returns a `201`-class response with a real issue UUID.
- Step 2 shows the mirror in the sibling company with the dispatcher as `createdByAgentId`.
- Step 3 returns `200` with `status = "cancelled"`.

If any step returns `403`, the key is wrong or the dispatcher agent's permissions are too narrow — revisit section 2.
If step 1 returns `404`, the `SIBLING_COMPANY_ID` is wrong.

---

## Remi Holdings provisioning checklist (first real target)

Remi Holdings is the first real dispatch target per CEO verdict #2 on [GSO-120](/GSO/issues/GSO-120). Use this section as a literal checklist when wiring Remi Holdings:

- [ ] **§1 pre-flight.** Run the company-list query. As of 2026-05-18, Remi Holdings does **not** yet exist in the local Paperclip instance — expect the empty result and proceed to the `POST /api/companies` step. The board user (Remi) executes this.
- [ ] **§1 create.** Use `name = "Remi Holdings"`, `issuePrefix = "RH"`, `budgetMonthlyCents` = board-decided. Record `SIBLING_COMPANY_ID`.
- [ ] **§2 dispatcher.** Use Option A (board-direct) for the first run — Remi Holdings will not have its own CEO agent on day one.
- [ ] **§3 key.** Capture the value once. Do not paste into Slack, Linear, or any other system. Straight into §4.
- [ ] **§4 secret.** Name = `dispatcher_key_<RH-uuid>`. Verify the secret-list response does not echo the value.
- [ ] **§5 gate.** Default closed. Triage routing playbook ([GSO-117](/GSO/issues/GSO-117)) is the only automated opener at v0; until that lands, every Remi Holdings dispatch is board-opened.
- [ ] **§6 rotation.** Routine assignee = CTO (`ce66203b-d725-4cf2-a5c3-4c19c47d997c`). Cron anchored to the day Remi Holdings' key is minted.
- [ ] **§7 smoke.** Mirror archives immediately. The result is recorded in [GSO-142](/GSO/issues/GSO-142) (the end-to-end test issue) — this smoke is the prerequisite for closing that test as `done`.

[GSO-142](/GSO/issues/GSO-142) is the issue that exercises this checklist end-to-end and is the gate for declaring the dispatch bridge live for Remi Holdings.

---

## Reversibility & teardown

If a sibling provisioning needs to be undone (e.g. the sibling company is wound down):

1. **Pause the dispatcher agent:** `PATCH /api/agents/$DISPATCHER_AGENT_ID { "status": "paused" }`. Kills the principal immediately.
2. **Delete the GSO secret:** `DELETE /api/secrets/<secretId>`. Removes the key from GSO's reach.
3. **Archive the rotation routine:** `PATCH /api/routines/$ROUTINE_ID { "status": "archived" }`. Stops the quarterly reminders. Archived is terminal — fine, since teardown is intentional.
4. **Leave the sibling company alone.** Mirror issues created during the dispatch's lifetime stay in the sibling for audit. The sibling's CEO can cancel them on their own schedule.

Each of the four steps is reversible individually except routine archival (terminal). The overall teardown is a **two-way door** because re-provisioning is just running this runbook again from §2 onward.

---

## API endpoint summary (desk-checked 2026-05-18)

| Step | Endpoint | Auth required | Verified |
|---|---|---|---|
| §1 list | `GET /api/companies` | board | 403 to agent token — confirms board-only |
| §1 create | `POST /api/companies` | board | same auth surface as list |
| §2A create | `POST /api/companies/:id/agents` | board or CEO | per api-reference; CEO route documented in `paperclip-create-agent` |
| §2 verify | `GET /api/agents/:id` | board or self | standard |
| §3 mint | `POST /api/agents/:id/keys` | board | 403 to agent token — confirms board-only |
| §4 store | `POST /api/companies/:id/secrets` | board | 403 to agent token — confirms board-only |
| §4 list | `GET /api/companies/:id/secrets` | board | 403 to agent token; metadata only per api-reference |
| §6 routine | `POST /api/companies/:id/routines` | agent (own) or board | `GET .../routines` succeeded with agent token (200) |
| §6 trigger | `POST /api/routines/:id/triggers` | agent (own) or board | per routines reference doc |
| §7 dispatch | `POST /api/companies/:id/issues` | sibling-resident principal | per design 1.x — cross-company writes only allowed by sibling-resident agent |
| teardown | `PATCH /api/agents/:id`, `DELETE /api/secrets/:id`, `PATCH /api/routines/:id` | board / agent (own) | standard |

No fictional endpoints. All paths are present in `references/api-reference.md` and the secret/keys/companies endpoints were probed empirically on `127.0.0.1:3101` on 2026-05-18.

---

## Open questions for v1

- **Per-key one-shot reminders** if Paperclip ships a non-cron trigger (e.g. `runOnceAt: <iso>`). Cleaner than the cron-anchored quarterly.
- **Dispatcher pool** if the per-sibling agent overhead becomes friction at 5+ siblings — would still respect the auth model but consolidate the principal.
- **`dispatch_authorized` as a first-class flag** rather than a document key, once Paperclip adds typed issue metadata.

Track these against [GSO-118](/GSO/issues/GSO-118) (parent of the dispatch surface) if they become blocking, otherwise let them ride until rotation or sibling-count friction surfaces them.
