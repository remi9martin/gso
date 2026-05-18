'use client';

// RoutingAffordance — destination badge + override menu for the Triage Inbox.
//
// Implements the changes-requested review on
// [GSO-36](/GSO/issues/GSO-36) for the affordance spec in
// [GSO-29](/GSO/issues/GSO-29#document-spec). Numbered review points are
// referenced inline so the next reviewer can map code → critique.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';

import { plainLanguageRationale } from './rationale';
import { ALL_ROLES, ROLE_CATALOG } from './roles';
import { badgeSpacing, confidenceTokens, motion, type Confidence } from './tokens';
import type { AffordanceDecision, AffordanceState, AgentRole } from './types';

export interface RoutingAffordanceProps {
  state: AffordanceState;
  // Only required when state === 'routed' or 'overridden'.
  decision?: AffordanceDecision;
  // The original Tier-1/2 suggestion; required when state === 'overridden'
  // so we can render "→ CEO (overridden) was: FoundingEngineer" (review #4).
  overriddenFrom?: AgentRole;
  // Required when state === 'overridden' — the role the user picked.
  overriddenTo?: AgentRole;
  // Roles for which the company currently has at least one available agent.
  availableRoles?: AgentRole[];
  onOverride?: (role: AgentRole | null) => void;
  // Demo-only: force the override menu open on first render (used by the
  // /triage screenshot page so we can capture the open-state without scripting
  // hover/click on a static page).
  initiallyOpen?: boolean;
}

// Review #1 — non-color confidence prefix. Color is the secondary cue; the
// text label is the primary cue. high has no prefix (solid badge is plenty
// of differentiation), medium gets `~`, low gets `?` plus a `default` suffix.
function confidencePrefix(confidence: Confidence): string {
  switch (confidence) {
    case 'high':
      return '';
    case 'medium':
      return '~';
    case 'low':
      return '?';
  }
}

function confidenceLabel(confidence: Confidence): string {
  return `${confidencePrefix(confidence)}${confidence}${confidence === 'low' ? ' default' : ''}`;
}

function badgeStyle(confidence: Confidence, variant: 'solid' | 'outlined'): CSSProperties {
  const t = confidenceTokens[confidence];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: `${badgeSpacing.paddingY}px ${badgeSpacing.paddingX}px`,
    borderRadius: badgeSpacing.radius,
    background: variant === 'solid' ? t.bg : 'transparent',
    color: t.text,
    border: `1px ${variant === 'solid' ? 'solid' : 'dashed'} ${t.border}`,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 0.1,
    lineHeight: '16px',
    whiteSpace: 'nowrap'
  };
}

// ---------------------------------------------------------------------------

export function RoutingAffordance(props: RoutingAffordanceProps): JSX.Element {
  switch (props.state) {
    case 'loading':
      return <LoadingBadge />;
    case 'no_agent_available':
      return <NoAgentBadge {...props} />;
    case 'overridden':
      return <OverriddenLayout {...props} />;
    case 'routed':
    default:
      return <RoutedLayout {...props} />;
  }
}

// ---------------------------------------------------------------------------
// Routed (Tier 1/2/3) — destination badge + rationale + override button.
// Reviews #1, #2, #3, #7, #8, #9, #10.

function RoutedLayout(props: RoutingAffordanceProps): JSX.Element {
  if (!props.decision) {
    throw new Error('RoutingAffordance: decision required when state="routed"');
  }
  const decision = props.decision;
  const destination = ROLE_CATALOG[decision.destinationRole];
  const rationale = plainLanguageRationale(decision);
  // Review #2: persistent rationale for medium/low, popover-on-click for high.
  const persistentRationale = decision.confidence !== 'high';
  const variant = decision.confidence === 'high' ? 'solid' : 'outlined';

  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <span style={badgeStyle(decision.confidence, variant)}>
          {/* Review #1 — color is decoration, label is the cue. */}
          <DestinationLabel agentName={destination.agentName} />
          <ConfidenceChip confidence={decision.confidence} />
          {!persistentRationale && <RationalePopoverButton rationale={rationale} />}
        </span>
        <OverrideMenu
          suggested={decision.destinationRole}
          overrideable={decision.overrideable}
          availableRoles={props.availableRoles ?? ALL_ROLES}
          onOverride={props.onOverride}
          initiallyOpen={props.initiallyOpen}
        />
      </div>
      {persistentRationale && (
        <p style={rationaleStyle} aria-live="polite">
          {rationale}
        </p>
      )}
    </div>
  );
}

function DestinationLabel({ agentName }: { agentName: string }): JSX.Element {
  return (
    <span style={{ fontWeight: 600 }}>
      <span aria-hidden style={{ marginRight: 2 }}>
        →
      </span>
      {agentName}
    </span>
  );
}

function ConfidenceChip({ confidence }: { confidence: Confidence }): JSX.Element {
  // Review #1: label is the cue — `high`, `~medium`, `?low default`.
  const label = confidenceLabel(confidence);
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        opacity: 0.85,
        letterSpacing: 0.2,
        textTransform: 'lowercase'
      }}
      // SR users: prefix the human-readable confidence
      aria-label={`Confidence ${confidence}`}
    >
      · {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Rationale popover — keyboard-accessible, click/Enter/Space to open.
// Review #2 (no hover-only), Review #10 (keyboard contract).

function RationalePopoverButton({ rationale }: { rationale: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!buttonRef.current?.parentElement?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label="Why this route"
        onClick={() => setOpen((o) => !o)}
        style={iconButtonStyle}
      >
        i
      </button>
      {open && (
        <span id={popoverId} role="dialog" style={popoverStyle}>
          {rationale}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Override menu — real <button>, keyboard nav, Esc closes, focus returns.
// Reviews #7, #8, #9, #10.

interface OverrideMenuProps {
  suggested: AgentRole;
  overrideable: boolean;
  availableRoles: AgentRole[];
  onOverride?: (role: AgentRole | null) => void;
  initiallyOpen?: boolean;
}

function OverrideMenu(props: OverrideMenuProps): JSX.Element {
  const [open, setOpen] = useState(Boolean(props.initiallyOpen));
  const [focusIdx, setFocusIdx] = useState(0);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Review #9: first item is always "Keep suggested" anchor.
  const items = useMemo(() => {
    const others = props.availableRoles.filter((r) => r !== props.suggested);
    return [
      {
        kind: 'keep' as const,
        role: props.suggested,
        label: `Keep suggested: ${ROLE_CATALOG[props.suggested].agentName}`,
        description: ROLE_CATALOG[props.suggested].description
      },
      ...others.map((role) => ({
        kind: 'role' as const,
        role,
        label: ROLE_CATALOG[role].agentName,
        description: ROLE_CATALOG[role].description
      }))
    ];
  }, [props.availableRoles, props.suggested]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const within =
        trigger.contains(e.target as Node) ||
        itemRefs.current.some((el) => el?.contains(e.target as Node));
      if (!within) close(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, close]);

  // Focus the active item when the menu opens or focusIdx changes.
  useEffect(() => {
    if (open) itemRefs.current[focusIdx]?.focus();
  }, [open, focusIdx]);

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!props.overrideable) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
      setFocusIdx(0);
    }
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusIdx(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setFocusIdx(items.length - 1);
    }
  };

  const pick = (role: AgentRole, isKeep: boolean) => {
    close(true);
    props.onOverride?.(isKeep ? null : role);
  };

  if (!props.overrideable) {
    // Review #7 — disabled (not removed) state with policy explanation.
    return (
      <button
        type="button"
        disabled
        aria-label="This route is locked by policy"
        title="This route is locked by policy"
        style={{ ...triggerStyle, ...triggerDisabledStyle }}
      >
        Override ▾
      </button>
    );
  }

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          setOpen((o) => !o);
          setFocusIdx(0);
        }}
        onKeyDown={onTriggerKeyDown}
        style={triggerStyle}
      >
        Override ▾
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Override destination"
          onKeyDown={onMenuKeyDown}
          style={menuStyle}
        >
          {items.map((item, idx) => (
            <button
              key={`${item.kind}-${item.role}`}
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
              role="menuitem"
              type="button"
              tabIndex={idx === focusIdx ? 0 : -1}
              onClick={() => pick(item.role, item.kind === 'keep')}
              onMouseEnter={() => setFocusIdx(idx)}
              style={{
                ...menuItemStyle,
                ...(idx === focusIdx ? menuItemFocusedStyle : null)
              }}
            >
              <span style={menuItemTopStyle}>
                {item.kind === 'keep' && (
                  <span aria-hidden style={{ marginRight: 6 }}>
                    ✓
                  </span>
                )}
                <span style={{ fontWeight: 600 }}>{item.label}</span>
              </span>
              <span style={menuItemDescStyle}>{item.description}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Overridden layout — Review #4. Shows both signals; auditable + reversible.

function OverriddenLayout(props: RoutingAffordanceProps): JSX.Element {
  if (!props.overriddenFrom || !props.overriddenTo) {
    throw new Error('RoutingAffordance: overriddenFrom/To required');
  }
  const to = ROLE_CATALOG[props.overriddenTo];
  const from = ROLE_CATALOG[props.overriddenFrom];

  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <span style={overriddenBadgeStyle}>
          <span aria-hidden style={{ marginRight: 2 }}>
            →
          </span>
          <strong>{to.agentName}</strong>
          <span style={overriddenChipStyle}>(overridden)</span>
        </span>
        <span style={wasNoteStyle}>was: {from.agentName}</span>
        <OverrideMenu
          suggested={props.overriddenFrom}
          overrideable={true}
          availableRoles={props.availableRoles ?? ALL_ROLES}
          onOverride={props.onOverride}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading — Review #5. Skeleton-ish badge with 'Routing…' label.

function LoadingBadge(): JSX.Element {
  return (
    <div style={containerStyle}>
      <span
        style={{
          ...badgeStyle('low', 'outlined'),
          background: '#f1f5f9',
          color: '#475569'
        }}
        aria-busy
      >
        <span className="gso-pulse" aria-hidden style={pulseDotStyle} />
        Routing…
      </span>
      <style>{`
        @keyframes gso-pulse-kf {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 1; }
        }
        .gso-pulse { animation: gso-pulse-kf ${motion.skeleton}; }
        @media (prefers-reduced-motion: reduce) {
          .gso-pulse { animation: none; opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// No agent available — Review #6. Surface the error, open override by default.

function NoAgentBadge(props: RoutingAffordanceProps): JSX.Element {
  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <span style={errorBadgeStyle} role="status">
          <span aria-hidden style={{ marginRight: 4 }}>
            ⚠
          </span>
          No agent available — assign manually
        </span>
        <OverrideMenu
          suggested={props.decision?.destinationRole ?? 'ceo'}
          overrideable={true}
          availableRoles={props.availableRoles ?? ALL_ROLES}
          onOverride={props.onOverride}
          initiallyOpen
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline style atoms (deliberately co-located — matches the rest of the app).

const containerStyle: CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  gap: 4,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  color: '#1a1d22',
  maxWidth: 520
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8
};

const rationaleStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: '16px',
  color: '#475569',
  maxWidth: 480
};

const iconButtonStyle: CSSProperties = {
  marginLeft: 4,
  width: 16,
  height: 16,
  borderRadius: 999,
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  fontSize: 10,
  fontWeight: 700,
  fontFamily: 'serif',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  lineHeight: 1
};

const popoverStyle: CSSProperties = {
  position: 'absolute',
  top: '120%',
  left: 0,
  zIndex: 10,
  background: '#1a1d22',
  color: '#ffffff',
  padding: '8px 10px',
  borderRadius: 6,
  fontSize: 12,
  lineHeight: '16px',
  width: 280,
  boxShadow: '0 8px 20px rgba(0, 0, 0, 0.18)'
};

const triggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 500,
  background: '#ffffff',
  color: '#334155',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif'
};

const triggerDisabledStyle: CSSProperties = {
  cursor: 'not-allowed',
  color: '#94a3b8',
  background: '#f8fafc',
  borderColor: '#e2e8f0'
};

const menuStyle: CSSProperties = {
  position: 'absolute',
  top: '110%',
  right: 0,
  zIndex: 20,
  minWidth: 260,
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)',
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 2
};

const menuItemStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  textAlign: 'left',
  padding: '8px 10px',
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  color: '#1a1d22',
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13
};

const menuItemFocusedStyle: CSSProperties = {
  background: '#eff6ff',
  outline: '2px solid #2563eb',
  outlineOffset: -2
};

const menuItemTopStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center'
};

const menuItemDescStyle: CSSProperties = {
  fontSize: 11,
  color: '#64748b'
};

const overriddenBadgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: `${badgeSpacing.paddingY}px ${badgeSpacing.paddingX}px`,
  borderRadius: badgeSpacing.radius,
  background: '#eff6ff',
  color: '#1e3a8a',
  border: '1px solid #93c5fd',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: '16px'
};

const overriddenChipStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  opacity: 0.8
};

const wasNoteStyle: CSSProperties = {
  fontSize: 11,
  color: '#64748b',
  fontStyle: 'italic'
};

const errorBadgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: `${badgeSpacing.paddingY}px ${badgeSpacing.paddingX}px`,
  borderRadius: badgeSpacing.radius,
  background: '#fef2f2',
  color: '#991b1b',
  border: '1px solid #f87171',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: '16px'
};

const pulseDotStyle: CSSProperties = {
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: 999,
  background: '#94a3b8'
};
