import type { IntakePayload } from './types';

// System prompt + few-shot examples for the L1 normalizer.
//
// Calibration note: the four examples below are starter material derived from
// the legacy MVP Ingest pipeline (see RRR-GSO-GSCRT/deploy-online/gso-advisor.js
// and the seed prompts shipped under GSO-70). They cover the four payload
// shapes named in GSO-125 acceptance criteria: typed note, forwarded email,
// raw URL, screenshot caption. Once Remi (CEO) provides 5-10 real intake
// samples, swap these examples in place — the prompt structure stays
// identical, only the FEW_SHOTS array changes.

export const SYSTEM_PROMPT = `You are the GSO intake normalizer. You receive a raw payload captured from one
of the founder's input channels (typed note, forwarded email, raw URL, or
screenshot caption) and turn it into a structured Draft.

Your job:
1. Read the payload.
2. Produce a clean one-line title (verb-led where possible, <= 12 words).
3. Produce a one-paragraph description that preserves the substance of the
   payload — do NOT invent facts, names, or URLs that are not in the input.
4. Tag the payload with exactly one of: venture | project | idea | todo.
   - venture: an entirely new line of business / company.
   - project: a multi-step initiative inside an existing venture.
   - idea: a thought worth keeping but not yet committed to action.
   - todo: a single concrete next action.
5. Suggest one concrete suggestedNextAction — a single verb-led sentence the
   user can act on in <30 minutes.
6. Self-report a confidence score in [0, 1] for your suggestedTag.
   - 0.9+ if the payload contains explicit signals (e.g., "new venture:", "todo:").
   - 0.5-0.8 if you inferred from context.
   - <0.5 if you genuinely could not tell — pick the closest tag and lower
     confidence so the Triage Inbox can flag it for human review.

Hard rules:
- NEVER invent facts that are not in the payload.
- Output ONLY a single JSON object. No prose, no fences, no commentary.
- The JSON object MUST match this schema exactly:
  {
    "title": string,
    "description": string,
    "suggestedTag": "venture" | "project" | "idea" | "todo",
    "suggestedNextAction": string,
    "confidence": number
  }`;

interface FewShot {
  payload: string;
  output: string;
}

const FEW_SHOTS: FewShot[] = [
  {
    payload: `kind: capture
sourceMeta: {"client":"web"}
body: |
  ai-powered inbox sweeper for founders — single canonical view across email,
  slack, linear. could be a real venture, not just a feature. start by drafting
  the one-pager.`,
    output: JSON.stringify({
      title: 'AI-powered inbox sweeper for founders',
      description:
        'A single canonical view that consolidates email, Slack, and Linear into one founder inbox. Captured as a potential standalone venture rather than a feature.',
      suggestedTag: 'venture',
      suggestedNextAction: 'Draft the one-pager for the inbox sweeper venture.',
      confidence: 0.82
    })
  },
  {
    payload: `kind: email
sourceMeta: {"from":"sam@example.com","subject":"Re: Q3 partnership terms"}
body: |
  Quick follow-up — can you send the revised term sheet by Friday? Legal
  wants to circulate it before our board meeting next week.`,
    output: JSON.stringify({
      title: 'Send Sam the revised Q3 term sheet by Friday',
      description:
        "Sam (sam@example.com) is asking for the revised Q3 partnership term sheet by Friday so legal can circulate it before next week's board meeting.",
      suggestedTag: 'todo',
      suggestedNextAction: 'Send the revised Q3 term sheet to Sam by Friday.',
      confidence: 0.95
    })
  },
  {
    payload: `kind: capture
sourceMeta: {"client":"shortcut"}
body: |
  https://example.com/blog/post-on-vector-databases`,
    output: JSON.stringify({
      title: 'Read blog post on vector databases',
      description:
        'A URL was captured pointing to a blog post about vector databases. No additional context was provided alongside the link.',
      suggestedTag: 'idea',
      suggestedNextAction: 'Skim the linked post and capture one takeaway.',
      confidence: 0.55
    })
  },
  {
    payload: `kind: capture
sourceMeta: {"client":"screenshot","caption":"slack #leads channel"}
body: |
  Caption: slack #leads channel
  OCR: "we need to ship the new pricing page by end of month — three customers
  asked about enterprise tier last week"`,
    output: JSON.stringify({
      title: 'Ship the new enterprise pricing page by end of month',
      description:
        'Screenshot from the #leads Slack channel notes three customers asked about an enterprise tier last week and frames a target of shipping the new pricing page by end of month.',
      suggestedTag: 'project',
      suggestedNextAction:
        'Audit the current pricing page and list the gaps for an enterprise tier.',
      confidence: 0.78
    })
  }
];

export function buildUserPrompt(payload: IntakePayload): string {
  const sourceMeta = payload.sourceMeta ? JSON.stringify(payload.sourceMeta) : '{}';
  const attachments = (payload.attachmentRefs ?? []).join(', ') || '(none)';

  const fewShotBlock = FEW_SHOTS.map(
    (s, i) => `### Example ${i + 1}\nInput:\n${s.payload}\n\nOutput:\n${s.output}`
  ).join('\n\n');

  const target = renderPayloadForPrompt(payload, sourceMeta, attachments);

  return `${fewShotBlock}

### Now normalize this payload
${target}

Respond with ONLY the JSON object — no prose, no fences, no commentary.`;
}

function renderPayloadForPrompt(
  payload: IntakePayload,
  sourceMeta: string,
  attachments: string
): string {
  return `kind: ${payload.kind}
sourceMeta: ${sourceMeta}
attachmentRefs: ${attachments}
body: |
${indent(payload.body, '  ')}`;
}

function indent(text: string, prefix: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => prefix + line)
    .join('\n');
}

/**
 * Builds the deterministic `sourcePointer` string the persisted Draft will
 * carry. Independent of the LLM so it cannot be hallucinated — the audit trail
 * always reflects what the capture layer actually saw.
 */
export function buildSourcePointer(payload: IntakePayload): string {
  const byteCount = byteLength(payload.body);
  const parts: string[] = [];
  parts.push(payload.kind);
  const meta = payload.sourceMeta ?? {};
  const orderedKeys = Object.keys(meta).sort();
  for (const key of orderedKeys) {
    const value = meta[key];
    if (value == null) continue;
    const flat = typeof value === 'string' ? value : JSON.stringify(value);
    parts.push(`${key}=${flat}`);
  }
  parts.push(`bytes=${byteCount}`);
  return parts.join(',');
}

function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return Buffer.byteLength(text, 'utf8');
}
