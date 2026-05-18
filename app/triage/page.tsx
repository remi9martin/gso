import type { CSSProperties } from 'react';

import { RoutingAffordance } from '@/src/triage/RoutingAffordance';
import { contrastReport } from '@/src/triage/tokens';
import type { AffordanceDecision } from '@/src/triage/types';

export const dynamic = 'force-static';

// /triage — affordance gallery used to satisfy the visual-truth gate on
// [GSO-36](/GSO/issues/GSO-36). Every state UXDesigner asked to see is
// rendered statically here so screenshots are deterministic.

const tier1: AffordanceDecision = {
  requestId: 'req-001',
  tier: 1,
  intentLabel: 'implement_feature',
  matchedPattern: 'implement',
  destinationRole: 'founding_engineer',
  confidence: 'high',
  overrideable: true
};

const tier2: AffordanceDecision = {
  requestId: 'req-002',
  tier: 2,
  intentLabel: 'ux_review',
  matchedPattern: null,
  destinationRole: 'ux_designer',
  confidence: 'medium',
  overrideable: true
};

const tier3: AffordanceDecision = {
  requestId: 'req-003',
  tier: 3,
  intentLabel: 'unknown',
  matchedPattern: null,
  destinationRole: 'ceo',
  confidence: 'low',
  overrideable: true
};

const locked: AffordanceDecision = {
  requestId: 'req-004',
  tier: 1,
  intentLabel: 'security',
  matchedPattern: 'token leak',
  destinationRole: 'cto',
  confidence: 'high',
  overrideable: false
};

const dropdownDemo: AffordanceDecision = {
  requestId: 'req-005',
  tier: 1,
  intentLabel: 'implement_feature',
  matchedPattern: 'implement',
  destinationRole: 'founding_engineer',
  confidence: 'high',
  overrideable: true
};

export default function TriageGalleryPage() {
  const ratios = contrastReport();
  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Triage Inbox — Routing Affordance Gallery</h1>
        <p style={subtitleStyle}>
          Visual-truth gallery for{' '}
          <a href="/GSO/issues/GSO-36" style={linkStyle}>
            GSO-36
          </a>{' '}
          UX sign-off. Every numbered review point is represented below.
        </p>
      </header>

      <Section
        id="tier-1-high"
        title="1 · Tier 1 (high confidence) — solid badge, popover rationale"
        captionLines={[
          'Review #1: solid badge is the non-color cue.',
          'Review #2: rationale lives behind the keyboard-operable `i` button.'
        ]}
      >
        <RoutingAffordance state="routed" decision={tier1} />
      </Section>

      <Section
        id="tier-2-medium"
        title="2 · Tier 2 (medium) — outlined badge, persistent rationale"
        captionLines={[
          'Review #1: `~medium` label is the cue; amber/dashed border is decoration.',
          'Review #3: plain-language rationale, no internal jargon.'
        ]}
      >
        <RoutingAffordance state="routed" decision={tier2} />
      </Section>

      <Section
        id="tier-3-low"
        title="3 · Tier 3 (low) — outlined badge, `default` suffix, persistent rationale"
        captionLines={[
          'Review #1: `?low default` makes the fallback explicit.',
          'Review #3: rationale states "no rule matched" in plain words.'
        ]}
      >
        <RoutingAffordance state="routed" decision={tier3} />
      </Section>

      <Section
        id="override-open"
        title="4 · Override dropdown — open (Keep-suggested anchor + role descriptions)"
        captionLines={[
          'Review #8: each item has role, agent name, and one-line description.',
          'Review #9: first item is "Keep suggested" (Goal-Gradient).',
          'Review #10: real <button>, ArrowDown/ArrowUp navigation, Esc closes.'
        ]}
      >
        <RoutingAffordance state="routed" decision={dropdownDemo} initiallyOpen />
      </Section>

      <Section
        id="overridden"
        title="5 · Overridden — both signals shown, original visible for audit"
        captionLines={[
          'Review #4: "→ CEO (overridden) was: FoundingEngineer" — reversible.',
          'Re-opening the menu offers "Keep suggested: FoundingEngineer" as the first item.'
        ]}
      >
        <RoutingAffordance
          state="overridden"
          overriddenFrom="founding_engineer"
          overriddenTo="ceo"
        />
      </Section>

      <Section
        id="loading"
        title="6 · Loading — Tier 2 in flight, respects prefers-reduced-motion"
        captionLines={[
          'Review #5: skeleton + "Routing…" text; pulse animation gated by prefers-reduced-motion.'
        ]}
      >
        <RoutingAffordance state="loading" />
      </Section>

      <Section
        id="no-agent"
        title="7 · No agent available — error visible, override opens by default"
        captionLines={[
          'Review #6: never silently falls through to CEO when the role has no agent hired.'
        ]}
      >
        <RoutingAffordance
          state="no_agent_available"
          availableRoles={['ceo', 'founding_engineer']}
        />
      </Section>

      <Section
        id="locked"
        title="8 · Locked by policy — override disabled (not removed)"
        captionLines={[
          'Review #7: `overrideable: false` renders a disabled trigger with policy tooltip.'
        ]}
      >
        <RoutingAffordance state="routed" decision={locked} />
      </Section>

      <Section
        id="contrast"
        title="9 · Contrast (computed, WCAG 2.2)"
        captionLines={[
          'Targets: text ≥ 4.5:1, border ≥ 3:1. Verified by tests/triage/tokens.test.ts.'
        ]}
      >
        <table style={contrastTableStyle}>
          <thead>
            <tr>
              <Th>Confidence</Th>
              <Th align="right">Text on bg</Th>
              <Th align="right">Border on bg</Th>
              <Th align="right">Text AA</Th>
              <Th align="right">Border AA</Th>
            </tr>
          </thead>
          <tbody>
            {ratios.map((r) => (
              <tr key={r.confidence}>
                <Td>
                  <strong>{r.confidence}</strong>
                </Td>
                <Td align="right">{r.textOnBg.toFixed(2)} : 1</Td>
                <Td align="right">{r.borderOnBg.toFixed(2)} : 1</Td>
                <Td align="right">{r.passesTextAA ? 'PASS' : 'FAIL'}</Td>
                <Td align="right">{r.passesBorderAA ? 'PASS' : 'FAIL'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </main>
  );
}

function Section({
  id,
  title,
  captionLines,
  children
}: {
  id: string;
  title: string;
  captionLines: string[];
  children: React.ReactNode;
}) {
  return (
    <section id={id} style={sectionStyle}>
      <h2 style={sectionTitleStyle}>{title}</h2>
      <ul style={captionListStyle}>
        {captionLines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div style={previewStyle}>{children}</div>
    </section>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      style={{
        textAlign: align ?? 'left',
        fontSize: 12,
        color: '#475569',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        borderBottom: '1px solid #e2e8f0',
        padding: '6px 8px',
        fontWeight: 500
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <td
      style={{
        textAlign: align ?? 'left',
        padding: '8px',
        borderBottom: '1px solid #e2e8f0',
        fontVariantNumeric: align === 'right' ? 'tabular-nums' : undefined,
        fontSize: 13
      }}
    >
      {children}
    </td>
  );
}

const pageStyle: CSSProperties = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  color: '#1a1d22',
  background: '#f7f8fa',
  minHeight: '100vh',
  padding: '32px 48px',
  maxWidth: 1200,
  margin: '0 auto'
};

const headerStyle: CSSProperties = {
  marginBottom: 24
};

const subtitleStyle: CSSProperties = {
  color: '#475569',
  fontSize: 13,
  marginTop: 4
};

const linkStyle: CSSProperties = {
  color: '#2563eb',
  textDecoration: 'none'
};

const sectionStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '20px 22px',
  marginBottom: 18
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 14,
  margin: 0,
  letterSpacing: 0.1
};

const captionListStyle: CSSProperties = {
  marginTop: 6,
  marginBottom: 14,
  paddingLeft: 18,
  color: '#475569',
  fontSize: 12,
  lineHeight: '18px'
};

const previewStyle: CSSProperties = {
  position: 'relative',
  background: '#fbfcfd',
  border: '1px dashed #e2e8f0',
  borderRadius: 8,
  padding: '24px 20px',
  minHeight: 80
};

const contrastTableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse'
};
