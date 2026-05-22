'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { PaperclipIssue } from '@/lib/paperclip/types';
import { filterApprovableIssues, bulkPatchIssues } from '@/lib/dashboard/bulk-approve';

interface Props {
  prefix: string;
  issues: PaperclipIssue[];
  pendingApprovalIssueIds: string[];
}

type PageState =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'approving' }
  | { kind: 'approved'; succeeded: string[]; failed: string[]; undoDeadline: number }
  | { kind: 'undoing' }
  | { kind: 'undone' };

const UNDO_DURATION_MS = 30_000;

async function patchIssue(id: string, body: { status: string }): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/issues/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { ok: res.ok };
}

export function DashboardClient({ prefix, issues, pendingApprovalIssueIds }: Props) {
  const router = useRouter();
  const pendingSet = new Set(pendingApprovalIssueIds);
  const approvable = filterApprovableIssues(issues, pendingSet);
  const excluded = issues.filter((i) => pendingSet.has(i.id));

  const [state, setState] = useState<PageState>({ kind: 'idle' });
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearUndoTimer = useCallback(() => {
    if (undoTimerRef.current !== null) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (state.kind === 'approved') {
      undoTimerRef.current = setTimeout(() => {
        setState({ kind: 'idle' });
        router.refresh();
      }, UNDO_DURATION_MS);
    }
    return clearUndoTimer;
  }, [state.kind, clearUndoTimer, router]);

  async function handleConfirmApprove() {
    setState({ kind: 'approving' });
    const ids = approvable.map((i) => i.id);
    const result = await bulkPatchIssues(ids, 'done', patchIssue);
    setState({
      kind: 'approved',
      succeeded: result.succeeded,
      failed: result.failed,
      undoDeadline: Date.now() + UNDO_DURATION_MS
    });
    router.refresh();
  }

  async function handleUndo() {
    if (state.kind !== 'approved') return;
    clearUndoTimer();
    const ids = state.succeeded;
    setState({ kind: 'undoing' });
    await bulkPatchIssues(ids, 'in_review', patchIssue);
    setState({ kind: 'undone' });
    router.refresh();
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: '56rem' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{prefix} — In Review</h1>
        <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>
          {issues.length} issue{issues.length !== 1 ? 's' : ''}
        </span>
      </header>

      {/* Bulk approve button */}
      {approvable.length > 0 && state.kind === 'idle' ? (
        <div style={{ marginBottom: '1.5rem' }}>
          <button
            type="button"
            onClick={() => setState({ kind: 'confirming' })}
            style={{
              padding: '0.5rem 1rem',
              background: '#16a34a',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Bulk approve all ({approvable.length})
          </button>
          {excluded.length > 0 ? (
            <span style={{ marginLeft: '0.75rem', color: '#6b7280', fontSize: '0.8125rem' }}>
              {excluded.length} excluded (pending board approval)
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Toast: approved */}
      {state.kind === 'approved' ? (
        <ApprovedBanner
          count={state.succeeded.length}
          failedCount={state.failed.length}
          deadline={state.undoDeadline}
          onUndo={() => void handleUndo()}
        />
      ) : null}

      {/* Toast: undoing */}
      {state.kind === 'undoing' ? (
        <div style={bannerStyle('#fef9c3', '#a16207')}>Reverting…</div>
      ) : null}

      {/* Toast: undone */}
      {state.kind === 'undone' ? (
        <div style={bannerStyle('#f0fdf4', '#15803d')}>Reverted — issues are back in review.</div>
      ) : null}

      {/* Approving spinner */}
      {state.kind === 'approving' ? (
        <div style={bannerStyle('#eff6ff', '#1d4ed8')}>Approving {approvable.length} issues…</div>
      ) : null}

      {/* Issue list */}
      <IssueTable issues={issues} pendingSet={pendingSet} />

      {/* Confirm modal */}
      {state.kind === 'confirming' ? (
        <ConfirmModal
          approvable={approvable}
          onConfirm={() => void handleConfirmApprove()}
          onCancel={() => setState({ kind: 'idle' })}
        />
      ) : null}
    </main>
  );
}

// --- sub-components ---

interface ApprovedBannerProps {
  count: number;
  failedCount: number;
  deadline: number;
  onUndo: () => void;
}

function ApprovedBanner({ count, failedCount, deadline, onUndo }: ApprovedBannerProps) {
  const [remaining, setRemaining] = useState(Math.ceil((deadline - Date.now()) / 1000));

  useEffect(() => {
    const id = setInterval(() => {
      const s = Math.ceil((deadline - Date.now()) / 1000);
      setRemaining(Math.max(s, 0));
    }, 500);
    return () => clearInterval(id);
  }, [deadline]);

  return (
    <div
      role="status"
      style={{
        ...bannerStyle('#f0fdf4', '#15803d'),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem'
      }}
    >
      <span>
        Approved {count} issue{count !== 1 ? 's' : ''}.
        {failedCount > 0 ? ` (${failedCount} failed)` : ''}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button
          type="button"
          onClick={onUndo}
          style={{
            padding: '0.25rem 0.625rem',
            border: '1px solid #15803d',
            borderRadius: '4px',
            background: 'transparent',
            color: '#15803d',
            fontWeight: 600,
            fontSize: '0.8125rem',
            cursor: 'pointer'
          }}
        >
          Undo
        </button>
        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{remaining}s</span>
      </span>
    </div>
  );
}

interface ConfirmModalProps {
  approvable: PaperclipIssue[];
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({ approvable, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '8px',
          padding: '1.5rem',
          maxWidth: '36rem',
          width: '90vw',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
        }}
      >
        <h2 id="confirm-modal-title" style={{ fontSize: '1.125rem', margin: '0 0 0.75rem' }}>
          Approve {approvable.length} issue{approvable.length !== 1 ? 's' : ''}?
        </h2>
        <p style={{ color: '#374151', fontSize: '0.875rem', margin: '0 0 1rem' }}>
          The following issues will be marked <strong>done</strong>:
        </p>
        <ul
          style={{
            listStyle: 'none',
            margin: '0 0 1.25rem',
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.375rem'
          }}
        >
          {approvable.map((issue) => (
            <li
              key={issue.id}
              style={{
                display: 'flex',
                gap: '0.5rem',
                fontSize: '0.875rem',
                padding: '0.375rem 0.5rem',
                background: '#f9fafb',
                borderRadius: '4px'
              }}
            >
              <span style={{ color: '#6b7280', minWidth: '5rem', fontVariantNumeric: 'tabular-nums' }}>
                {issue.identifier}
              </span>
              <span style={{ color: '#111827' }}>{issue.title}</span>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '0.5rem 1rem',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              background: '#fff',
              color: '#374151',
              fontSize: '0.875rem',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: '0.5rem 1rem',
              border: 'none',
              borderRadius: '6px',
              background: '#16a34a',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Approve {approvable.length}
          </button>
        </div>
      </div>
    </div>
  );
}

interface IssueTableProps {
  issues: PaperclipIssue[];
  pendingSet: Set<string>;
}

function IssueTable({ issues, pendingSet }: IssueTableProps) {
  if (issues.length === 0) {
    return (
      <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>No issues in review.</p>
    );
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
          <th style={thStyle}>ID</th>
          <th style={thStyle}>Title</th>
          <th style={thStyle}>Priority</th>
          <th style={thStyle}>Status</th>
          <th style={thStyle}></th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue) => (
          <tr key={issue.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
            <td style={tdStyle}>
              <span style={{ color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>
                {issue.identifier}
              </span>
            </td>
            <td style={{ ...tdStyle, color: '#111827' }}>{issue.title}</td>
            <td style={tdStyle}>
              <PriorityBadge priority={issue.priority} />
            </td>
            <td style={tdStyle}>
              <span style={{ color: '#6b7280' }}>in_review</span>
            </td>
            <td style={tdStyle}>
              {pendingSet.has(issue.id) ? (
                <span
                  title="Has pending board approval — excluded from bulk approve"
                  style={{ fontSize: '0.75rem', color: '#d97706' }}
                >
                  approval pending
                </span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    critical: { bg: '#fef2f2', fg: '#b91c1c' },
    high: { bg: '#fff7ed', fg: '#c2410c' },
    medium: { bg: '#fefce8', fg: '#a16207' },
    low: { bg: '#f0fdf4', fg: '#15803d' }
  };
  const c = colors[priority] ?? { bg: '#f3f4f6', fg: '#6b7280' };
  return (
    <span
      style={{
        padding: '0.125rem 0.375rem',
        borderRadius: '4px',
        background: c.bg,
        color: c.fg,
        fontSize: '0.75rem',
        fontWeight: 500
      }}
    >
      {priority}
    </span>
  );
}

function bannerStyle(bg: string, fg: string): React.CSSProperties {
  return {
    padding: '0.625rem 1rem',
    background: bg,
    color: fg,
    borderRadius: '6px',
    marginBottom: '1rem',
    fontSize: '0.875rem'
  };
}

const thStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontWeight: 600,
  color: '#374151',
  fontSize: '0.8125rem'
};

const tdStyle: React.CSSProperties = {
  padding: '0.625rem 0.75rem',
  verticalAlign: 'middle'
};
