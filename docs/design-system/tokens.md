# Design system tokens — v0

**Owner:** [UXDesigner](/GSO/agents/uxdesigner) · **Status:** v0 shipped · **Source of truth for:** anything visual in shipped GSO code

This is the canonical reference for the design tokens that exist **in the codebase today**. If you are implementing or reviewing a component that uses tokens, this is the doc you link to.

Two related documents live next to this one — know which you need:

| Doc | Scope |
|---|---|
| **This doc** (`docs/design-system/tokens.md`) | What is **implemented** right now. Every token here has a corresponding entry in source code. |
| [GSO-33 v0 token manifesto](/GSO/issues/GSO-33#document-tokens) | The full **proposed** v0 token set across the three surfaces (Org Canvas, Triage Inbox, Budget & Governance). Forward-looking; not all of it is implemented yet. |

When the manifesto values land in code, fold them into this doc and remove the entry from the manifesto. **This doc is the contract; the manifesto is the roadmap.**

---

## How to use this doc

- **Implementing a new component?** If you need a value that isn't here yet, check the [manifesto](/GSO/issues/GSO-33#document-tokens). If it isn't there either, that's a system-level proposal — open an issue and tag UXDesigner before inlining a one-off.
- **Opening a PR that uses or adds tokens?** Link this doc in the PR description (`docs/design-system/tokens.md`). If you are adding tokens, update this doc in the same PR and tag UXDesigner for review.
- **Modifying an existing token value?** Read the *Why* notes below. Two of the tokens here deviate from their original spec for **accessibility (WCAG AA contrast) reasons**. Changing them without re-running contrast checks is a regression — see §3.

---

## 1 · Tokens shipped in v0

All tokens live in `src/triage/tokens.ts` today. They will migrate to a shared `src/styles/tokens.ts` (or equivalent build-time codegen target) when the second component arrives — track that work via the manifesto.

### 1.1 `color.confidence.*`

Three-tier confidence ramp for routing-decision badges (Triage Inbox affordance, [GSO-35](/GSO/issues/GSO-35)).

| Token | Foreground | Background | Border | Use |
|---|---|---|---|---|
| `color.confidence.high` | green-600 (`#16a34a`) | green-50 (`#f0fdf4`) | green-600 (`#16a34a`) | Tier 1 deterministic matches — high-confidence routing. |
| `color.confidence.medium` | amber-700 (`#b45309`) | amber-50 (`#fffbeb`) | amber-700 (`#b45309`) ⚠️ see §3 | Tier 2 LLM matches — medium-confidence routing. |
| `color.confidence.low` | slate-600 (`#475569`) | slate-100 (`#f1f5f9`) | slate-500 (`#64748b`) ⚠️ see §3 | Tier 3 fallback / "?low default" — uncertain routing. |

**Contrast ratios (verified WCAG AA at the implementation):**

| Token | Text on bg | Border on bg | AA pass? |
|---|---|---|---|
| `color.confidence.high` | 6.49:1 | 3.00:1 | ✅ text AAA; ✅ border AA (non-text minimum 3:1) |
| `color.confidence.medium` | 6.37:1 | 6.37:1 | ✅ text AAA; ✅ border AAA |
| `color.confidence.low` | 9.45:1 | 4.34:1 | ✅ text AAA; ✅ border AA |

**Color-independence rule (required):** confidence color must never be the *only* signal. Every badge pairs the color with a text label (`high` / `~medium` / `?low default`) and a shape treatment (solid vs outlined vs dashed). This is a hard requirement — see [GSO-36 sign-off](/GSO/issues/GSO-36) for the 10-point checklist.

### 1.2 `spacing.badge.*`

| Token | Value | Use |
|---|---|---|
| `spacing.badge.x` | `8px` | Horizontal padding inside a confidence badge. |
| `spacing.badge.y` | `2px` | Vertical padding inside a confidence badge. |

These compose to a `8px × 2px` inset and were tuned to keep badges scannable in dense Triage Inbox rows without dominating the row's primary content.

### 1.3 `radius.badge`

| Token | Value | Use |
|---|---|---|
| `radius.badge` | `4px` | Confidence badge corner radius. Slightly softer than a hard rectangle, but reads as a tag rather than a pill. |

### 1.4 `motion.skeleton`

| Token | Value | Use |
|---|---|---|
| `motion.skeleton` | `1.2s ease-in-out infinite` | Pulse cycle for routing-decision loading skeleton (`↺ Routing…`). |

**Reduced motion (required):** the animation MUST be gated by `@media (prefers-reduced-motion: reduce)`. Implementation collapses the pulse to a static state. This is a hard accessibility requirement, not a polish item — see WCAG 2.3.3.

---

## 2 · Where each token is used today

| Token | Component(s) | Surface |
|---|---|---|
| `color.confidence.*` | Routing-decision badge | Triage Inbox |
| `spacing.badge.*` | Routing-decision badge | Triage Inbox |
| `radius.badge` | Routing-decision badge | Triage Inbox |
| `motion.skeleton` | Routing-decision loading state (`↺ Routing…`) | Triage Inbox |

When a second component starts consuming any of these, add it to this table in the same PR.

---

## 3 · AA-driven deviations from the original spec ⚠️

These two values **intentionally diverge** from the original [GSO-33 manifesto](/GSO/issues/GSO-33#document-tokens) suggestions because the manifesto values failed WCAG AA contrast at implementation time. **Do not "fix" these back to the manifesto values without re-running contrast checks.**

### 3.1 `color.confidence.medium` border uses text color, not amber-600

- **Original spec:** border = amber-600 (`#d97706`)
- **Shipped:** border = amber-700 (`#b45309`) — same as the text color
- **Why:** amber-600 on amber-50 measures **2.55:1**, which fails WCAG AA non-text contrast (3:1 minimum). Using the text color lifts the border to **6.37:1** — comfortably AAA.
- **How to apply:** if a future component reuses the medium ramp and you want a distinct border color, source it from a swatch that hits ≥3:1 against `amber-50` and update this doc.

### 3.2 `color.confidence.low` border uses slate-500, not slate-400

- **Original spec:** border = slate-400 (`#94a3b8`)
- **Shipped:** border = slate-500 (`#64748b`)
- **Why:** slate-400 on slate-100 measures **2.34:1**, which fails WCAG AA non-text contrast. slate-500 lifts the border to **4.34:1** — clears AA.
- **How to apply:** same as §3.1 — any swap needs ≥3:1 against `slate-100`.

> Reviewing a PR that changes either of these values? Ask for a fresh contrast measurement against the relevant background before approving. The `tokens.ts` source already calls these deviations out inline — keep that comment if you touch the values.

---

## 4 · Linking this doc from PRs

Every PR that introduces, modifies, or reuses tokens should link this doc. Add one line to the PR description:

```
Design tokens: docs/design-system/tokens.md
```

If the PR introduces a *new* token, also:
1. Add the token to §1 of this doc in the same PR.
2. Add the consuming component to §2.
3. Tag `[@UXDesigner](agent://f4cd9567-e951-4e9a-96ef-b15506a0d83e)` for review.

If the PR introduces a new token that maps to something in the [GSO-33 manifesto](/GSO/issues/GSO-33#document-tokens), prefer the manifesto's naming so we don't fork the namespace.

---

## 5 · Open follow-ups

- **Hoist tokens out of `src/triage/tokens.ts`** when the second component lands. Target location: `src/styles/tokens.ts` (or wherever the build pipeline expects). Not blocking v0.
- **Live-row anchoring eyeball** on the override dropdown once the affordance is wired into the actual Triage Inbox page (flagged in [GSO-36](/GSO/issues/GSO-36) sign-off). Not a token issue but lives in the same surface.
- **Burn ramp + full color/type/spacing/motion families** from the [GSO-33 manifesto](/GSO/issues/GSO-33#document-tokens) will land here as their consuming components ship (Org Canvas → burn ramp; Budget dashboard → KPI tokens).

---

## Change log

| Date | Change | Author |
|---|---|---|
| 2026-05-17 | Initial v0 doc covering the four token families shipped with [GSO-35](/GSO/issues/GSO-35). | UXDesigner ([GSO-62](/GSO/issues/GSO-62)) |
