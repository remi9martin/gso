// Front-matter block embedded in the Draft issue description.
//
// The block is YAML-shaped but we keep parsing trivial: scalar key/value lines
// only. This is deliberate — the L1 normalizer produces well-known fields
// (no nested structures, no multi-line strings), and a flat parser keeps the
// round-trip readable in the Paperclip UI without pulling in a YAML dep.

const FENCE = '---';

export type SuggestedTag = 'venture' | 'project' | 'idea' | 'todo' | 'needs_human';

export interface DraftFrontMatter {
  sourcePointer: string;
  suggestedTag: SuggestedTag;
  suggestedNextAction: string;
  rawPayloadId: string;
  confidence: number;
}

const REQUIRED_KEYS: ReadonlyArray<keyof DraftFrontMatter> = [
  'sourcePointer',
  'suggestedTag',
  'suggestedNextAction',
  'rawPayloadId',
  'confidence'
];

export function renderDraftDescription(summary: string, frontMatter: DraftFrontMatter): string {
  const lines = [
    FENCE,
    `sourcePointer: ${escapeValue(frontMatter.sourcePointer)}`,
    `suggestedTag: ${frontMatter.suggestedTag}`,
    `suggestedNextAction: ${escapeValue(frontMatter.suggestedNextAction)}`,
    `rawPayloadId: ${frontMatter.rawPayloadId}`,
    `confidence: ${frontMatter.confidence}`,
    FENCE,
    '',
    summary.trim()
  ];
  return lines.join('\n');
}

export function parseDraftDescription(description: string): {
  summary: string;
  frontMatter: DraftFrontMatter;
} {
  const lines = description.split(/\r?\n/);
  if (lines[0]?.trim() !== FENCE) {
    throw new Error('Draft description is missing the leading front-matter fence');
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FENCE) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new Error('Draft description is missing the closing front-matter fence');
  }

  const raw: Record<string, string> = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = unescapeValue(line.slice(colon + 1).trim());
    if (key) raw[key] = value;
  }

  for (const k of REQUIRED_KEYS) {
    if (!(k in raw)) throw new Error(`Draft front-matter is missing required key "${k}"`);
  }

  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Draft front-matter "confidence" must be a number in [0,1]`);
  }

  if (!isSuggestedTag(raw.suggestedTag)) {
    throw new Error(
      `Draft front-matter "suggestedTag" must be venture|project|idea|todo|needs_human`
    );
  }

  const summary = lines
    .slice(end + 1)
    .join('\n')
    .trim();

  return {
    summary,
    frontMatter: {
      sourcePointer: raw.sourcePointer,
      suggestedTag: raw.suggestedTag,
      suggestedNextAction: raw.suggestedNextAction,
      rawPayloadId: raw.rawPayloadId,
      confidence
    }
  };
}

function isSuggestedTag(value: string): value is SuggestedTag {
  return (
    value === 'venture' ||
    value === 'project' ||
    value === 'idea' ||
    value === 'todo' ||
    value === 'needs_human'
  );
}

function escapeValue(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim();
}

function unescapeValue(value: string): string {
  return value;
}
