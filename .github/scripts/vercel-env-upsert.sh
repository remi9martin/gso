#!/usr/bin/env bash
# Upsert a Vercel environment variable on the production target.
#
# Usage: vercel-env-upsert.sh <KEY> <VALUE> <encrypted|plain> <production|preview|development>
#
# Idempotent: looks up the existing env by key+target, PATCHes if it exists,
# POSTs if it does not. Treats both code paths as success.
#
# Required env: VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_ORG_ID

set -euo pipefail

key="${1:?key required}"
value="${2:?value required}"
type="${3:-encrypted}"   # encrypted | plain
target="${4:-production}" # production | preview | development

case "$type" in
  encrypted|plain) ;;
  *) echo "::error::invalid type '$type' (expected encrypted|plain)" >&2; exit 2 ;;
esac
case "$target" in
  production|preview|development) ;;
  *) echo "::error::invalid target '$target'" >&2; exit 2 ;;
esac

: "${VERCEL_TOKEN:?VERCEL_TOKEN required}"
: "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID required}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID required}"

# Mask the value so a stray log line cannot expose it.
echo "::add-mask::$value"

base="https://api.vercel.com"
auth=(-H "Authorization: Bearer $VERCEL_TOKEN")

# List existing envs and find one matching key+target. The list endpoint
# returns up to 100 by default; intake's six-ish vars fit easily.
list_url="$base/v9/projects/$VERCEL_PROJECT_ID/env?teamId=$VERCEL_ORG_ID&decrypt=false"
list_json=$(curl -fsSL "${auth[@]}" "$list_url")
existing_id=$(printf '%s' "$list_json" \
  | jq -r --arg k "$key" --arg t "$target" '.envs[] | select(.key == $k) | select(.target | index($t)) | .id' \
  | head -n1)

body=$(jq -n \
  --arg key "$key" \
  --arg value "$value" \
  --arg type "$type" \
  --arg target "$target" \
  '{key: $key, value: $value, type: $type, target: [$target]}')

if [ -n "$existing_id" ]; then
  echo "Updating Vercel env $key (target=$target, id=$existing_id)"
  patch_body=$(jq -n --arg value "$value" --arg type "$type" --arg target "$target" \
    '{value: $value, type: $type, target: [$target]}')
  curl -fsSL -X PATCH \
    "${auth[@]}" \
    -H "Content-Type: application/json" \
    -d "$patch_body" \
    "$base/v10/projects/$VERCEL_PROJECT_ID/env/$existing_id?teamId=$VERCEL_ORG_ID" \
    > /dev/null
else
  echo "Creating Vercel env $key (target=$target)"
  curl -fsSL -X POST \
    "${auth[@]}" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "$base/v10/projects/$VERCEL_PROJECT_ID/env?teamId=$VERCEL_ORG_ID" \
    > /dev/null
fi

echo "Done: Vercel env $key (target=$target)"
