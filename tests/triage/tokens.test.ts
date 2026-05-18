import { describe, expect, it } from 'vitest';

import { contrastRatio, contrastReport, confidenceTokens } from '@/src/triage/tokens';

describe('triage tokens — contrast', () => {
  it('contrastRatio is symmetric', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('every confidence pair meets WCAG AA for text and border', () => {
    const report = contrastReport();
    for (const row of report) {
      expect(row.passesTextAA, `${row.confidence} text AA`).toBe(true);
      expect(row.passesBorderAA, `${row.confidence} border AA`).toBe(true);
    }
  });

  it('tokens are stable hex values (regression guard)', () => {
    // If a future redesign moves these, screenshots in GSO-36 thread need
    // re-capturing. The test exists to force that conversation.
    expect(confidenceTokens.high.text).toBe('#166534');
    expect(confidenceTokens.medium.text).toBe('#92400e');
    expect(confidenceTokens.low.text).toBe('#334155');
  });
});
