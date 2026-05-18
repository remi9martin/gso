// Dispatcher key loader.
//
// Sibling-company API keys are held in GSO's process env, never logged,
// never echoed. The env var name embeds the target companyId so a single
// GSO instance can dispatch to multiple siblings.
//
// Env var convention: GSO_DISPATCHER_KEY_<COMPANY_ID_UPPER_WITH_UNDERSCORES>
// Example: company id "abc-123" → GSO_DISPATCHER_KEY_ABC_123
//
// Per design (GSO-120 §3.5): "The dispatcher key for company B is held in
// GSO secrets, referenced by name only in the dispatch script. It is never
// logged, never echoed into comments, never put into adapter config."

export const DISPATCHER_KEY_ENV_PREFIX = 'GSO_DISPATCHER_KEY_';

export class DispatcherKeyMissingError extends Error {
  constructor(
    public readonly targetCompanyId: string,
    public readonly envVarName: string
  ) {
    super(
      `No dispatcher key configured for target company ${targetCompanyId}. ` +
        `Set ${envVarName} in the GSO deployment env (see scripts/gso-provision-dispatcher.md). ` +
        `The key value itself must never be logged or echoed.`
    );
    this.name = 'DispatcherKeyMissingError';
  }
}

export function dispatcherKeyEnvVar(targetCompanyId: string): string {
  const normalized = targetCompanyId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
  if (!normalized) {
    throw new Error('dispatcherKeyEnvVar: targetCompanyId is empty');
  }
  return `${DISPATCHER_KEY_ENV_PREFIX}${normalized}`;
}

// Node's util.inspect honours this symbol when console.log / util.inspect
// formats an object. Using Symbol.for() (the cross-realm registry) instead
// of a fresh Symbol keeps this resilient across bundled Node versions.
const INSPECT_CUSTOM = Symbol.for('nodejs.util.inspect.custom');

export interface OpaqueDispatcherKey {
  readonly envVarName: string;
  readonly targetCompanyId: string;
  /** Returns the raw key. Caller is responsible for never logging it. */
  reveal(): string;
  /** Safe string form for logs and errors. Never includes the key. */
  toString(): string;
  /** Node util.inspect hook — returns the redacted toString() form. */
  [INSPECT_CUSTOM]?: () => string;
}

export function loadDispatcherKey(
  targetCompanyId: string,
  source: Record<string, string | undefined> = process.env
): OpaqueDispatcherKey {
  const envVarName = dispatcherKeyEnvVar(targetCompanyId);
  const raw = source[envVarName]?.trim();
  if (!raw) throw new DispatcherKeyMissingError(targetCompanyId, envVarName);

  // Closure captures the value so it is not reachable as an enumerable
  // property on the returned object — protects against accidental
  // JSON.stringify or shallow inspection in logs. The util.inspect.custom
  // hook keeps `console.log(key)` from printing the function bodies.
  const safeLabel = `<dispatcher-key for ${targetCompanyId} via ${envVarName}>`;
  return {
    envVarName,
    targetCompanyId,
    reveal: () => raw,
    toString: () => safeLabel,
    [INSPECT_CUSTOM]: () => safeLabel
  };
}

export type RedactableSecret = OpaqueDispatcherKey | string | null | undefined;

/**
 * Symmetric redactor: replace every occurrence of every supplied secret with
 * `[REDACTED]`. Accepts either an {@link OpaqueDispatcherKey} (calls
 * `.reveal()`) or a raw string. Empty / null / whitespace-only secrets are
 * skipped. Used at every boundary where a string could cross a company
 * boundary (sibling payloads, comment bodies, document descriptions) or
 * surface to the caller (outer catch on `Error.message`), so the dispatcher
 * key AND the origin API key are both redacted with one call.
 */
export function redactSecrets(text: string, ...secrets: RedactableSecret[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret == null) continue;
    const value = typeof secret === 'string' ? secret : secret.reveal();
    if (!value || !value.trim()) continue;
    out = out.split(value).join('[REDACTED]');
  }
  return out;
}

/**
 * Redact the dispatcher key value if it ever appears in a string. Retained
 * for compatibility — new call sites should prefer {@link redactSecrets} so
 * the origin API key is redacted on the same pass.
 */
export function redactKey(text: string, key: OpaqueDispatcherKey): string {
  return redactSecrets(text, key);
}
