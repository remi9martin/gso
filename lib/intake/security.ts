import 'server-only';

// Public-ingress hardening for /api/intake. The numbers and deny list are
// the v0 baseline documented in docs/intake/security.md. The threat model
// is what we present to the CEO before merge per the GSO-124 spec.

export const MAX_BODY_BYTES = 1_000_000; // 1 MB free-form text
export const MAX_ATTACHMENT_BYTES = 10_000_000; // 10 MB per attachment
export const MAX_TOTAL_BYTES = 12_000_000; // 12 MB total multipart
export const MAX_ATTACHMENTS = 5;

// Deny list, not allowlist: we want to be generous about attachments (images,
// pdfs, audio, text) but never let an executable through the front door.
// MIME types listed here are rejected outright. The browser-presented MIME
// type is advisory — we also reject by extension when present.
export const DENIED_MIME_TYPES = new Set<string>([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sharedlib',
  'application/x-mach-binary',
  'application/vnd.microsoft.portable-executable',
  'application/x-elf',
  'application/x-msi',
  'application/x-bat',
  'application/x-sh',
  'application/x-shellscript',
  'application/x-perl',
  'application/x-python-code',
  'application/x-java-archive',
  'application/java-archive',
  'application/x-iso9660-image'
]);

export const DENIED_EXTENSIONS = new Set<string>([
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bat',
  '.cmd',
  '.com',
  '.msi',
  '.scr',
  '.ps1',
  '.psm1',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.app',
  '.jar',
  '.war',
  '.pkg',
  '.deb',
  '.rpm',
  '.iso',
  '.img',
  '.vbs',
  '.vbe',
  '.js',
  '.mjs',
  '.cjs',
  '.wsf',
  '.wsh',
  '.hta',
  '.lnk'
]);

export interface AttachmentCheckInput {
  filename: string;
  mimeType: string;
  byteLength: number;
}

export type AttachmentCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'too_large' | 'denied_mime' | 'denied_extension' | 'empty';
      detail: string;
    };

export function checkAttachment(att: AttachmentCheckInput): AttachmentCheckResult {
  if (att.byteLength <= 0) {
    return { ok: false, reason: 'empty', detail: `${att.filename}: empty attachment` };
  }
  if (att.byteLength > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: 'too_large',
      detail: `${att.filename}: ${att.byteLength} bytes exceeds ${MAX_ATTACHMENT_BYTES} byte limit`
    };
  }
  const mime = att.mimeType.toLowerCase().split(';')[0].trim();
  if (DENIED_MIME_TYPES.has(mime)) {
    return { ok: false, reason: 'denied_mime', detail: `${att.filename}: MIME ${mime} is denied` };
  }
  const ext = extensionOf(att.filename);
  if (ext && DENIED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      reason: 'denied_extension',
      detail: `${att.filename}: extension ${ext} is denied`
    };
  }
  return { ok: true };
}

function extensionOf(filename: string): string | null {
  const lower = filename.toLowerCase();
  const idx = lower.lastIndexOf('.');
  if (idx < 0 || idx === lower.length - 1) return null;
  return lower.slice(idx);
}

// Redact a body for log output. We never log raw bytes — only a one-line
// shape descriptor so an operator can correlate without leaking content.
export function describePayloadForLog(body: string): string {
  const trimmed = body.trim();
  const len = trimmed.length;
  const lines = trimmed.split('\n').length;
  return `text(len=${len},lines=${lines})`;
}
