// Cloudflare Email Worker: turn an inbound MIME message into a POST to
// /api/intake/email on the GSO Next.js app.
//
// Cloudflare Email Routing executes this worker for any message addressed to
// the routed address (configured in wrangler.toml + the Cloudflare dashboard).
// We parse the MIME body, read the SPF/DKIM/DMARC results from
// Authentication-Results headers (Cloudflare always adds these), and forward
// a JSON envelope. On API failure we throw — Cloudflare retries with MTA
// semantics, so transient failures don't drop the message.

import PostalMime from 'postal-mime';
import type { Email } from 'postal-mime';

interface EmailEnv {
  GSO_INTAKE_URL: string;
  EMAIL_INTAKE_TOKEN: string;
}

interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
}

export default {
  async email(message: ForwardableEmailMessage, env: EmailEnv): Promise<void> {
    if (!env.EMAIL_INTAKE_TOKEN) {
      message.setReject('Email intake is not configured (missing token).');
      return;
    }
    if (!env.GSO_INTAKE_URL) {
      message.setReject('Email intake is not configured (missing URL).');
      return;
    }

    const auth = parseAuthResults(message.headers.get('Authentication-Results'));

    // Hard reject SPF/DKIM/DMARC failures at the worker. The API layer also
    // checks — defense in depth, per the L1.2 threat model §3.
    if (auth.spf === 'fail' || auth.dkim === 'fail' || auth.dmarc === 'fail') {
      message.setReject(`Rejected: SPF=${auth.spf} DKIM=${auth.dkim} DMARC=${auth.dmarc}.`);
      return;
    }

    const rawBytes = await streamToUint8Array(message.raw);
    let parsed: Email;
    try {
      parsed = await PostalMime.parse(rawBytes);
    } catch (err) {
      // Unparseable MIME — reject so the MTA gives up cleanly.
      message.setReject(`Could not parse MIME body: ${describe(err)}`);
      return;
    }

    const messageId = parsed.messageId ?? message.headers.get('Message-ID') ?? generateMessageId();
    const receivedAt = parsed.date ?? new Date().toISOString();

    const envelope = {
      from: parsed.from ? formatAddress(parsed.from) : message.from,
      to: parsed.to?.map(formatAddress) ?? [message.to],
      subject: parsed.subject ?? '(no subject)',
      messageId,
      receivedAt,
      text: parsed.text ?? '',
      html: parsed.html ?? '',
      auth,
      attachments: (parsed.attachments ?? [])
        .map((a) => ({ a, bytes: attachmentBytes(a.content) }))
        .filter(({ bytes }) => bytes.byteLength > 0)
        .map(({ a, bytes }) => ({
          filename: a.filename ?? 'attachment',
          mimeType: a.mimeType ?? 'application/octet-stream',
          contentBase64: uint8ArrayToBase64(bytes)
        }))
    };

    let response: Response;
    try {
      response = await fetch(env.GSO_INTAKE_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.EMAIL_INTAKE_TOKEN}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(envelope)
      });
    } catch (err) {
      // Transient — throw so the worker runtime/MTA layer retries.
      throw new Error(`POST ${env.GSO_INTAKE_URL} failed: ${describe(err)}`);
    }

    if (response.status === 550 || response.status === 401) {
      // Forgery-fail or auth-fail. Tell the MTA to give up.
      message.setReject(`API rejected message (${response.status}).`);
      return;
    }
    if (response.status >= 500 || response.status === 429) {
      // Transient — rethrow so the runtime retries.
      const text = await safeText(response);
      throw new Error(`Transient error ${response.status} from intake API: ${text}`);
    }
    if (!response.ok) {
      // 4xx other than 401 — log to the worker's tail and consume the message
      // so we don't loop. The raw payload is preserved in intake_payloads.
      const text = await safeText(response);
      console.warn(`Intake API rejected message ${response.status}: ${text}`);
      return;
    }
  }
};

function parseAuthResults(value: string | null): {
  spf: string;
  dkim: string;
  dmarc: string;
} {
  // Cloudflare Email Routing emits Authentication-Results in the standard
  // RFC 8601 format: `mx.cloudflare.net; spf=pass smtp.mailfrom=...; dkim=pass header.i=...; dmarc=pass action=none`.
  const out = { spf: 'none', dkim: 'none', dmarc: 'none' };
  if (!value) return out;
  const parts = value.split(';');
  for (const raw of parts) {
    const segment = raw.trim().toLowerCase();
    const m = /^(spf|dkim|dmarc)\s*=\s*([a-z]+)/.exec(segment);
    if (m) {
      const key = m[1] as 'spf' | 'dkim' | 'dmarc';
      out[key] = m[2];
    }
  }
  return out;
}

function formatAddress(addr: { name?: string; address?: string }): string {
  const name = addr.name?.trim();
  const address = addr.address?.trim() ?? '';
  return name ? `${name} <${address}>` : address;
}

function generateMessageId(): string {
  // Fallback when an inbound message somehow has no Message-ID.
  // Idempotency on the API side keys off this string, so we must produce
  // something — but a deterministic key here would let an attacker collide
  // with prior drafts. Random UUID is the safe default.
  return `<${crypto.randomUUID()}@gso-email-intake.local>`;
}

async function streamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function attachmentBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === 'string') {
    return new TextEncoder().encode(content);
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  return new Uint8Array(content);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa is available in the Workers runtime.
  return btoa(binary);
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '<unreadable response body>';
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
