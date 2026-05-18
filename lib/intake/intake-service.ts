import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { createDraftIssue, type CreatedDraftIssue } from './create-draft-issue';
import type { DraftFrontMatter } from './front-matter';
import type { Draft, IntakePayload, Normalizer } from './normalizer/types';
import type { IntakeKind, IntakePayloadStore } from './payload-store';
import { describePayloadForLog } from './security';

// Single processing path shared by `/api/intake` (external bearer-token entry),
// `/intake` UI server action, and `/api/intake/email` (Cloudflare worker).
// All three go through here so the audit trail and idempotency model are
// identical.
//
// Pipeline:
//   1. Hash the canonical body bytes (sha256) — drives row-layer idempotency.
//   2. Upsert the raw payload into `intake_payloads`.
//   3. Run the L1.3 normalizer on the persisted payload. The normalizer is
//      injectable so /api/intake/email can pass a venture-domain hint without
//      breaking the bearer-token route.
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
  /**
   * Optional structured hints handed to the normalizer (e.g., email subject,
   * from-domain). Persisted on `intake_payloads.source_meta`.
   */
  hints?: Record<string, unknown>;
}

export interface ProcessIntakeDeps {
  payloadStore: IntakePayloadStore;
  projectId: string;
  assigneeUserId: string;
  /**
   * L1.3 normalizer. Optional only because the request path may want to skip
   * normalization for replays — in production, callers always pass one.
   * When undefined, the service falls back to a low-confidence stub draft so
   * the pipeline still produces something triagable.
   */
  normalizer?: Normalizer;
  createDraftFn?: typeof createDraftIssue;
  logger?: { info: (msg: string, meta: Record<string, unknown>) => void };
}

export interface ProcessIntakeResult {
  draftIssueId: string;
  identifier: string;
  rawPayloadId: string;
  payloadCreated: boolean;
  draftCreated: boolean;
  servedBy: string;
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
  const sourceMeta = buildSourceMeta(input.source, input.attachments, input.hints);
  const attachmentRefs = input.attachments.map((a) => a.storageKey);

  const upsert = await deps.payloadStore.upsert({
    id: payloadId,
    kind: input.source.kind,
    payloadHash,
    body: canonicalBody,
    attachmentRefs,
    sourceMeta,
    capturedAt
  });

  const rawPayloadId = upsert.record.id;

  const draft = await normalizePayload(
    {
      id: rawPayloadId,
      kind: input.source.kind,
      body: canonicalBody,
      sourceMeta,
      attachmentRefs,
      capturedAt: capturedAt.toISOString()
    },
    deps.normalizer,
    input,
    rawPayloadId,
    log
  );

  const frontMatter: DraftFrontMatter = {
    sourcePointer: draft.sourcePointer,
    suggestedTag: draft.suggestedTag,
    suggestedNextAction: draft.suggestedNextAction,
    rawPayloadId,
    confidence: draft.confidence
  };

  const issue: CreatedDraftIssue = await createDraftFn(
    {
      title: draft.title,
      summary: draft.description,
      frontMatter,
      projectId: deps.projectId,
      assigneeUserId: deps.assigneeUserId,
      priority: 'medium'
    },
    {}
  );

  // userId intentionally omitted from log meta — durable copy lives on
  // intake_payloads.source_meta. CodeQL js/clear-text-logging flags it as
  // potentially sensitive flow even though our userIds are env-derived UUIDs.
  log.info('[intake] draft processed', {
    rawPayloadId,
    draftIssueId: issue.id,
    identifier: issue.identifier,
    payloadCreated: upsert.created,
    draftCreated: issue.created,
    kind: input.source.kind,
    servedBy: draft.servedBy,
    bodyShape: describePayloadForLog(canonicalBody),
    attachments: input.attachments.length
  });

  return {
    draftIssueId: issue.id,
    identifier: issue.identifier,
    rawPayloadId,
    payloadCreated: upsert.created,
    draftCreated: issue.created,
    servedBy: draft.servedBy
  };
}

async function normalizePayload(
  payload: IntakePayload,
  normalizer: Normalizer | undefined,
  input: ProcessIntakeInput,
  rawPayloadId: string,
  log: { info: (msg: string, meta: Record<string, unknown>) => void }
): Promise<Draft> {
  if (normalizer) {
    try {
      return await normalizer.normalize(payload);
    } catch (err) {
      log.info('[intake] normalizer failed; using stub draft', {
        rawPayloadId,
        kind: input.source.kind,
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return buildStubDraft(payload, input, rawPayloadId);
}

function buildStubDraft(
  payload: IntakePayload,
  input: ProcessIntakeInput,
  rawPayloadId: string
): Draft {
  return {
    title: buildDraftTitle(payload.body),
    description: buildDraftSummary(payload.body),
    sourcePointer: buildSourcePointer(input.source, payload.body, input.attachments),
    suggestedTag: 'needs_human',
    suggestedNextAction: 'L1.3 normalizer unavailable — triage this draft manually.',
    rawPayloadId,
    confidence: 0,
    servedBy: 'stub-no-normalizer'
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
  attachments: IntakeAttachmentRef[],
  hints?: Record<string, unknown>
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
  if (hints && Object.keys(hints).length > 0) {
    meta.hints = hints;
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
        console.log(msg, JSON.stringify(meta));
      } catch {
        console.log(msg);
      }
    }
  };
}
