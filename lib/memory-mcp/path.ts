const PATH_PATTERN = /^[a-zA-Z0-9._/-]+$/;

export type PathCheck = { ok: true; path: string } | { ok: false; message: string };

export function validateMemoryPath(input: unknown): PathCheck {
  if (typeof input !== 'string') {
    return { ok: false, message: 'path must be a string' };
  }
  const trimmed = input.replace(/^\/+/, '');
  if (trimmed.length === 0) {
    return { ok: false, message: 'path must not be empty' };
  }
  if (trimmed.length > 512) {
    return { ok: false, message: 'path is too long (max 512 chars)' };
  }
  if (trimmed.includes('..')) {
    return { ok: false, message: 'path must not contain ".."' };
  }
  if (!PATH_PATTERN.test(trimmed)) {
    return {
      ok: false,
      message: 'path must match [a-zA-Z0-9._/-]+ (mirrors deploy-memory/api.php safePath)'
    };
  }
  if (trimmed.includes('.htaccess')) {
    return { ok: false, message: 'path must not include .htaccess' };
  }
  return { ok: true, path: trimmed };
}
