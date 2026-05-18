import { describe, expect, it } from 'vitest';

import { fixtureBundle } from '@/lib/canvas/fixture';
import { buildSummary, isOverloaded } from '@/lib/canvas/filter';

describe('fixtureBundle', () => {
  it('returns a non-empty bundle so the canvas never goes blank when env is absent', () => {
    const b = fixtureBundle();
    expect(b.companyId).toBe('demo-company');
    expect(b.nodes.length).toBeGreaterThan(0);
  });

  it('contains a tree (root + descendants) — single root, others report to someone in the set', () => {
    const b = fixtureBundle();
    const ids = new Set(b.nodes.map((n) => n.org.agentId));
    const roots = b.nodes.filter(
      (n) => !n.org.reportsToAgentId || !ids.has(n.org.reportsToAgentId)
    );
    expect(roots.length).toBe(1);
  });

  it('demonstrates the wedge signal: at least one overloaded agent so reviewers see the affordance', () => {
    const b = fixtureBundle();
    const overloadedCount = b.nodes.filter(isOverloaded).length;
    expect(overloadedCount).toBeGreaterThan(0);
  });

  it('includes at least one agent with 0% budget utilisation — exercises the empty-track styling', () => {
    const b = fixtureBundle();
    const zeroBudget = b.nodes.filter((n) => n.budget.monthUtilizationPct === 0);
    expect(zeroBudget.length).toBeGreaterThan(0);
  });

  it('summary numbers are sane for the demo dataset', () => {
    const s = buildSummary(fixtureBundle());
    expect(s.totalAgents).toBeGreaterThanOrEqual(3);
    expect(s.openIssues).toBeGreaterThan(0);
  });
});
