// 25 labeled examples from the GSO-29 spec (#document-spec). Imported by the
// rules-engine vitest harness and any future eval scripts. Keep this list in
// sync with the spec; changes here are board-visible (acceptance threshold:
// at least 20/25 correct).

import type { AgentRole } from './rules-engine';

export interface LabeledExample {
  id: number;
  input: string;
  expected: AgentRole;
}

export const LABELED_TEST_SET: ReadonlyArray<LabeledExample> = [
  {
    id: 1,
    input: 'Implement drag-and-drop reordering in Org Canvas',
    expected: 'founding_engineer'
  },
  {
    id: 2,
    input: 'Fix the regression in the budget chart component',
    expected: 'founding_engineer'
  },
  {
    id: 3,
    input: 'Refactor the intent classifier into its own module',
    expected: 'founding_engineer'
  },
  { id: 4, input: 'Cut the v0.1 release branch', expected: 'founding_engineer' },
  { id: 5, input: 'Write a Dockerfile for the GSO backend', expected: 'founding_engineer' },
  { id: 6, input: 'Should we use tRPC or REST for the internal API?', expected: 'cto' },
  { id: 7, input: 'Review this PR adding the routing decision log', expected: 'cto' },
  { id: 8, input: 'Set up the CI pipeline on GitHub Actions', expected: 'cto' },
  { id: 9, input: "There's a possible auth bypass in the checkout flow", expected: 'cto' },
  {
    id: 10,
    input: 'We need to hire a backend engineer for the Paperclip adapter layer',
    expected: 'cto'
  },
  { id: 11, input: 'Design the empty state for the Triage Inbox', expected: 'ux_designer' },
  { id: 12, input: 'Create wireframes for the budget dashboard', expected: 'ux_designer' },
  {
    id: 13,
    input: 'Review accessibility — the routing badge has low contrast',
    expected: 'ux_designer'
  },
  {
    id: 14,
    input: 'The layout of the Org Canvas header looks off on mobile',
    expected: 'ux_designer'
  },
  { id: 15, input: 'Make a user flow for agent onboarding', expected: 'ux_designer' },
  { id: 16, input: 'Approve the $200/mo spend on Resend for transactional email', expected: 'ceo' },
  { id: 17, input: 'What should our v1 pricing model look like?', expected: 'ceo' },
  { id: 18, input: 'We need to hire a content writer for the launch blog', expected: 'ceo' },
  { id: 19, input: 'A VC reached out — can we schedule an intro call?', expected: 'ceo' },
  { id: 20, input: 'Prepare the investor update for this week', expected: 'ceo' },
  { id: 21, input: 'Add pagination to the issue list endpoint', expected: 'founding_engineer' },
  {
    id: 22,
    input: 'Which observability stack should we adopt — Datadog vs Grafana?',
    expected: 'cto'
  },
  {
    id: 23,
    input: 'The button hover state does not match the design system',
    expected: 'ux_designer'
  },
  { id: 24, input: 'Should we pivot to focus on enterprise customers?', expected: 'ceo' },
  { id: 25, input: 'Deploy the latest build to staging', expected: 'founding_engineer' }
];

export const PASS_THRESHOLD = 20; // 80% of 25
