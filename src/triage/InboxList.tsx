'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { HelpOverlay } from './HelpOverlay';
import { RoutingAffordance } from './RoutingAffordance';
import type { AffordanceDecision } from './types';
import { useInboxKeyNav } from './useInboxKeyNav';

export interface InboxItem {
  id: string;
  identifier: string;
  title: string;
  status: string;
  decision?: AffordanceDecision;
}

export interface InboxListProps {
  items: InboxItem[];
  onApprove?: (item: InboxItem) => void;
  onReject?: (item: InboxItem, note: string) => void;
  onOpen?: (item: InboxItem) => void;
}

export function InboxList({ items, onApprove, onReject, onOpen }: InboxListProps): JSX.Element {
  const [rejectingIdx, setRejectingIdx] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const rejectInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

  const handleApprove = (idx: number) => {
    const item = items[idx];
    if (item) onApprove?.(item);
  };

  const handleReject = (idx: number) => {
    setRejectingIdx(idx);
    setRejectNote('');
    // Focus the note input on next tick (after render)
    setTimeout(() => rejectInputRef.current?.focus(), 0);
  };

  const handleOpen = (idx: number) => {
    const item = items[idx];
    if (item) onOpen?.(item);
  };

  const { focusedIdx, showHelp, setFocusedIdx, setShowHelp } = useInboxKeyNav({
    count: rejectingIdx !== null ? 0 : items.length,
    onApprove: handleApprove,
    onReject: handleReject,
    onOpen: handleOpen,
  });

  // Scroll focused row into view.
  useEffect(() => {
    rowRefs.current[focusedIdx]?.scrollIntoView({ block: 'nearest' });
  }, [focusedIdx]);

  // When the reject prompt opens, suspend keynav by setting count to 0 above.
  // Esc in the input cancels the reject prompt.
  const onRejectInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setRejectingIdx(null);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submitReject();
    }
  };

  const submitReject = () => {
    if (rejectingIdx === null) return;
    const item = items[rejectingIdx];
    if (item) onReject?.(item, rejectNote.trim());
    setRejectingIdx(null);
    setRejectNote('');
  };

  if (items.length === 0) {
    return <p style={emptyStyle}>Inbox empty — nothing needs your attention right now.</p>;
  }

  return (
    <div style={containerStyle}>
      <p style={hintStyle}>
        Use <kbd style={kbdStyle}>j</kbd>/<kbd style={kbdStyle}>k</kbd> to navigate,{' '}
        <kbd style={kbdStyle}>a</kbd> approve, <kbd style={kbdStyle}>r</kbd> reject,{' '}
        <kbd style={kbdStyle}>e</kbd> open, <kbd style={kbdStyle}>?</kbd> help
      </p>

      <ul role="list" style={listStyle} aria-label="Triage inbox">
        {items.map((item, idx) => {
          const isFocused = idx === focusedIdx;
          const isRejecting = idx === rejectingIdx;

          return (
            <li
              key={item.id}
              role="listitem"
              aria-current={isFocused ? 'true' : undefined}
            >
              <div
                ref={(el) => {
                  rowRefs.current[idx] = el;
                }}
                data-inbox-row={idx}
                onClick={() => setFocusedIdx(idx)}
                style={{
                  ...rowStyle,
                  ...(isFocused ? rowFocusedStyle : null),
                }}
              >
                <div style={rowHeaderStyle}>
                  <span style={identifierStyle}>{item.identifier}</span>
                  <span style={titleStyle}>{item.title}</span>
                  <span style={{ ...statusBadgeStyle, ...statusColor(item.status) }}>
                    {item.status}
                  </span>
                </div>

                {item.decision && (
                  <div style={affordanceWrapStyle}>
                    <RoutingAffordance state="routed" decision={item.decision} />
                  </div>
                )}

                {isFocused && (
                  <div style={actionBarStyle}>
                    <button
                      type="button"
                      onClick={() => handleApprove(idx)}
                      style={{ ...actionBtnStyle, ...approveBtnStyle }}
                    >
                      Approve <kbd style={inlinekbdStyle}>a</kbd>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(idx)}
                      style={{ ...actionBtnStyle, ...rejectBtnStyle }}
                    >
                      Reject <kbd style={inlinekbdStyle}>r</kbd>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpen(idx)}
                      style={{ ...actionBtnStyle, ...openBtnStyle }}
                    >
                      Open <kbd style={inlinekbdStyle}>e</kbd>
                    </button>
                  </div>
                )}

                {isRejecting && (
                  <form
                    style={rejectFormStyle}
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitReject();
                    }}
                  >
                    <input
                      ref={rejectInputRef}
                      type="text"
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      onKeyDown={onRejectInputKeyDown}
                      placeholder="One-line note (optional) — Enter to confirm, Esc to cancel"
                      style={rejectInputStyle}
                      aria-label="Rejection note"
                    />
                    <button type="submit" style={{ ...actionBtnStyle, ...rejectBtnStyle }}>
                      Confirm reject
                    </button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function statusColor(status: string): CSSProperties {
  switch (status) {
    case 'in_review':
      return { background: '#eff6ff', color: '#1e40af', borderColor: '#93c5fd' };
    case 'in_progress':
      return { background: '#f0fdf4', color: '#166534', borderColor: '#86efac' };
    case 'done':
      return { background: '#f8fafc', color: '#475569', borderColor: '#cbd5e1' };
    case 'blocked':
      return { background: '#fff7ed', color: '#9a3412', borderColor: '#fdba74' };
    default:
      return { background: '#f8fafc', color: '#475569', borderColor: '#e2e8f0' };
  }
}

const containerStyle: CSSProperties = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

const hintStyle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 12,
  color: '#64748b',
};

const kbdStyle: CSSProperties = {
  display: 'inline-block',
  padding: '1px 5px',
  background: '#f1f5f9',
  border: '1px solid #cbd5e1',
  borderRadius: 3,
  fontFamily: 'monospace',
  fontSize: 11,
};

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const rowStyle: CSSProperties = {
  padding: '14px 16px',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  background: '#ffffff',
  cursor: 'pointer',
  outline: 'none',
  transition: 'box-shadow 0.1s, border-color 0.1s',
};

const rowFocusedStyle: CSSProperties = {
  borderColor: '#2563eb',
  boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.18)',
};

const rowHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const identifierStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#64748b',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

const titleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: '#1a1d22',
  flex: 1,
  minWidth: 0,
};

const statusBadgeStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  padding: '2px 7px',
  borderRadius: 999,
  border: '1px solid',
  whiteSpace: 'nowrap',
};

const affordanceWrapStyle: CSSProperties = {
  marginTop: 10,
};

const actionBarStyle: CSSProperties = {
  marginTop: 12,
  display: 'flex',
  gap: 8,
};

const actionBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 12px',
  borderRadius: 5,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
  border: '1px solid',
};

const approveBtnStyle: CSSProperties = {
  background: '#f0fdf4',
  color: '#166534',
  borderColor: '#86efac',
};

const rejectBtnStyle: CSSProperties = {
  background: '#fef2f2',
  color: '#991b1b',
  borderColor: '#fca5a5',
};

const openBtnStyle: CSSProperties = {
  background: '#f8fafc',
  color: '#334155',
  borderColor: '#e2e8f0',
};

const inlinekbdStyle: CSSProperties = {
  display: 'inline-block',
  padding: '1px 4px',
  background: 'rgba(0,0,0,0.08)',
  borderRadius: 3,
  fontFamily: 'monospace',
  fontSize: 10,
};

const rejectFormStyle: CSSProperties = {
  marginTop: 10,
  display: 'flex',
  gap: 8,
  alignItems: 'center',
};

const rejectInputStyle: CSSProperties = {
  flex: 1,
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #e2e8f0',
  borderRadius: 5,
  outline: 'none',
  fontFamily: 'system-ui, sans-serif',
};

const emptyStyle: CSSProperties = {
  color: '#64748b',
  fontSize: 14,
  fontFamily: 'system-ui, sans-serif',
};
