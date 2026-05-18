'use server';

import 'server-only';

import { IntakeConfigError, readIntakeConfig } from '@/lib/intake/config';
import { processIntake } from '@/lib/intake/intake-service';
import { getIntakePayloadStore } from '@/lib/intake/store-singleton';
import {
  checkAttachment,
  MAX_ATTACHMENT_BYTES,
  MAX_BODY_BYTES,
  MAX_TOTAL_BYTES
} from '@/lib/intake/security';
import { DEFAULT_INTAKE_RATE_LIMIT, getIntakeRateLimiter } from '@/lib/intake/rate-limit';

// Server action invoked by the /intake form. Runs in the trusted server
// context so we don't need to round-trip a token through the browser; the
// action does the same work as the /api/intake handler but skips bearer-token
// auth because the caller is already a same-origin Next session.
//
// Rate limit still applies (keyed by the configured UI user id) so a stuck
// client cannot spam the pipeline.

export interface IntakeUiResult {
  ok: true;
  draftIssueId: string;
  identifier: string;
  rawPayloadId: string;
  draftCreated: boolean;
  draftUrl: string;
  title: string;
}

export interface IntakeUiError {
  ok: false;
  error: string;
  message: string;
}

export async function submitIntakeUi(formData: FormData): Promise<IntakeUiResult | IntakeUiError> {
  let config;
  try {
    config = readIntakeConfig();
  } catch (err) {
    if (err instanceof IntakeConfigError) {
      return { ok: false, error: 'intake_not_configured', message: err.message };
    }
    throw err;
  }

  const bodyValue = formData.get('body');
  if (typeof bodyValue !== 'string' || bodyValue.trim().length === 0) {
    return {
      ok: false,
      error: 'invalid_request',
      message: 'Please type or paste something to capture.'
    };
  }
  if (Buffer.byteLength(bodyValue, 'utf8') > MAX_BODY_BYTES) {
    return {
      ok: false,
      error: 'payload_too_large',
      message: `Body exceeds the ${MAX_BODY_BYTES.toLocaleString()} byte text limit.`
    };
  }

  const attachmentFields = formData.getAll('attachment');
  const attachments: Array<{
    storageKey: string;
    filename: string;
    mimeType: string;
    byteLength: number;
  }> = [];
  let runningTotal = Buffer.byteLength(bodyValue, 'utf8');

  for (const entry of attachmentFields) {
    if (typeof entry === 'string') continue;
    const file = entry as File;
    if (file.size === 0) continue;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return {
        ok: false,
        error: 'attachment_too_large',
        message: `${file.name || 'attachment'}: ${file.size.toLocaleString()} bytes exceeds the ${MAX_ATTACHMENT_BYTES.toLocaleString()} byte limit.`
      };
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const check = checkAttachment({
      filename: file.name || 'attachment',
      mimeType: file.type || 'application/octet-stream',
      byteLength: bytes.length
    });
    if (!check.ok) {
      return { ok: false, error: `attachment_${check.reason}`, message: check.detail };
    }
    runningTotal += bytes.length;
    if (runningTotal > MAX_TOTAL_BYTES) {
      return {
        ok: false,
        error: 'payload_too_large',
        message: `Total payload exceeds ${MAX_TOTAL_BYTES.toLocaleString()} bytes.`
      };
    }
    attachments.push({
      storageKey: `inline:${file.name || 'attachment'}:${bytes.length}`,
      filename: file.name || 'attachment',
      mimeType: file.type || 'application/octet-stream',
      byteLength: bytes.length
    });
  }

  const limit = getIntakeRateLimiter().consume(`ui:${config.uiUserId}`);
  if (!limit.allowed) {
    return {
      ok: false,
      error: 'rate_limited',
      message: `Too many submissions. Retry in ${Math.ceil(limit.retryAfterMs / 1000)}s. (Limit: ${DEFAULT_INTAKE_RATE_LIMIT.maxRequests}/min.)`
    };
  }

  try {
    const result = await processIntake(
      {
        body: bodyValue,
        attachments,
        source: {
          kind: 'capture',
          userId: config.uiUserId,
          client: 'web-ui'
        }
      },
      {
        payloadStore: getIntakePayloadStore(),
        projectId: config.projectId,
        assigneeUserId: config.assigneeUserId
      }
    );

    return {
      ok: true,
      draftIssueId: result.draftIssueId,
      identifier: result.identifier,
      rawPayloadId: result.rawPayloadId,
      draftCreated: result.draftCreated,
      draftUrl: `/GSO/issues/${result.identifier}`,
      title: deriveDisplayTitle(bodyValue)
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[intake-ui] processIntake failed', err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: 'draft_create_failed',
      message:
        'Could not create the draft. The capture is preserved in the audit log — retry in a moment.'
    };
  }
}

function deriveDisplayTitle(body: string): string {
  const firstLine =
    body
      .split('\n')
      .map((s) => s.trim())
      .find((s) => s.length > 0) ?? 'Untitled capture';
  if (firstLine.length <= 80) return firstLine;
  return firstLine.slice(0, 77).trimEnd() + '…';
}
