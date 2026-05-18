import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { createDraftIssue, type CreatedDraftIssue } from './create-draft-issue';
import type { DraftFrontMatter } from './front-matter';
import type { IntakeKind, IntakePayloadStore } from './payload-store';
import { describePayloadForLog } from './security';

// Single processing path shared by `/api/intake` (external bearer-token entry)
// and the `/intake` UI server action. Both go through here so the audit trail
// and idempotency model are identical.
//
// Pipeline:
//   1. Hash the canonical body bytes (sha256) — drives row-layer idempotency.
//   2. Upsert the raw payload into `intake_payloads`.
//   3. Build a stub front-matter envelope. L1.3 (LLM normalizer) will replace
//      the suggestedTag/suggestedNextAction/confidence fields once it ships.
//   4. createDraftIssue() — issue-layer idempotency via rawPayloadId.
//
// We deliberately do NOT log the raw body. Only a shape descriptor goes to
// the operator log; the durable copy is in `intake_payloads`.

export interface IntakeRequestSource {
  kind: IntakeKind;
  userId: string;
  client?: string;
  ip?: string;
  userAgent?: string;
  capturedAt?: Date;
}

export interface IntakeAttachmentRef {
  storageKey: string;
  filename: string;
  mimeType: string;
  byteLength: number;
}

export interface ProcessIntakeInput {
  body: string;
  attachments: IntakeAttachmentRef[];
  source: IntakeRequestSource;
}

export interface ProcessIntakeDeps {
  payloadStore: IntakePayloadStore;
  projectId: string;
  assigneeUserId: string;
  createDraftFn?: typeof createDraftIssue;
  logger?: { info: (msg: string, meta: Record<string, unknown>) => void };
}

export interface ProcessIntakeResult {
  draftIssueId: string;
  identifier: string;
  rawPayloadId: string;
  payloadCreated: boolean;
  draftCreated: boolean;
}

export async function processIntake(
  input: ProcessIntakeInput,
  deps: ProcessIntakeDeps
): Promise<ProcessIntakeResult> {
  const createDraftFn = deps.createDraftFn ?? createDraftIssue;
  const log = deps.logger ?? consoleLogger();

  const canonicalBody = input.body.replace(/\r\n/g, '\n');
  const payloadHash = sha256Hex(
    canonicalBody + '\n' + serializeAttachmentDigest(input.attachments)
  );
  const payloadId = randomUUID();
  const capturedAt = input.source.capturedAt ?? new Date();

  const upsert = await deps.payloadStore.upsert({
    id: payloadId,
    kind: input.source.kind,
    payloadHash,
    body: canonicalBody,
    attachmentRefs: input.attachments.map((a) => a.storageKey),
    sourceMeta: buildSourceMeta(input.source, input.attachments),
    capturedAt
  });

  const rawPayloadId = upsert.record.id;
  const title = buildDraftTitle(canonicalBody);
  const summary = buildDraftSummary(canonicalBody);
  const frontMatter: DraftFrontMatter = {
    sourcePointer: buildSourcePointer(input.source, canonicalBody, input.attachments),
    suggestedTag: 'todo',
    suggestedNextAction: 'Awaiting L1.3 normalizer — triage manually for now.',
    rawPayloadId,
    confidence: 0
  };

  const draft: CreatedDraftIssue = await createDraftFn(
    {
      title,
      summary,
      frontMatter,
      projectId: deps.projectId,
      assigneeUserId: deps.assigneeUserId,
      priority: 'medium'
    },
    {}
  );

  log.info('[intake] draft processed', {
    rawPayloadId,
    draftIssueId: draft.id,
    identifier: draft.identifier,
    payloadCreated: upsert.created,
    draftCreated: draft.created,
    kind: input.source.kind,
    userId: input.source.userId,
    bodyShape: describePayloadForLog(canonicalBody),
    attachments: input.attachments.length
  });

  return {
    draftIssueId: draft.id,
    identifier: draft.identifier,
    rawPayloadId,
    payloadCreated: upsert.created,
    draftCreated: draft.created
  };
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function buildDraftTitle(body: string): string {
  const firstLine =
    body
      .split('\n')
      .map((s) => s.trim())
      .find((s) => s.length > 0) ?? 'Untitled capture';
  if (firstLine.length <= 80) return firstLine;
  return firstLine.slice(0, 77).trimEnd() + '…';
}

export function buildDraftSummary(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length <= 600) return trimmed;
  return trimmed.slice(0, 597).trimEnd() + '…';
}

export function buildSourcePointer(
  source: IntakeRequestSource,
  body: string,
  attachments: IntakeAttachmentRef[]
): string {
  const parts: string[] = [`${source.kind}:user=${source.userId}`];
  if (source.client) parts.push(`client=${source.client}`);
  parts.push(`bytes=${Buffer.byteLength(body, 'utf8')}`);
  if (attachments.length > 0) parts.push(`attachments=${attachments.length}`);
  return parts.join(',');
}

function buildSourceMeta(
  source: IntakeRequestSource,
  attachments: IntakeAttachmentRef[]
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    userId: source.userId,
    kind: source.kind
  };
  if (source.client) meta.client = source.client;
  if (source.ip) meta.ip = source.ip;
  if (source.userAgent) meta.userAgent = source.userAgent;
  if (attachments.length > 0) {
    meta.attachments = attachments.map((a) => ({
      storageKey: a.storageKey,
      filename: a.filename,
      mimeType: a.mimeType,
      byteLength: a.byteLength
    }));
  }
  return meta;
}

function serializeAttachmentDigest(attachments: IntakeAttachmentRef[]): string {
  if (attachments.length === 0) return '';
  return attachments
    .map((a) => `${a.storageKey}|${a.filename}|${a.mimeType}|${a.byteLength}`)
    .join('\n');
}

function consoleLogger(): { info: (msg: string, meta: Record<string, unknown>) => void } {
  return {
    info(msg, meta) {
      try {
        // eslint-disable-next-line no-console
        console.log(msg, JSON.stringify(meta));
      } catch {
        // eslint-disable-next-line no-console
        console.log(msg);
      }
    }
  };
}
