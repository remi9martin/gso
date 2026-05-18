// B4 palette — burn ramp constants. Canonical per [GSO-46](/GSO/issues/GSO-46).
//
// The CSS vars in styles/tokens.css mirror these breakpoints; the JSON in
// styles/tokens.json mirrors the same values for any non-JS consumer.
// A3's burn-bar component must consume burnStateFor(ratio) — no inline ratios.

export const BURN_BREAKPOINTS = {
  warning: 0.6,
  alert: 0.8,
  critical: 0.95
} as const;

export type BurnState = 'healthy' | 'warning' | 'alert' | 'critical';

export function burnStateFor(ratio: number): BurnState {
  if (ratio >= BURN_BREAKPOINTS.critical) return 'critical';
  if (ratio >= BURN_BREAKPOINTS.alert) return 'alert';
  if (ratio >= BURN_BREAKPOINTS.warning) return 'warning';
  return 'healthy';
}
