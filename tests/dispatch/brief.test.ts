import { describe, expect, it } from 'vitest';

import {
  DispatchBriefError,
  MIRROR_LINK_PLACEHOLDER,
  extractAcceptance,
  extractBlastRadius,
  extractDoorTag,
  fillMirrorLink,
  renderBrief,
  type DispatchBriefInput
} from '@/lib/dispatch/brief';

const HAPPY_DESCRIPTION = `## Context

Some context paragraph that the renderer will pick up.

## Acceptance

- [ ] Foo works.
- [ ] Bar works.

## Blast radius

🚪🚪 **Two-way door** — pure code change, easily reverted.
`;

const MISSING_ACCEPTANCE_DESCRIPTION = `## Context

Important issue with no acceptance section.

## Blast radius

🚪🚪 Two-way door.
`;

const MISSING_BLAST_RADIUS_DESCRIPTION = `## Context

Important.

## Acceptance

- [ ] One.
`;

function makeInput(overrides: Partial<DispatchBriefInput> = {}): DispatchBriefInput {
  return {
    sourceIssue: {
      id: 'src-1',
      identifier: 'GSO-200',
      title: 'Build the thing',
      description: HAPPY_DESCRIPTION,
      priority: 'high',
      assigneeAgentId: 'agent-x'
    },
    ancestors: [
      { identifier: 'GSO-100', title: 'Parent goal' },
      { identifier: 'GSO-50', title: 'Grandparent goal' }
    ],
    project: { name: 'GSO v0', description: 'Operating layer.' },
    goal: { name: 'Cross-company dispatch', description: 'Mirror work into siblings.' },
    originCompanyPrefix: 'GSO',
    escalation: { primary: 'FoundingEngineer', secondary: 'CTO' },
    ...overrides
  };
}

describe('extractAcceptance', () => {
  it('returns the acceptance block contents', () => {
    expect(extractAcceptance(HAPPY_DESCRIPTION)).toBe('- [ ] Foo works.\n- [ ] Bar works.');
  });

  it('returns null when the section is missing', () => {
    expect(extractAcceptance(MISSING_ACCEPTANCE_DESCRIPTION)).toBeNull();
  });

  it('accepts the "Acceptance criteria" variant', () => {
    const body = '## Acceptance criteria\n\n- [ ] Yes.\n';
    expect(extractAcceptance(body)).toBe('- [ ] Yes.');
  });
});

describe('extractBlastRadius', () => {
  it('returns the blast radius block', () => {
    expect(extractBlastRadius(HAPPY_DESCRIPTION)).toContain('Two-way door');
  });

  it('returns null when missing', () => {
    expect(extractBlastRadius(MISSING_BLAST_RADIUS_DESCRIPTION)).toBeNull();
  });
});

describe('extractDoorTag', () => {
  it('detects two-way via emoji', () => {
    expect(extractDoorTag('Blast: 🚪🚪 two-way')).toBe('two-way');
  });

  it('detects one-way via phrase', () => {
    expect(extractDoorTag('This is a one-way door call.')).toBe('one-way');
  });

  it('returns null when neither is present', () => {
    expect(extractDoorTag('No classification here.')).toBeNull();
  });
});

describe('renderBrief — happy path', () => {
  it('renders all 7 sections with the mirror placeholder', () => {
    const result = renderBrief(makeInput());
    const sections = [
      '## 1. Title',
      '## 2. Context',
      '## 3. Acceptance criteria',
      '## 4. Blast radius',
      '## 5. Escalation path',
      '## 6. Two-way-door classification',
      '## 7. Source link (round-trip)'
    ];
    for (const s of sections) {
      expect(result.body, `expected section ${s}`).toContain(s);
    }
    expect(result.body).toContain('Build the thing');
    expect(result.body).toContain('- [ ] Foo works.');
    expect(result.body).toContain('🚪🚪');
    expect(result.body).toContain(MIRROR_LINK_PLACEHOLDER);
    expect(result.body).toContain('[GSO-200](/GSO/issues/GSO-200)');
    expect(result.body).toContain('[GSO-100](/GSO/issues/GSO-100)');
    expect(result.defaults.doorDefaulted).toBe(false);
    expect(result.defaults.blastRadiusDefaulted).toBe(false);
  });

  it('uses the goal and project in the synthesized context', () => {
    const result = renderBrief(makeInput());
    expect(result.body).toContain('Goal:');
    expect(result.body).toContain('Cross-company dispatch');
    expect(result.body).toContain('Project:');
    expect(result.body).toContain('GSO v0');
  });

  it('includes escalation primary and secondary', () => {
    const result = renderBrief(makeInput());
    expect(result.body).toContain('**Primary:** FoundingEngineer');
    expect(result.body).toContain('**Secondary:** CTO');
  });
});

describe('renderBrief — missing acceptance', () => {
  it('throws DispatchBriefError with the missing-acceptance code', () => {
    const input = makeInput({
      sourceIssue: {
        id: 'src-2',
        identifier: 'GSO-300',
        title: 'Unscoped',
        description: MISSING_ACCEPTANCE_DESCRIPTION,
        priority: 'low',
        assigneeAgentId: null
      }
    });

    try {
      renderBrief(input);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DispatchBriefError);
      expect((err as DispatchBriefError).code).toBe('missing-acceptance');
      expect((err as Error).message).toContain('GSO-300');
    }
  });

  it('also throws when the description is empty', () => {
    const input = makeInput({
      sourceIssue: {
        id: 'src-2',
        identifier: 'GSO-301',
        title: 'Empty',
        description: '',
        priority: 'low',
        assigneeAgentId: null
      }
    });
    expect(() => renderBrief(input)).toThrowError(DispatchBriefError);
  });
});

describe('renderBrief — missing blast radius defaults to two-way with a flag', () => {
  it('marks blast-radius and door as defaulted and renders the two-way classification', () => {
    const input = makeInput({
      sourceIssue: {
        id: 'src-3',
        identifier: 'GSO-302',
        title: 'No blast radius',
        description: MISSING_BLAST_RADIUS_DESCRIPTION,
        priority: 'medium',
        assigneeAgentId: null
      }
    });

    const result = renderBrief(input);
    expect(result.defaults.blastRadiusDefaulted).toBe(true);
    expect(result.defaults.doorDefaulted).toBe(true);
    expect(result.body).toContain('🚪🚪 **Two-way door**');
    expect(result.body).toContain('Defaulted');
    expect(result.body).toContain('## 4. Blast radius');
  });
});

describe('fillMirrorLink', () => {
  it('replaces the placeholder with the supplied link', () => {
    const result = renderBrief(makeInput());
    const filled = fillMirrorLink(result.body, '[SIB-12](/SIB/issues/SIB-12)');
    expect(filled).not.toContain(MIRROR_LINK_PLACEHOLDER);
    expect(filled).toContain('[SIB-12](/SIB/issues/SIB-12)');
  });
});
