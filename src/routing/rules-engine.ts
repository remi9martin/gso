// GSO Triage Inbox — Rules Engine v0
// Spec: GSO-29 (#document-spec). Routes board/user requests to an agent role via
// (Tier 1) deterministic keyword patterns, (Tier 2) optional LLM classification
// with a 5s timeout, (Tier 3) catch-all → CEO.

import { randomUUID } from 'node:crypto';

export type AgentRole = 'cto' | 'founding_engineer' | 'ux_designer' | 'ceo';

export type Confidence = 'high' | 'medium' | 'low';

export interface AgentRoster {
  cto: string;
  founding_engineer: string;
  ux_designer: string;
  ceo: string;
}

export interface RoutingDecision {
  requestId: string;
  inputText: string;
  tier: 1 | 2 | 3;
  intentLabel: string;
  matchedPattern: string | null;
  destinationRole: AgentRole;
  destinationAgentId: string;
  confidence: Confidence;
  timestamp: string;
  overrideable: boolean;
}

interface Rule {
  intent: string;
  patterns: string[];
  destination: AgentRole;
}

// Ordered most-specific to least-specific. First match wins.
// Verb/noun phrases that are unambiguous come before generic single words
// (e.g. `code_review` before `ux_review`, `infra` before `architecture`,
// founding_engineer action verbs before `budget_approval`'s broad "budget" token).
export const RULES: Rule[] = [
  {
    intent: 'code_review',
    patterns: ['review this pr', 'lgtm', 'approve this change', 'code review'],
    destination: 'cto'
  },
  {
    intent: 'security',
    patterns: [
      'auth bypass',
      'token leak',
      'access control',
      'threat model',
      'vulnerability',
      'security'
    ],
    destination: 'cto'
  },
  {
    intent: 'infra',
    patterns: [
      'ci pipeline',
      'github actions',
      'dockerfile',
      'terraform',
      'k8s',
      'secrets vault',
      'pipeline',
      'infra'
    ],
    destination: 'cto'
  },
  {
    intent: 'hire_engineer',
    patterns: [
      'hire an engineer',
      'hire a backend engineer',
      'hire a frontend engineer',
      'hire a developer',
      'need a developer',
      'post eng role',
      'engineer for'
    ],
    destination: 'cto'
  },
  {
    intent: 'ux_design',
    patterns: ['design the', 'wireframe', 'prototype', 'user flow', 'information architecture'],
    destination: 'ux_designer'
  },
  {
    intent: 'ux_review',
    patterns: [
      'review the ux',
      'accessibility',
      'color contrast',
      'design system',
      'hover state',
      'looks off',
      'ui looks',
      'layout review',
      'layout',
      'font'
    ],
    destination: 'ux_designer'
  },
  {
    intent: 'architecture_decision',
    patterns: [
      'architecture',
      'should we use',
      'which database',
      'which observability',
      'observability stack',
      'system design',
      'how should we structure'
    ],
    destination: 'cto'
  },
  {
    intent: 'external_comms',
    patterns: [
      'respond to partner',
      'customer message',
      'email to',
      'reached out',
      'intro call',
      'legal'
    ],
    destination: 'ceo'
  },
  {
    intent: 'board_reporting',
    patterns: ['board update', 'investor', 'deck', 'metrics report'],
    destination: 'ceo'
  },
  {
    intent: 'business_strategy',
    patterns: ['strategy', 'pivot', 'market fit', 'roadmap priority', 'vision'],
    destination: 'ceo'
  },
  {
    intent: 'gtm',
    patterns: ['launch', 'marketing', 'press', 'outreach', 'partnerships', 'gtm'],
    destination: 'ceo'
  },
  {
    intent: 'hire_non_engineer',
    patterns: [
      'hire a designer',
      'hire a marketer',
      'hire a content writer',
      'hire a content',
      'post role for'
    ],
    destination: 'ceo'
  },
  {
    intent: 'deploy',
    patterns: ['cut a release', 'deploy', 'release', 'ship'],
    destination: 'founding_engineer'
  },
  {
    intent: 'fix_bug',
    patterns: ['failing test', 'not working', 'error in', 'regression', 'broken', 'bug', 'fix the'],
    destination: 'founding_engineer'
  },
  {
    intent: 'refactor',
    patterns: ['refactor', 'clean up', 'rename', 'extract', 'move to'],
    destination: 'founding_engineer'
  },
  {
    intent: 'implement_feature',
    patterns: [
      'implement',
      'add feature',
      'create endpoint',
      'add pagination',
      'pagination',
      'endpoint',
      'write code for',
      'build'
    ],
    destination: 'founding_engineer'
  },
  {
    intent: 'budget_approval',
    patterns: ['approve spend', 'cost approval', 'pricing', 'invoice', 'spend', 'budget'],
    destination: 'ceo'
  }
];

// All known intent labels (used for Tier 2 prompt + validation).
export const INTENT_LABELS: ReadonlyArray<string> = [...new Set(RULES.map((r) => r.intent))];

const INTENT_TO_DESTINATION: Map<string, AgentRole> = new Map(
  RULES.map((r) => [r.intent, r.destination])
);

export interface IntentClassifier {
  classify(input: string, intents: ReadonlyArray<string>): Promise<string>;
}

// Default Tier 2 classifier — always returns "unknown" so we fall through to
// Tier 3 unless the caller injects a real LLM-backed classifier. Keeps the
// engine deterministic in CI and avoids accidental API calls.
export const NULL_CLASSIFIER: IntentClassifier = {
  classify: async () => 'unknown'
};

export interface RouteRequestOptions {
  classifier?: IntentClassifier;
  llmTimeoutMs?: number; // default 5000 per spec
  requestId?: string;
  now?: () => Date;
  logger?: (record: RoutingDecision) => void;
}

const DEFAULT_LLM_TIMEOUT_MS = 5000;

function matchTier1(loweredInput: string): { rule: Rule; matchedPattern: string } | null {
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (loweredInput.includes(pattern)) {
        return { rule, matchedPattern: pattern };
      }
    }
  }
  return null;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function defaultLogger(record: RoutingDecision): void {
  // Required keys per AC: requestId, intentLabel, destinationRole, confidence, tier.
  // We log the full record — it is a strict superset.
  console.log(JSON.stringify(record));
}

export async function routeRequest(
  input: string,
  agentRoster: AgentRoster,
  options: RouteRequestOptions = {}
): Promise<RoutingDecision> {
  const classifier = options.classifier ?? NULL_CLASSIFIER;
  const llmTimeoutMs = options.llmTimeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  const requestId = options.requestId ?? randomUUID();
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? defaultLogger;
  const loweredInput = input.toLowerCase();

  let decision: RoutingDecision;

  const tier1 = matchTier1(loweredInput);
  if (tier1) {
    decision = {
      requestId,
      inputText: input,
      tier: 1,
      intentLabel: tier1.rule.intent,
      matchedPattern: tier1.matchedPattern,
      destinationRole: tier1.rule.destination,
      destinationAgentId: agentRoster[tier1.rule.destination],
      confidence: 'high',
      timestamp: now().toISOString(),
      overrideable: true
    };
  } else {
    // Tier 2 — LLM classification with 5s timeout.
    let tier2Label: string | null = null;
    try {
      tier2Label = await withTimeout(
        classifier.classify(input, INTENT_LABELS),
        llmTimeoutMs,
        () => 'unknown'
      );
    } catch {
      tier2Label = null;
    }

    const tier2Destination = tier2Label && INTENT_TO_DESTINATION.get(tier2Label);

    if (tier2Destination) {
      decision = {
        requestId,
        inputText: input,
        tier: 2,
        intentLabel: tier2Label as string,
        matchedPattern: null,
        destinationRole: tier2Destination,
        destinationAgentId: agentRoster[tier2Destination],
        confidence: 'medium',
        timestamp: now().toISOString(),
        overrideable: true
      };
    } else {
      // Tier 3 — catch-all → CEO.
      decision = {
        requestId,
        inputText: input,
        tier: 3,
        intentLabel: 'unknown',
        matchedPattern: null,
        destinationRole: 'ceo',
        destinationAgentId: agentRoster.ceo,
        confidence: 'low',
        timestamp: now().toISOString(),
        overrideable: true
      };
    }
  }

  logger(decision);
  return decision;
}
