import { describe, expect, it } from 'vitest';

import {
  checkAttachment,
  describePayloadForLog,
  MAX_ATTACHMENT_BYTES
} from '@/lib/intake/security';

describe('checkAttachment', () => {
  it('accepts a normal text file', () => {
    const res = checkAttachment({
      filename: 'notes.txt',
      mimeType: 'text/plain',
      byteLength: 12
    });
    expect(res.ok).toBe(true);
  });

  it('rejects oversize', () => {
    const res = checkAttachment({
      filename: 'big.bin',
      mimeType: 'application/octet-stream',
      byteLength: MAX_ATTACHMENT_BYTES + 1
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('too_large');
  });

  it('rejects denied MIME', () => {
    const res = checkAttachment({
      filename: 'tool.exe',
      mimeType: 'application/x-msdownload',
      byteLength: 100
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('denied_mime');
  });

  it('rejects denied extension regardless of MIME', () => {
    const res = checkAttachment({
      filename: 'pwn.sh',
      mimeType: 'application/octet-stream',
      byteLength: 100
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('denied_extension');
  });

  it('rejects empty attachments', () => {
    const res = checkAttachment({
      filename: 'empty.txt',
      mimeType: 'text/plain',
      byteLength: 0
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('empty');
  });
});

describe('describePayloadForLog', () => {
  it('produces a length+line descriptor, no body content', () => {
    const out = describePayloadForLog('hello world\nsecond line');
    expect(out).toMatch(/^text\(len=\d+,lines=2\)$/);
  });
});
