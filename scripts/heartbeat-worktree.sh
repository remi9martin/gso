#!/usr/bin/env bash
# heartbeat-worktree.sh — ensure a per-issue git worktree exists, print its absolute path.
#
# Usage: cd "$(./scripts/heartbeat-worktree.sh "$PAPERCLIP_TASK_ID")"
#
# Why: see docs/runbook-workspace.md. The workspace root is shared across concurrent
# heartbeats of the same agent and is not safe to edit in. Every heartbeat must work
# inside .worktrees/<issue-id>/ to avoid cross-issue file corruption.
set -euo pipefail

ISSUE_ID="${1:-${PAPERCLIP_TASK_ID:-}}"
if [ -z "$ISSUE_ID" ]; then
  echo "heartbeat-worktree: issue id required (pass as arg or set PAPERCLIP_TASK_ID)" >&2
  exit 2
fi

# Lowercase the slug so .worktrees/gso-53/ is canonical regardless of input case.
SLUG="$(printf '%s' "$ISSUE_ID" | tr '[:upper:]' '[:lower:]')"

# Always anchor to the main worktree, not the caller's worktree — otherwise
# invoking this from inside a secondary worktree would nest .worktrees/ recursively.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GIT_COMMON_DIR="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir)"
REPO_ROOT="$(cd "$GIT_COMMON_DIR/.." && pwd)"
WORKTREE_DIR="$REPO_ROOT/.worktrees/$SLUG"
BRANCH="work/$SLUG"

if [ ! -d "$WORKTREE_DIR" ]; then
  # Best-effort fetch so we branch from a current origin/main when available.
  git -C "$REPO_ROOT" fetch origin --quiet 2>/dev/null || true

  if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git -C "$REPO_ROOT" worktree add "$WORKTREE_DIR" "$BRANCH" >&2
  elif git -C "$REPO_ROOT" show-ref --verify --quiet "refs/remotes/origin/main"; then
    git -C "$REPO_ROOT" worktree add "$WORKTREE_DIR" -b "$BRANCH" origin/main >&2
  else
    git -C "$REPO_ROOT" worktree add "$WORKTREE_DIR" -b "$BRANCH" main >&2
  fi
fi

printf '%s\n' "$WORKTREE_DIR"
