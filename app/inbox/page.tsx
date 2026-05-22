'use client';

// /inbox — Triage Inbox with vim-style keyboard navigation.
// Keyboard bindings: j/k next/prev · a approve · r reject · e open · ? help · Esc close
// Works regardless of company prefix (/REM, /GSO, /DIG).

import { useCallback, useState, type CSSProperties } from 'react';

import { InboxList } from '@/src/triage/InboxList';
import type { InboxItem } from '@/src/triage/InboxList';

// --- Seed data (replace with live Paperclip API fetch in production) ---

const SEED_ITEMS: InboxItem[] = [
  {
    id: 'issue-001',
    identifier: 'GSO-241',
    title: 'Implement dark-mode toggle in org canvas',
    status: 'in_review',
    decision: {
      requestId: 'req-001',
      tier: 1,
      intentLabel: 'implement_feature',
      matchedPattern: 'implement',
      destinationRole: 'founding_engineer',
      confidence: 'high',
      overrideable: true,
    },
  },
  {
    id: 'issue-002',
    identifier: 'GSO-242',
    title: 'Review mobile breakpoints on the dashboard',
    status: 'in_review',
    decision: {
      requestId: 'req-002',
      tier: 2,
      intentLabel: 'ux_review',
      matchedPattern: null,
      destinationRole: 'ux_designer',
      confidence: 'medium',
      overrideable: true,
    },
  },
  {
    id: 'issue-003',
    identifier: 'GSO-243',
    title: 'Investigate latency spike in intake API',
    status: 'in_review',
    decision: {
      requestId: 'req-003',
      tier: 1,
      intentLabel: 'investigate_bug',
      matchedPattern: 'latency',
      destinationRole: 'cto',
      confidence: 'high',
      overrideable: true,
    },
  },
  {
    id: 'issue-004',
    identifier: 'GSO-244',
    title: 'Quarterly budget review — approve spend plan',
    status: 'in_review',
    decision: undefined,
  },
  {
    id: 'issue-005',
    identifier: 'GSO-245',
    title: 'Update onboarding copy for new agent signup flow',
    status: 'in_review',
    decision: {
      requestId: 'req-005',
      tier: 3,
      intentLabel: 'unknown',
      matchedPattern: null,
      destinationRole: 'ceo',
      confidence: 'low',
      overrideable: true,
    },
  },
];

interface InboxEvent {
  ts: string;
  kind: 'approve' | 'reject' | 'open';
  identifier: string;
  note?: string;
}

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>(SEED_ITEMS);
  const [log, setLog] = useState<InboxEvent[]>([]);

  const pushLog = (event: InboxEvent) => setLog((prev) => [event, ...prev].slice(0, 20));

  const handleApprove = useCallback((item: InboxItem) => {
    pushLog({ ts: new Date().toISOString(), kind: 'approve', identifier: item.identifier });
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  }, []);

  const handleReject = useCallback((item: InboxItem, note: string) => {
    pushLog({
      ts: new Date().toISOString(),
      kind: 'reject',
      identifier: item.identifier,
      note: note || undefined,
    });
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: 'in_progress' } : i))
    );
  }, []);

  const handleOpen = useCallback((item: InboxItem) => {
    pushLog({ ts: new Date().toISOString(), kind: 'open', identifier: item.identifier });
    // In production: router.push(`/${companyPrefix}/issues/${item.identifier}`)
    window.open(`/GSO/issues/${item.identifier}`, '_blank', 'noopener');
  }, []);

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={h1Style}>Triage Inbox</h1>
        <p style={subtitleStyle}>
          Issues waiting for your decision.{' '}
          <span style={{ color: '#94a3b8' }}>Press ? for keyboard shortcuts.</span>
        </p>
      </header>

      <div style={bodyStyle}>
        <div style={inboxColStyle}>
          <InboxList
            items={items}
            onApprove={handleApprove}
            onReject={handleReject}
            onOpen={handleOpen}
          />
        </div>

        {log.length > 0 && (
          <aside style={logColStyle} aria-label="Activity log">
            <h2 style={logTitleStyle}>Activity</h2>
            <ul style={logListStyle}>
              {log.map((ev, i) => (
                <li key={i} style={logItemStyle}>
                  <span style={logKindStyle(ev.kind)}>{ev.kind}</span>
                  <span style={logIdentStyle}>{ev.identifier}</span>
                  {ev.note && <span style={logNoteStyle}>{ev.note}</span>}
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </main>
  );
}

function logKindStyle(kind: string): CSSProperties {
  const map: Record<string, CSSProperties> = {
    approve: { color: '#166534', fontWeight: 600 },
    reject: { color: '#991b1b', fontWeight: 600 },
    open: { color: '#1e40af', fontWeight: 600 },
  };
  return {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    ...map[kind],
  };
}

const pageStyle: CSSProperties = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  color: '#1a1d22',
  background: '#f7f8fa',
  minHeight: '100vh',
  padding: '32px 48px',
  maxWidth: 1200,
  margin: '0 auto',
};

const headerStyle: CSSProperties = { marginBottom: 24 };

const h1Style: CSSProperties = { fontSize: '1.5rem', margin: 0, fontWeight: 700 };

const subtitleStyle: CSSProperties = { color: '#475569', fontSize: 13, marginTop: 4 };

const bodyStyle: CSSProperties = {
  display: 'flex',
  gap: 32,
  alignItems: 'flex-start',
};

const inboxColStyle: CSSProperties = { flex: 1, minWidth: 0 };

const logColStyle: CSSProperties = {
  width: 220,
  flexShrink: 0,
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: '14px 16px',
};

const logTitleStyle: CSSProperties = { fontSize: 12, fontWeight: 600, color: '#64748b', margin: '0 0 10px' };

const logListStyle: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 };

const logItemStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };

const logIdentStyle: CSSProperties = { fontSize: 12, color: '#334155' };

const logNoteStyle: CSSProperties = { fontSize: 11, color: '#64748b', fontStyle: 'italic' };
