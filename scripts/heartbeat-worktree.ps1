# heartbeat-worktree.ps1 — ensure a per-issue git worktree exists, print its absolute path.
#
# Usage:
#   $wt = & ./scripts/heartbeat-worktree.ps1 $env:PAPERCLIP_TASK_ID
#   Set-Location $wt
#
# Why: see docs/runbook-workspace.md. The workspace root is shared across concurrent
# heartbeats of the same agent and is not safe to edit in. Every heartbeat must work
# inside .worktrees/<issue-id>/ to avoid cross-issue file corruption.
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$IssueId = $env:PAPERCLIP_TASK_ID
)

$ErrorActionPreference = 'Stop'

if (-not $IssueId) {
    Write-Error "heartbeat-worktree: issue id required (pass as arg or set PAPERCLIP_TASK_ID)"
    exit 2
}

$slug = $IssueId.ToLowerInvariant()
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Always anchor to the main worktree, not the caller's worktree — otherwise
# invoking this from inside a secondary worktree would nest .worktrees/ recursively.
$gitCommonDir = (& git -C $scriptDir rev-parse --path-format=absolute --git-common-dir).Trim()
$repoRoot = (Resolve-Path (Join-Path $gitCommonDir '..')).Path
$worktreeDir = Join-Path (Join-Path $repoRoot '.worktrees') $slug
$branch = "work/$slug"

if (-not (Test-Path $worktreeDir)) {
    & git -C $repoRoot fetch origin --quiet 2>$null

    $hasLocalBranch = $false
    & git -C $repoRoot show-ref --verify --quiet "refs/heads/$branch"
    if ($LASTEXITCODE -eq 0) { $hasLocalBranch = $true }

    $hasOriginMain = $false
    & git -C $repoRoot show-ref --verify --quiet 'refs/remotes/origin/main'
    if ($LASTEXITCODE -eq 0) { $hasOriginMain = $true }

    if ($hasLocalBranch) {
        & git -C $repoRoot worktree add $worktreeDir $branch 2>$null | Out-Null
    } elseif ($hasOriginMain) {
        & git -C $repoRoot worktree add $worktreeDir -b $branch origin/main 2>$null | Out-Null
    } else {
        & git -C $repoRoot worktree add $worktreeDir -b $branch main 2>$null | Out-Null
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Error "heartbeat-worktree: git worktree add failed for $worktreeDir (exit $LASTEXITCODE)"
        exit $LASTEXITCODE
    }
}

# Emit only the absolute path on stdout so callers can pipe it into Set-Location.
Write-Output $worktreeDir
