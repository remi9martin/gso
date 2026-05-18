import { describe, expect, it } from 'vitest';

import {
  NULL_CLASSIFIER,
  routeRequest,
  type AgentRoster,
  type IntentClassifier,
  type RoutingDecision
} from '@/src/routing/rules-engine';
import { LABELED_TEST_SET, PASS_THRESHOLD } from '@/src/routing/test-set';

const ROSTER: AgentRoster = {
  cto: 'agent-cto',
  founding_engineer: 'agent-founding-engineer',
  ux_designer: 'agent-ux-designer',
  ceo: 'agent-ceo'
};

function silentRoute(input: string, classifier?: IntentClassifier) {
  return routeRequest(input, ROSTER, {
    classifier: classifier ?? NULL_CLASSIFIER,
    logger: () => {}
  });
}

describe('rules-engine labeled set (25 examples, ≥20 required)', () => {
  it(`routes at least ${PASS_THRESHOLD} of ${LABELED_TEST_SET.length} examples correctly`, async () => {
    const rows: Array<{
      id: number;
      input: string;
      expected: string;
      actual: string;
      tier: number;
      intent: string;
      pass: boolean;
    }> = [];

    for (const example of LABELED_TEST_SET) {
      const decision = await silentRoute(example.input);
      rows.push({
        id: example.id,
        input: example.input,
        expected: example.expected,
        actual: decision.destinationRole,
        tier: decision.tier,
        intent: decision.intentLabel,
        pass: decision.destinationRole === example.expected
      });
    }

    const passed = rows.filter((r) => r.pass).length;

    // Per-case result table to stdout (AC: "output per-case result table").
    const table = rows.map((r) => ({
      '#': r.id,
      pass: r.pass ? 'PASS' : 'FAIL',
      tier: r.tier,
      intent: r.intent,
      expected: r.expected,
      actual: r.actual,
      input: r.input
    }));

    console.log(`\nrouting test-set: ${passed}/${rows.length} passed`);

    console.table(table);

    expect(passed).toBeGreaterThanOrEqual(PASS_THRESHOLD);
  });
});

describe('rules-engine decision shape and logging', () => {
  it('produces a RoutingDecision with all required fields', async () => {
    const decision = await silentRoute('Implement the Org Canvas reorder flow');
    expect(decision).toMatchObject({
      tier: 1,
      destinationRole: 'founding_engineer',
      destinationAgentId: 'agent-founding-engineer',
      confidence: 'high',
      overrideable: true
    });
    expect(decision.requestId).toMatch(/[0-9a-f-]{36}/i);
    expect(decision.intentLabel).toBe('implement_feature');
    expect(decision.matchedPattern).toBe('implement');
    expect(() => new Date(decision.timestamp).toISOString()).not.toThrow();
  });

  it('logs structured JSON containing the required keys', async () => {
    const logged: RoutingDecision[] = [];
    await routeRequest('Set up the CI pipeline on GitHub Actions', ROSTER, {
      logger: (record) => logged.push(record),
      classifier: NULL_CLASSIFIER
    });
    expect(logged).toHaveLength(1);
    const [record] = logged;
    for (const key of [
      'requestId',
      'intentLabel',
      'destinationRole',
      'confidence',
      'tier'
    ] as const) {
      expect(record[key]).toBeDefined();
    }
    expect(record.tier).toBe(1);
    expect(record.destinationRole).toBe('cto');
  });
});

describe('rules-engine Tier 2 LLM fallback', () => {
  it('uses Tier 2 label when classifier returns a known intent', async () => {
    const classifier: IntentClassifier = {
      classify: async () => 'business_strategy'
    };
    const decision = await silentRoute(
      'Some opaque request with no Tier 1 hit at all here',
      classifier
    );
    expect(decision.tier).toBe(2);
    expect(decision.intentLabel).toBe('business_strategy');
    expect(decision.destinationRole).toBe('ceo');
    expect(decision.confidence).toBe('medium');
    expect(decision.matchedPattern).toBeNull();
  });

  it('falls through to Tier 3 (→ ceo, low) when classifier returns unknown', async () => {
    const decision = await silentRoute('xyzzy plover frobnicate the widget');
    expect(decision.tier).toBe(3);
    expect(decision.intentLabel).toBe('unknown');
    expect(decision.destinationRole).toBe('ceo');
    expect(decision.confidence).toBe('low');
    expect(decision.matchedPattern).toBeNull();
  });

  it('falls through to Tier 3 when the classifier exceeds the timeout', async () => {
    const slow: IntentClassifier = {
      classify: () => new Promise((resolve) => setTimeout(() => resolve('refactor'), 200))
    };
    const decision = await routeRequest('totally novel request body', ROSTER, {
      classifier: slow,
      llmTimeoutMs: 25,
      logger: () => {}
    });
    expect(decision.tier).toBe(3);
    expect(decision.destinationRole).toBe('ceo');
    expect(decision.confidence).toBe('low');
  });

  it('falls through to Tier 3 when the classifier throws', async () => {
    const broken: IntentClassifier = {
      classify: async () => {
        throw new Error('boom');
      }
    };
    const decision = await silentRoute('mysterious unsorted request payload', broken);
    expect(decision.tier).toBe(3);
    expect(decision.destinationRole).toBe('ceo');
  });
});
