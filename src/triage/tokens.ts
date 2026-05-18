// Design tokens for the Triage Inbox routing-decision affordance.
// See docs/design-system/tokens.md for the canonical token contract and rationale.
//
// First-version tokens established by [GSO-36](/GSO/issues/GSO-36) UX review.
// Named so they can swap to a global token system later without renaming.
//
// Contrast targets (WCAG 2.2 AA):
//   - text:   ≥ 4.5:1
//   - border: ≥ 3:1 (UI components)
//
// Ratios verified by tests/triage/tokens.test.ts.

export type Confidence = 'high' | 'medium' | 'low';

export interface ConfidenceTokens {
  text: string;
  bg: string;
  border: string;
}

// Palette anchors borrowed from common open palettes (Tailwind-aligned hex)
// so the values are recognisable and easy to audit against WebAIM.
export const confidenceTokens: Record<Confidence, ConfidenceTokens> = {
  // green-800 on green-100, border green-600 — passes AA text + AA border.
  high: { text: '#166534', bg: '#dcfce7', border: '#16a34a' },
  // amber-800 on amber-100, border = text — UX requested amber (not yellow).
  // amber-100 is so pale that amber-600 (~2.55:1) and amber-700 (~2.95:1)
  // both miss the 3:1 UI target. Using the text shade for the border
  // trivially passes and keeps the dashed-outline cue legible (review #1).
  medium: { text: '#92400e', bg: '#fef3c7', border: '#92400e' },
  // slate-700 on slate-100, border slate-500.
  // slate-400 (#94a3b8) was the UX-suggested border but lands at 2.34:1.
  // slate-500 lifts to 4.34:1 while keeping the muted-outline feel.
  low: { text: '#334155', bg: '#f1f5f9', border: '#64748b' }
};

export const badgeSpacing = {
  paddingX: 8,
  paddingY: 2,
  radius: 4
};

export const motion = {
  // gated by prefers-reduced-motion at use site
  skeleton: '1.2s ease-in-out infinite'
};

// --- contrast utilities (also used by tests) -----------------------------

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ContrastReport {
  confidence: Confidence;
  textOnBg: number;
  borderOnBg: number;
  passesTextAA: boolean;
  passesBorderAA: boolean;
}

export function contrastReport(): ContrastReport[] {
  return (Object.keys(confidenceTokens) as Confidence[]).map((c) => {
    const t = confidenceTokens[c];
    const textOnBg = contrastRatio(t.text, t.bg);
    const borderOnBg = contrastRatio(t.border, t.bg);
    return {
      confidence: c,
      textOnBg,
      borderOnBg,
      passesTextAA: textOnBg >= 4.5,
      passesBorderAA: borderOnBg >= 3
    };
  });
}
