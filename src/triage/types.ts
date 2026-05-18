// Public types for the Triage Inbox routing affordance.
//
// The persisted RoutingDecision lives in src/routing/rules-engine.ts. This
// module surfaces only the fields the affordance needs, plus the UI-only
// states (loading, no_agent_available, overridden) that have no analogue in
// the decision record itself.

export type AgentRole = 'cto' | 'founding_engineer' | 'ux_designer' | 'ceo';

export type Confidence = 'high' | 'medium' | 'low';

// UI display states for the affordance. `routed` covers high/medium/low; the
// other variants are non-decision states (waiting, error, post-override).
export type AffordanceState = 'routed' | 'loading' | 'no_agent_available' | 'overridden';

export interface AffordanceDecision {
  requestId: string;
  tier: 1 | 2 | 3;
  intentLabel: string;
  // Internal — kept for analytics tooltip but never surfaced verbatim per
  // [GSO-36 review point #3](/GSO/issues/GSO-36).
  matchedPattern: string | null;
  destinationRole: AgentRole;
  confidence: Confidence;
  overrideable: boolean;
}
