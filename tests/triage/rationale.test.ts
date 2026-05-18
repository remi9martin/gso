import { describe, expect, it } from 'vitest';

import { plainLanguageRationale } from '@/src/triage/rationale';
import type { AffordanceDecision } from '@/src/triage/types';

const base: AffordanceDecision = {
  requestId: 'req',
  tier: 1,
  intentLabel: 'implement_feature',
  matchedPattern: 'implement',
  destinationRole: 'founding_engineer',
  confidence: 'high',
  overrideable: true
};

describe('plainLanguageRationale', () => {
  it('Tier 1 quotes the matched phrase, never the intent label', () => {
    const r = plainLanguageRationale(base);
    expect(r).toBe('Routed to FoundingEngineer because the request contains "implement".');
    expect(r).not.toContain('implement_feature');
    expect(r).not.toContain('Tier');
  });

  it('Tier 1 with no matched pattern omits the because-clause', () => {
    const r = plainLanguageRationale({ ...base, matchedPattern: null });
    expect(r).toBe('Routed to FoundingEngineer.');
  });

  it('Tier 2 says best guess (no exact rule matched)', () => {
    const r = plainLanguageRationale({
      ...base,
      tier: 2,
      confidence: 'medium',
      matchedPattern: null,
      destinationRole: 'ux_designer',
      intentLabel: 'ux_review'
    });
    expect(r).toBe('Best guess: UXDesigner (classified by AI, no exact rule matched).');
  });

  it('Tier 3 names CEO and asks for confirmation', () => {
    const r = plainLanguageRationale({
      ...base,
      tier: 3,
      confidence: 'low',
      matchedPattern: null,
      destinationRole: 'ceo',
      intentLabel: 'unknown'
    });
    expect(r).toBe('No rule matched — defaulted to CEO. Please confirm or override.');
  });
});
