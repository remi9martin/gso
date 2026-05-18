import 'server-only';

import { checkAttachment, MAX_ATTACHMENTS, MAX_BODY_BYTES, MAX_TOTAL_BYTES } from './security';
import type { IntakeAttachmentRef } from './intake-service';
import type { IntakeKind } from './payload-store';

// Parses either a JSON body { kind?, body, sourceMeta? } or a multipart form
// with a "body" text part and zero or more "attachment" file parts. The
// returned shape feeds directly into `processIntake`.

export interface ParsedIntakeRequest {
  body: string;
  kind: IntakeKind;
  attachments: IntakeAttachmentRef[];
  sourceMeta: Record<string, unknown>;
}

export type ParseResult =
  | { ok: true; value: ParsedIntakeRequest }
  | { ok: false; status: 400 | 413 | 415; error: string; message: string };

export interface ParseOptions {
  defaultKind?: IntakeKind;
  storeAttachment?: (input: {
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  }) => Promise<string>;
}

export async function parseIntakeRequest(
  request: Request,
  options: ParseOptions = {}
): Promise<ParseResult> {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.startsWith('application/json')) {
    return parseJsonBody(request, options);
  }
  if (contentType.startsWith('multipart/form-data')) {
    return parseMultipart(request, options);
  }
  if (contentType.startsWith('text/plain')) {
    return parseTextPlain(request, options);
  }
  return {
    ok: false,
    status: 415,
    error: 'unsupported_media_type',
    message: 'Content-Type must be application/json, multipart/form-data, or text/plain.'
  };
}

async function parseJsonBody(request: Request, options: ParseOptions): Promise<ParseResult> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return tooLarge(text.length, MAX_BODY_BYTES);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return badRequest('JSON body could not be parsed.');
  }
  if (!isObject(json)) return badRequest('JSON body must be an object.');

  const bodyValue = (json as Record<string, unknown>).body;
  if (typeof bodyValue !== 'string' || bodyValue.trim().length === 0) {
    return badRequest('Field "body" is required and must be a non-empty string.');
  }
  if (Buffer.byteLength(bodyValue, 'utf8') > MAX_BODY_BYTES) {
    return tooLarge(Buffer.byteLength(bodyValue, 'utf8'), MAX_BODY_BYTES);
  }

  const kind = parseKind((json as Record<string, unknown>).kind, options.defaultKind ?? 'api');
  if (!kind) return badRequest('Field "kind" must be one of: email, capture, api.');

  const sourceMeta = (json as Record<string, unknown>).sourceMeta;
  if (sourceMeta !== undefined && !isObject(sourceMeta)) {
    return badRequest('Field "sourceMeta" must be an object when provided.');
  }

  return {
    ok: true,
    value: {
      body: bodyValue,
      kind,
      attachments: [],
      sourceMeta: (sourceMeta as Record<string, unknown> | undefined) ?? {}
    }
  };
}

async function parseTextPlain(request: Request, _options: ParseOptions): Promise<ParseResult> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return tooLarge(text.length, MAX_BODY_BYTES);
  }
  if (text.trim().length === 0) {
    return badRequest('Request body is empty.');
  }
  return {
    ok: true,
    value: {
      body: text,
      kind: 'api',
      attachments: [],
      sourceMeta: {}
    }
  };
}

async function parseMultipart(request: Request, options: ParseOptions): Promise<ParseResult> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest('multipart/form-data body could not be parsed.');
  }

  const bodyValue = form.get('body');
  if (typeof bodyValue !== 'string' || bodyValue.trim().length === 0) {
    return badRequest('Form field "body" is required and must be a non-empty string.');
  }
  if (Buffer.byteLength(bodyValue, 'utf8') > MAX_BODY_BYTES) {
    return tooLarge(Buffer.byteLength(bodyValue, 'utf8'), MAX_BODY_BYTES);
  }

  const kindRaw = form.get('kind');
  const kind = parseKind(kindRaw, options.defaultKind ?? 'capture');
  if (!kind) return badRequest('Form field "kind" must be one of: email, capture, api.');

  const sourceMetaRaw = form.get('sourceMeta');
  let sourceMeta: Record<string, unknown> = {};
  if (typeof sourceMetaRaw === 'string' && sourceMetaRaw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(sourceMetaRaw);
      if (!isObject(parsed)) return badRequest('Form field "sourceMeta" must be a JSON object.');
      sourceMeta = parsed as Record<string, unknown>;
    } catch {
      return badRequest('Form field "sourceMeta" must be valid JSON.');
    }
  }

  const fileFields = form.getAll('attachment');
  if (fileFields.length > MAX_ATTACHMENTS) {
    return {
      ok: false,
      status: 413,
      error: 'too_many_attachments',
      message: `At most ${MAX_ATTACHMENTS} attachments are allowed.`
    };
  }

  const attachments: IntakeAttachmentRef[] = [];
  let runningTotal = Buffer.byteLength(bodyValue, 'utf8');

  for (const entry of fileFields) {
    if (typeof entry === 'string') {
      return badRequest('Form field "attachment" must be a File, not a string.');
    }
    const file = entry as File;
    const buffer = Buffer.from(await file.arrayBuffer());
    const check = checkAttachment({
      filename: file.name || 'attachment',
      mimeType: file.type || 'application/octet-stream',
      byteLength: buffer.length
    });
    if (!check.ok) {
      const status = check.reason === 'too_large' ? 413 : 415;
      return {
        ok: false,
        status,
        error: `attachment_${check.reason}`,
        message: check.detail
      };
    }
    runningTotal += buffer.length;
    if (runningTotal > MAX_TOTAL_BYTES) {
      return tooLarge(runningTotal, MAX_TOTAL_BYTES);
    }
    const storageKey = options.storeAttachment
      ? await options.storeAttachment({
          filename: file.name || 'attachment',
          mimeType: file.type || 'application/octet-stream',
          bytes: buffer
        })
      : `inline:${file.name || 'attachment'}:${buffer.length}`;
    attachments.push({
      storageKey,
      filename: file.name || 'attachment',
      mimeType: file.type || 'application/octet-stream',
      byteLength: buffer.length
    });
  }

  return {
    ok: true,
    value: {
      body: bodyValue,
      kind,
      attachments,
      sourceMeta
    }
  };
}

function parseKind(value: unknown, fallback: IntakeKind): IntakeKind | null {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === 'email' || value === 'capture' || value === 'api') return value;
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function badRequest(message: string): ParseResult {
  return { ok: false, status: 400, error: 'invalid_request', message };
}

function tooLarge(actual: number, limit: number): ParseResult {
  return {
    ok: false,
    status: 413,
    error: 'payload_too_large',
    message: `Payload is ${actual} bytes; limit is ${limit}.`
  };
}
