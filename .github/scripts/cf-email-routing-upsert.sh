#!/usr/bin/env bash
# Upsert the Cloudflare Email Routing rule for `intake@damgsolutions.com` so
# it forwards to the `gso-email-intake` worker.
#
# Idempotent: lists existing rules, looks for one whose literal `to` matcher
# matches $INTAKE_ADDRESS, updates it if found, creates it if not. Also
# ensures Email Routing itself is enabled on the zone.
#
# Required env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, WORKER_NAME,
#               INTAKE_ADDRESS

set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN required}"
: "${CLOUDFLARE_ZONE_ID:?CLOUDFLARE_ZONE_ID required}"
: "${WORKER_NAME:?WORKER_NAME required}"
: "${INTAKE_ADDRESS:?INTAKE_ADDRESS required}"

base="https://api.cloudflare.com/client/v4"
auth=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")

# Ensure Email Routing is enabled on the zone. This call is a no-op if it
# is already enabled.
enable_resp=$(curl -sSL -X POST "${auth[@]}" \
  "$base/zones/$CLOUDFLARE_ZONE_ID/email/routing/enable")
enable_ok=$(printf '%s' "$enable_resp" | jq -r '.success')
if [ "$enable_ok" != "true" ]; then
  # `already enabled` returns success=false with a specific code we can
  # tolerate; everything else is a real error.
  code=$(printf '%s' "$enable_resp" | jq -r '.errors[0].code // 0')
  if [ "$code" != "10004" ] && [ "$code" != "1006" ]; then
    echo "::error::Failed to enable Email Routing"
    printf '%s\n' "$enable_resp" >&2
    exit 1
  fi
fi

list_resp=$(curl -fsSL "${auth[@]}" \
  "$base/zones/$CLOUDFLARE_ZONE_ID/email/routing/rules?per_page=200")

existing_tag=$(printf '%s' "$list_resp" \
  | jq -r --arg addr "$INTAKE_ADDRESS" '
      .result[]
      | select(.matchers[]? | select(.type == "literal" and .field == "to" and .value == $addr))
      | .tag' \
  | head -n1)

rule_body=$(jq -n \
  --arg addr "$INTAKE_ADDRESS" \
  --arg worker "$WORKER_NAME" \
  '{
    name: ("intake → " + $worker),
    enabled: true,
    priority: 0,
    matchers: [{type: "literal", field: "to", value: $addr}],
    actions: [{type: "worker", value: [$worker]}]
  }')

if [ -n "$existing_tag" ]; then
  echo "Updating Email Routing rule $existing_tag → $WORKER_NAME"
  resp=$(curl -fsSL -X PUT "${auth[@]}" \
    -d "$rule_body" \
    "$base/zones/$CLOUDFLARE_ZONE_ID/email/routing/rules/$existing_tag")
else
  echo "Creating Email Routing rule for $INTAKE_ADDRESS → $WORKER_NAME"
  resp=$(curl -fsSL -X POST "${auth[@]}" \
    -d "$rule_body" \
    "$base/zones/$CLOUDFLARE_ZONE_ID/email/routing/rules")
fi

ok=$(printf '%s' "$resp" | jq -r '.success')
if [ "$ok" != "true" ]; then
  echo "::error::Cloudflare API rejected rule upsert"
  printf '%s\n' "$resp" >&2
  exit 1
fi

echo "Email Routing rule in place: $INTAKE_ADDRESS → $WORKER_NAME"
