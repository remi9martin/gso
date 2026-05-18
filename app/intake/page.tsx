import type { CSSProperties } from 'react';

import { IntakeForm } from './intake-form';

export const dynamic = 'force-dynamic';

// /intake — single-page capture endpoint for the L1 CONSOLIDATOR pipeline.
// Mirrors the MVP Ingest box validated on damgsolutions.com/gso. Submissions
// flow through the shared `processIntake` helper, which is the same pipeline
// `/api/intake` uses for external bearer-token callers (curl, email-receiver,
// future agents). See docs/intake/security.md for the threat model.

export default function IntakePage() {
  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Capture</h1>
        <p style={subtitleStyle}>
          Paste, drop, or type anything. We&apos;ll create a draft in the Intake project and queue
          it for triage.
        </p>
      </header>

      <section style={cardStyle}>
        <IntakeForm triageInboxUrl="/GSO/projects/intake" intakeProjectUrl="/GSO/projects/intake" />
      </section>

      <footer style={footerStyle}>
        <p style={{ margin: 0 }}>
          Need the curl path? <code style={codeStyle}>POST /api/intake</code> with{' '}
          <code style={codeStyle}>Authorization: Bearer gso_intake_&lt;token&gt;</code>. See{' '}
          <a href="/GSO/issues/GSO-124" style={linkStyle}>
            GSO-124
          </a>{' '}
          and{' '}
          <a href="/docs/intake/security.md" style={linkStyle}>
            docs/intake/security.md
          </a>
          .
        </p>
      </footer>
    </main>
  );
}

const pageStyle: CSSProperties = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  color: '#0f172a',
  background: '#f7f8fa',
  minHeight: '100vh',
  padding: '32px 24px',
  maxWidth: 760,
  margin: '0 auto'
};

const headerStyle: CSSProperties = {
  marginBottom: 16
};

const subtitleStyle: CSSProperties = {
  color: '#475569',
  fontSize: 14,
  marginTop: 4,
  marginBottom: 0
};

const cardStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  padding: '22px',
  boxShadow: '0 1px 0 rgba(15,23,42,0.03)'
};

const footerStyle: CSSProperties = {
  marginTop: 16,
  color: '#64748b',
  fontSize: 12,
  lineHeight: '18px'
};

const codeStyle: CSSProperties = {
  background: '#e2e8f0',
  color: '#0f172a',
  padding: '1px 4px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
};

const linkStyle: CSSProperties = {
  color: '#2563eb'
};
