#!/usr/bin/env bash
# Trigger a Vercel production deployment from the current main commit.
#
# Required env: VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_ORG_ID
# Sets GitHub step outputs: deployment-id, deployment-url

set -euo pipefail

: "${VERCEL_TOKEN:?VERCEL_TOKEN required}"
: "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID required}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID required}"

base="https://api.vercel.com"
auth=(-H "Authorization: Bearer $VERCEL_TOKEN")

# Resolve project metadata to pull the git repo link (Vercel needs the
# numeric repoId to create a git-source deployment).
project_url="$base/v9/projects/$VERCEL_PROJECT_ID?teamId=$VERCEL_ORG_ID"
project_json=$(curl -fsSL "${auth[@]}" "$project_url")

repo_id=$(printf '%s' "$project_json" | jq -r '.link.repoId // empty')
repo_type=$(printf '%s' "$project_json" | jq -r '.link.type // empty')
project_name=$(printf '%s' "$project_json" | jq -r '.name // empty')

if [ -z "$repo_id" ] || [ "$repo_type" != "github" ]; then
  echo "::warning::Vercel project is not linked to a GitHub repo (link.type='$repo_type'); skipping API-triggered deploy."
  echo "Manually run \`vercel --prod\` or hit the Vercel dashboard to redeploy with the new EMAIL_INTAKE_BEARER_HASH."
  exit 0
fi

body=$(jq -n \
  --arg name "$project_name" \
  --arg project "$VERCEL_PROJECT_ID" \
  --argjson repoId "$repo_id" \
  '{
    name: $name,
    project: $project,
    target: "production",
    gitSource: {type: "github", ref: "main", repoId: $repoId}
  }')

deploy_url="$base/v13/deployments?teamId=$VERCEL_ORG_ID&forceNew=1&skipAutoDetectionConfirmation=1"
resp=$(curl -fsSL -X POST \
  "${auth[@]}" \
  -H "Content-Type: application/json" \
  -d "$body" \
  "$deploy_url")

deployment_id=$(printf '%s' "$resp" | jq -r '.id // empty')
inspector=$(printf '%s' "$resp" | jq -r '.inspectorUrl // empty')
hostname=$(printf '%s' "$resp" | jq -r '.url // empty')

if [ -z "$deployment_id" ]; then
  echo "::error::Vercel deployment trigger returned no id"
  printf '%s\n' "$resp" >&2
  exit 1
fi

echo "Triggered Vercel deployment $deployment_id ($inspector)"

{
  echo "deployment-id=$deployment_id"
  echo "deployment-url=${inspector:-https://$hostname}"
} >> "${GITHUB_OUTPUT:-/dev/null}"
