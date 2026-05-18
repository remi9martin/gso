// `dispatch-authorized` gate.
//
// Per the parent design (GSO-120 §3.6 verdict #3): default closed,
// per-dispatch flag. A source issue is only eligible for dispatch when its
// `dispatch-authorized` document has been written by Triage or the board
// with `authorized: true`. The document is also the audit record.
//
// Body conventions accepted (case-insensitive):
//   - YAML-shaped:   `authorized: true`
//   - Bare boolean:  `true`
// Anything else (including `authorized: false`, an empty body, or a missing
// document) refuses the dispatch.

export const DISPATCH_AUTHORIZED_DOC_KEY = 'dispatch-authorized';

export class DispatchAuthorizationError extends Error {
  constructor(
    public readonly code: 'no-marker' | 'marker-false' | 'marker-malformed',
    public readonly sourceIssueIdentifier: string,
    message: string
  ) {
    super(message);
    this.name = 'DispatchAuthorizationError';
  }
}

export interface DispatchAuthorizationDocument {
  body: string | null;
}

export function checkDispatchAuthorization(
  sourceIssueIdentifier: string,
  doc: DispatchAuthorizationDocument | null
): void {
  if (!doc) {
    throw new DispatchAuthorizationError(
      'no-marker',
      sourceIssueIdentifier,
      `Source issue ${sourceIssueIdentifier} has no \`${DISPATCH_AUTHORIZED_DOC_KEY}\` document — ` +
        `refusing to dispatch. Triage or the board must write the marker first.`
    );
  }

  const body = (doc.body ?? '').trim();
  if (body.length === 0) {
    throw new DispatchAuthorizationError(
      'marker-malformed',
      sourceIssueIdentifier,
      `Source issue ${sourceIssueIdentifier} has an empty \`${DISPATCH_AUTHORIZED_DOC_KEY}\` document.`
    );
  }

  if (isAuthorizedBody(body)) return;

  if (/\bauthorized\s*:\s*false\b/i.test(body) || /^false$/i.test(body)) {
    throw new DispatchAuthorizationError(
      'marker-false',
      sourceIssueIdentifier,
      `Source issue ${sourceIssueIdentifier} has \`${DISPATCH_AUTHORIZED_DOC_KEY}: false\` — ` +
        `refusing to dispatch.`
    );
  }

  throw new DispatchAuthorizationError(
    'marker-malformed',
    sourceIssueIdentifier,
    `Source issue ${sourceIssueIdentifier} has a malformed \`${DISPATCH_AUTHORIZED_DOC_KEY}\` ` +
      `document. Expected \`authorized: true\` or bare \`true\`.`
  );
}

function isAuthorizedBody(body: string): boolean {
  if (/^true$/im.test(body)) return true;
  if (/\bauthorized\s*:\s*true\b/i.test(body)) return true;
  return false;
}
