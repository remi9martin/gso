// Brief renderer for the cross-company dispatch bridge (GSO-140).
//
// Renders the 7-section dispatch brief defined in
// /GSO/issues/GSO-118#document-brief-template. The renderer is pure — it takes
// a normalized DispatchBriefInput and returns markdown. Section 7's mirror
// link is rendered as a {{MIRROR_LINK}} placeholder; the dispatcher fills it
// in after the mirror is created.

export const MIRROR_LINK_PLACEHOLDER = '{{MIRROR_LINK}}';

export type DoorTag = 'two-way' | 'one-way';

export interface SourceIssueLike {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
  assigneeAgentId: string | null;
}

export interface AncestorLike {
  identifier: string;
  title: string;
}

export interface NamedEntityLike {
  name?: string | null;
  description?: string | null;
}

export interface EscalationLike {
  primary?: string | null;
  secondary?: string | null;
}

export interface DispatchBriefInput {
  sourceIssue: SourceIssueLike;
  ancestors: AncestorLike[];
  project?: NamedEntityLike | null;
  goal?: NamedEntityLike | null;
  originCompanyPrefix: string;
  escalation?: EscalationLike;
}

export interface ExtractedSections {
  acceptance: string;
  blastRadius: string | null;
  door: DoorTag | null;
}

export interface BriefRenderResult {
  body: string;
  extracted: ExtractedSections;
  defaults: {
    doorDefaulted: boolean;
    blastRadiusDefaulted: boolean;
  };
}

export class DispatchBriefError extends Error {
  constructor(
    public readonly code: 'missing-acceptance',
    message: string
  ) {
    super(message);
    this.name = 'DispatchBriefError';
  }
}

const SECTION_HEADERS = [
  '## Acceptance',
  '## Acceptance criteria',
  '## Blast radius',
  '## Blast-radius',
  '## Escalation',
  '## Escalation path',
  '## Two-way-door classification',
  '## Two-way door classification',
  '## Source link',
  '## Source link (round-trip)',
  '## Dependencies',
  '## Context',
  '## Scope',
  '## Title'
];

function nextHeaderIndex(body: string, fromIndex: number): number {
  let earliest = body.length;
  for (const h of SECTION_HEADERS) {
    const idx = body.indexOf(`\n${h}`, fromIndex);
    if (idx !== -1 && idx < earliest) earliest = idx;
  }
  // Also break on any other ## H2 to be conservative.
  const generic = body.indexOf('\n## ', fromIndex);
  if (generic !== -1 && generic < earliest) earliest = generic;
  return earliest;
}

function sliceSection(body: string, header: RegExp): string | null {
  const m = header.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = nextHeaderIndex(body, start);
  return body.slice(start, end).trim();
}

export function extractAcceptance(body: string): string | null {
  const re = /(^|\n)##\s+Acceptance(?:\s+criteria)?\s*\n/i;
  return sliceSection(body, re);
}

export function extractBlastRadius(body: string): string | null {
  const re = /(^|\n)##\s+Blast[\s-]radius\s*\n/i;
  return sliceSection(body, re);
}

export function extractDoorTag(body: string): DoorTag | null {
  // Look for the door emoji or the literal "two-way door" / "one-way door"
  // phrase anywhere in the body. Two doors = two-way, one door = one-way.
  if (/🚪🚪/.test(body) || /\btwo[-\s]?way\s+door\b/i.test(body)) return 'two-way';
  if (/🚪/.test(body) || /\bone[-\s]?way\s+door\b/i.test(body)) return 'one-way';
  return null;
}

export function extractSections(body: string): ExtractedSections | { error: 'missing-acceptance' } {
  const acceptance = extractAcceptance(body);
  if (!acceptance) return { error: 'missing-acceptance' };
  return {
    acceptance,
    blastRadius: extractBlastRadius(body),
    door: extractDoorTag(body)
  };
}

function bullets(lines: ReadonlyArray<string | null | undefined>): string {
  const kept = lines.map((l) => (l == null ? '' : l.trim())).filter((l) => l.length > 0);
  if (kept.length === 0) return '_None recorded._';
  return kept.map((l) => `- ${l}`).join('\n');
}

function paragraphContext(input: DispatchBriefInput): string {
  const parts: string[] = [];
  const desc = (input.sourceIssue.description ?? '').trim();
  if (desc) {
    // Use the first paragraph of the description as the synthesized context.
    // Skip leading headers so we don't pick up "## Context" verbatim.
    const firstParagraph = desc
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .find((p) => p.length > 0 && !p.startsWith('#'));
    if (firstParagraph) parts.push(firstParagraph);
  }
  if (input.goal?.name || input.goal?.description) {
    const goalLine = input.goal.name
      ? `Goal: **${input.goal.name}**${input.goal.description ? ` — ${input.goal.description}` : ''}`
      : `Goal: ${input.goal.description}`;
    parts.push(goalLine);
  }
  if (input.project?.name) parts.push(`Project: **${input.project.name}**`);
  if (parts.length === 0) {
    parts.push(`Dispatched from ${input.sourceIssue.identifier}: ${input.sourceIssue.title}`);
  }
  return parts.join('\n\n');
}

function originIssueLink(input: DispatchBriefInput): string {
  const id = input.sourceIssue.identifier;
  return `[${id}](/${input.originCompanyPrefix}/issues/${id})`;
}

function ancestorTrail(input: DispatchBriefInput): string {
  if (input.ancestors.length === 0) return '_No parent issues._';
  return input.ancestors
    .map((a) => `[${a.identifier}](/${input.originCompanyPrefix}/issues/${a.identifier}) — ${a.title}`)
    .map((l) => `- ${l}`)
    .join('\n');
}

export function renderBrief(input: DispatchBriefInput): BriefRenderResult {
  const description = input.sourceIssue.description ?? '';
  const extracted = extractSections(description);
  if ('error' in extracted) {
    throw new DispatchBriefError(
      'missing-acceptance',
      `Source issue ${input.sourceIssue.identifier} has no \`## Acceptance\` block — refusing to dispatch unscoped work.`
    );
  }

  const doorDefaulted = extracted.door == null;
  const blastRadiusDefaulted = extracted.blastRadius == null;
  const door: DoorTag = extracted.door ?? 'two-way';
  const blastRadius =
    extracted.blastRadius ??
    '_Not classified in source. Dispatcher defaulted to two-way door — confirm with origin before any one-way action._';

  const doorLine =
    door === 'two-way'
      ? `🚪🚪 **Two-way door** — easily reversed; ship and iterate.`
      : `🚪 **One-way door** — hard to reverse; require board approval before non-trivial action.`;

  const escalationPrimary = input.escalation?.primary?.trim();
  const escalationSecondary = input.escalation?.secondary?.trim();

  const sections: string[] = [];

  sections.push(`# ${input.sourceIssue.title}`);

  sections.push('## 1. Title');
  sections.push(input.sourceIssue.title);

  sections.push('## 2. Context');
  sections.push(paragraphContext(input));
  sections.push(
    bullets([
      `**Source signal:** ${originIssueLink(input)}`,
      `**Ancestor trail:**`
    ])
  );
  sections.push(ancestorTrail(input));

  sections.push('## 3. Acceptance criteria');
  sections.push(extracted.acceptance);

  sections.push('## 4. Blast radius');
  sections.push(blastRadius);
  if (blastRadiusDefaulted) {
    sections.push('> ⚠️ **Defaulted** by dispatcher — source did not declare a blast radius.');
  }

  sections.push('## 5. Escalation path');
  sections.push(
    bullets([
      escalationPrimary ? `**Primary:** ${escalationPrimary}` : null,
      escalationSecondary ? `**Secondary:** ${escalationSecondary}` : null,
      `**Hard stop:** escalate back to the origin issue ${originIssueLink(input)} via Paperclip comment.`
    ])
  );

  sections.push('## 6. Two-way-door classification');
  sections.push(doorLine);
  if (doorDefaulted) {
    sections.push('> ⚠️ **Defaulted** by dispatcher — source did not declare a door tag.');
  }

  sections.push('## 7. Source link (round-trip)');
  sections.push(
    bullets([
      `**Origin issue:** ${originIssueLink(input)}`,
      `**Origin company:** ${input.originCompanyPrefix}`,
      `**Mirror issue:** ${MIRROR_LINK_PLACEHOLDER}`
    ])
  );

  return {
    body: sections.join('\n\n') + '\n',
    extracted,
    defaults: { doorDefaulted, blastRadiusDefaulted }
  };
}

export function fillMirrorLink(body: string, mirrorMarkdownLink: string): string {
  return body.split(MIRROR_LINK_PLACEHOLDER).join(mirrorMarkdownLink);
}
