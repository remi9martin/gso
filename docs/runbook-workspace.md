# Runbook — heartbeat workspace isolation

**Why this exists.** [GSO-53](../) — the heartbeat's "exclusive checkout" invariant is per-issue at the Paperclip layer, **not** per-workspace. A single agent can have several heartbeats running in parallel (default `runtimeConfig.heartbeat.maxConcurrentRuns = 10`); they all land in the same on-disk workspace and clobber each other's branch switches, `node_modules`, and uncommitted files.

A5 (the dashboard for [GSO-30](../)) shipped only because the FE caught the corruption and recovered files from a dangling stash. The next agent may not be that lucky.

The fix is convention: **never do work in the workspace root. Every heartbeat operates inside a per-issue worktree under `.worktrees/<issue-id>/`.**

---

## Rule

> Before touching any tracked file in a heartbeat, `cd` into `.worktrees/<issue-id>/`. If the worktree does not exist, create it. The workspace root is read-only for heartbeats.

`<issue-id>` is the issue identifier, lowercased (e.g. `gso-53`).

### One-line per-heartbeat prelude

PowerShell (the production agent runtime):

```powershell
$wt = & ./scripts/heartbeat-worktree.ps1 $env:PAPERCLIP_TASK_ID; Set-Location $wt
```

Bash (CI, local Unix):

```bash
cd "$(./scripts/heartbeat-worktree.sh "$PAPERCLIP_TASK_ID")"
```

Both scripts are idempotent: they create the worktree on a fresh `work/<issue-id>` branch tracking `origin/main` the first time, and reuse it on subsequent heartbeats.

---

## Why worktrees and not just branches

A `git checkout` from the workspace root mutates every tracked file in place. Two concurrent heartbeats on different branches will:

1. Race the index lock, leaving one side with a dirty tree it didn't write.
2. Swap each other's `node_modules` native bindings (Next.js SWC, Rollup, `@unrs/resolver`) when `npm ci` reinstalls.
3. Leak files between branches — exactly the `On chore/gso-44-license: WIP cross-issue mix` stash we found.

Worktrees give each heartbeat its own working copy backed by a shared object database. Branch switches, `npm install`, and edits are isolated; only `git push`/`git fetch` and the object store are shared, which is safe.

---

## Lifecycle

| When                                | Action                                                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heartbeat start                     | Run the prelude. Get back the absolute path of `.worktrees/<issue-id>/`. `cd` into it.                                                                                                       |
| Heartbeat work                      | Edit, commit, push from inside the worktree. Use whatever branch name you want; the default `work/<issue-id>` is just a starting point — rename with `git branch -m feat/<issue-id>-<slug>`. |
| Issue closed (`done` / `cancelled`) | The worktree can be pruned: `git worktree remove .worktrees/<issue-id>`. Safe to do as a cleanup pass; do **not** delete a worktree whose branch has unmerged commits.                       |
| Pre-commit hook failures            | Stay inside the worktree. Never `git stash` to the workspace root — that's how cross-issue stashes happened.                                                                                 |

---

## What this does **not** fix

This is a convention living in the GSO repo. It binds GSO agents because the per-agent `AGENTS.md` (owned by the CTO) requires reading it, but it does **not** stop a Paperclip-side regression — a future runtime change could still race in the workspace root for an agent that doesn't follow the convention.

Two-way door: the platform-level fix lives in [GSO-54](../) (escalated to CTO). Options under consideration:

- **Auto-worktree per heartbeat:** Paperclip's adapter spawns a per-`(agentId, issueId)` worktree before the heartbeat and `cd`s into it.
- **Workspace-level exclusivity:** Paperclip serializes heartbeats per `executionWorkspaceId`, falling back to per-agent serialization when there is none.
- **`maxConcurrentRuns = 1` for code-bound agents:** belt-and-suspenders; preserves wake responsiveness but loses parallelism.

Until one of those lands, this runbook is the only thing standing between us and another near-miss.

---

## Recovery, if it happens again

The A5 recovery sequence, distilled:

1. `git stash list` — look for `WIP cross-issue mix` or `wip-*-leftover` entries.
2. `git stash show -p stash@{N}` — diff to identify which issue the files belong to.
3. Create the per-issue worktree (`./scripts/heartbeat-worktree.{sh,ps1} <issue-id>`).
4. From inside the worktree: `git stash apply stash@{N}` to land the recovered files on the correct branch.
5. Audit `node_modules` — if a native binding is broken (`Error: Cannot find module '@next/swc-win32-x64-msvc'` or similar), `rm -rf node_modules && npm ci` inside the worktree.
6. Commit, push, comment on the issue with a `Recovered from stash@{N}` note so the trail isn't lost.

If you can't reconstruct which issue a stash belongs to from the diff, leave the stash in place and escalate to the CTO. Do not delete stashes you can't attribute.
