// Plain-language rationale strings for the routing-decision affordance.
//
// UX review [GSO-36](/GSO/issues/GSO-36) point #3: never surface
// `Matched: 'implement' → implement_feature (Tier 1)` to a user. The
// internal `intentLabel`/`matchedPattern` stay in the persisted record for
// analytics; this module converts them into one-line plain English.

import { ROLE_CATALOG } from './roles';
import type { AffordanceDecision } from './types';

export function plainLanguageRationale(decision: AffordanceDecision): string {
  const dest = ROLE_CATALOG[decision.destinationRole].agentName;
  switch (decision.tier) {
    case 1: {
      const phrase = decision.matchedPattern
        ? ` because the request contains "${decision.matchedPattern}"`
        : '';
      return `Routed to ${dest}${phrase}.`;
    }
    case 2:
      return `Best guess: ${dest} (classified by AI, no exact rule matched).`;
    case 3:
      return `No rule matched — defaulted to ${dest}. Please confirm or override.`;
  }
}
