#!/usr/bin/env bash
# Poll a Vercel deployment until it reaches a terminal state.
#
# Usage: vercel-wait.sh <deploymentId>
# Required env: VERCEL_TOKEN, VERCEL_ORG_ID

set -euo pipefail

deployment_id="${1:?deploymentId required}"

: "${VERCEL_TOKEN:?VERCEL_TOKEN required}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID required}"

base="https://api.vercel.com"
auth=(-H "Authorization: Bearer $VERCEL_TOKEN")

# 12 minutes worst case (72 * 10s). Vercel production for this app finishes
# well under 5 minutes today; the cap is just a safety net for incidents.
max_attempts=72
attempt=0

while [ "$attempt" -lt "$max_attempts" ]; do
  attempt=$((attempt + 1))
  resp=$(curl -fsSL "${auth[@]}" \
    "$base/v13/deployments/$deployment_id?teamId=$VERCEL_ORG_ID")
  state=$(printf '%s' "$resp" | jq -r '.readyState // .status // "UNKNOWN"')
  echo "  attempt $attempt/$max_attempts: state=$state"
  case "$state" in
    READY)
      echo "Vercel deployment $deployment_id is READY."
      exit 0
      ;;
    ERROR|CANCELED)
      echo "::error::Vercel deployment $deployment_id ended in state $state"
      printf '%s\n' "$resp" | jq '{id, readyState, errorMessage: .errorMessage // .error}' >&2 || true
      exit 1
      ;;
  esac
  sleep 10
done

echo "::error::Vercel deployment $deployment_id did not reach READY within $(( max_attempts * 10 ))s"
exit 1
