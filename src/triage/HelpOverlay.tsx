'use client';

import { useEffect, useRef, type CSSProperties, type JSX } from 'react';

interface HelpOverlayProps {
  onClose: () => void;
}

export function HelpOverlay({ onClose }: HelpOverlayProps): JSX.Element {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Trap focus on mount; return focus on close.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      style={backdropStyle}
      role="dialog"
      aria-modal
      aria-label="Keyboard shortcuts"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={panelStyle}>
        <h2 style={titleStyle}>Keyboard shortcuts</h2>
        <table style={tableStyle}>
          <tbody>
            {BINDINGS.map(({ key, label }) => (
              <tr key={key}>
                <td style={keyTdStyle}>
                  <kbd style={kbdStyle}>{key}</kbd>
                </td>
                <td style={labelTdStyle}>{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button ref={closeRef} type="button" onClick={onClose} style={closeButtonStyle}>
          Close
        </button>
      </div>
    </div>
  );
}

const BINDINGS = [
  { key: 'j', label: 'Next issue' },
  { key: 'k', label: 'Previous issue' },
  { key: 'a', label: 'Approve (in_review → done)' },
  { key: 'r', label: 'Reject (back to in_progress with note)' },
  { key: 'e', label: 'Open issue detail' },
  { key: '?', label: 'Show / hide this help' },
  { key: 'Esc', label: 'Close modal or drawer' },
];

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  background: 'rgba(15, 23, 42, 0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const panelStyle: CSSProperties = {
  background: '#ffffff',
  borderRadius: 10,
  padding: '24px 28px',
  minWidth: 340,
  maxWidth: 420,
  boxShadow: '0 20px 40px rgba(15, 23, 42, 0.18)',
};

const titleStyle: CSSProperties = {
  margin: '0 0 16px',
  fontSize: 16,
  fontWeight: 600,
  color: '#1a1d22',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

const keyTdStyle: CSSProperties = {
  padding: '6px 12px 6px 0',
  width: 80,
  verticalAlign: 'middle',
};

const labelTdStyle: CSSProperties = {
  padding: '6px 0',
  fontSize: 13,
  color: '#334155',
  verticalAlign: 'middle',
};

const kbdStyle: CSSProperties = {
  display: 'inline-block',
  padding: '2px 7px',
  background: '#f1f5f9',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  fontFamily: 'monospace',
  fontSize: 12,
  fontWeight: 600,
  color: '#1e293b',
  boxShadow: '0 1px 0 #cbd5e1',
};

const closeButtonStyle: CSSProperties = {
  marginTop: 20,
  display: 'block',
  width: '100%',
  padding: '8px 0',
  background: '#f1f5f9',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  color: '#334155',
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
};
