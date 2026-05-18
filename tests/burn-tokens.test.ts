import { describe, expect, it } from 'vitest';

import { BURN_BREAKPOINTS, burnStateFor } from '@/styles/tokens';

describe('BURN_BREAKPOINTS', () => {
  it('mirrors the canonical GSO-46 ramp values', () => {
    expect(BURN_BREAKPOINTS.warning).toBe(0.6);
    expect(BURN_BREAKPOINTS.alert).toBe(0.8);
    expect(BURN_BREAKPOINTS.critical).toBe(0.95);
  });
});

describe('burnStateFor', () => {
  it('returns healthy below the warning breakpoint', () => {
    expect(burnStateFor(0)).toBe('healthy');
    expect(burnStateFor(0.59)).toBe('healthy');
  });

  it('returns warning at the 0.60 boundary', () => {
    expect(burnStateFor(0.6)).toBe('warning');
    expect(burnStateFor(0.79)).toBe('warning');
  });

  it('returns alert at the 0.80 boundary', () => {
    expect(burnStateFor(0.8)).toBe('alert');
    expect(burnStateFor(0.94)).toBe('alert');
  });

  it('returns critical at and above the 0.95 boundary', () => {
    expect(burnStateFor(0.95)).toBe('critical');
    expect(burnStateFor(1)).toBe('critical');
    expect(burnStateFor(1.5)).toBe('critical');
  });
});
