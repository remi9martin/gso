import { describe, expect, it } from 'vitest';

import {
  createDraftIssue,
  parseDraftDescription,
  renderDraftDescription,
  type DraftFrontMatter
} from '@/lib/intake/create-draft-issue';

const SAMPLE_ENV = {
  apiUrl: 'http://localhost:3101',
  apiKey: 'test-key',
  companyId: 'company-1'
} as const;

const SAMPLE_FRONT_MATTER: DraftFrontMatter = {
  sourcePointer: 'capture:client=web,bytes=412',
  suggestedTag: 'idea',
  suggestedNextAction: 'Draft outline for the AI inbox sweeper.',
  rawPayloadId: 'pl_01HXZ8K2C0DEMOPAYLOAD123456789',
  confidence: 0.78
};

describe('renderDraftDescription / parseDraftDescription', () => {
  it('round-trips all front-matter fields and the summary', () => {
    const summary = 'A normalized one-paragraph summary of the raw capture.';
    const description = renderDraftDescription(summary, SAMPLE_FRONT_MATTER);

    expect(description.startsWith('---\n')).toBe(true);

    const parsed = parseDraftDescription(description);
    expect(parsed.summary).toBe(summary);
    expect(parsed.frontMatter).toEqual(SAMPLE_FRONT_MATTER);
  });

  it('rejects descriptions missing the fence', () => {
    expect(() => parseDraftDescription('no front matter here')).toThrowError(
      /leading front-matter fence/
    );
  });

  it('rejects out-of-range confidence', () => {
    const bad = renderDraftDescription('s', { ...SAMPLE_FRONT_MATTER, confidence: 1.5 });
    expect(() => parseDraftDescription(bad)).toThrowError(/confidence/);
  });
});

describe('createDraftIssue', () => {
  function makeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push({ url, init });
      return handler(url, init);
    };
    return { fetchImpl, calls };
  }

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    });
  }

  it('round-trips a sample payload to a Paperclip issue with all front-matter fields readable', async () => {
    let capturedBody: Record<string, unknown> = {};
    const { fetchImpl, calls } = makeFetch((url, init) => {
      if (init.method === 'GET' && url.includes('/issues?')) {
        // No prior drafts.
        return jsonResponse(200, []);
      }
      if (init.method === 'POST' && url.endsWith('/issues')) {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return jsonResponse(201, {
          id: 'issue-1',
          identifier: 'GSO-200',
          description: capturedBody.description,
          projectId: capturedBody.projectId
        });
      }
      return jsonResponse(404, { error: 'unexpected route' });
    });

    const result = await createDraftIssue(
      {
        title: 'Draft inbox sweeper',
        summary: 'Sweep the inbox into a single canonical view.',
        frontMatter: SAMPLE_FRONT_MATTER,
        projectId: 'intake-project-id',
        assigneeUserId: 'user-remi',
        priority: 'high'
      },
      { env: SAMPLE_ENV, fetchImpl, runId: 'run-test' }
    );

    expect(result.created).toBe(true);
    expect(result.identifier).toBe('GSO-200');
    expect(result.rawPayloadId).toBe(SAMPLE_FRONT_MATTER.rawPayloadId);

    // Verify the wire body: front-matter is embedded in the description.
    expect(capturedBody.title).toBe('Draft inbox sweeper');
    expect(capturedBody.projectId).toBe('intake-project-id');
    expect(capturedBody.assigneeUserId).toBe('user-remi');
    expect(capturedBody.priority).toBe('high');
    expect(capturedBody.status).toBe('todo');

    const parsed = parseDraftDescription(capturedBody.description as string);
    expect(parsed.frontMatter).toEqual(SAMPLE_FRONT_MATTER);
    expect(parsed.summary).toBe('Sweep the inbox into a single canonical view.');

    // Verify the run-id audit header propagated.
    const postCall = calls.find((c) => c.init.method === 'POST')!;
    const headers = postCall.init.headers as Record<string, string>;
    expect(headers['X-Paperclip-Run-Id']).toBe('run-test');
    expect(headers['Authorization']).toBe('Bearer test-key');
  });

  it('is idempotent: a second call with the same payloadHash returns the existing draft id', async () => {
    const existingDescription = renderDraftDescription(
      'Sweep the inbox into a single canonical view.',
      SAMPLE_FRONT_MATTER
    );
    let postCount = 0;

    const { fetchImpl } = makeFetch((url, init) => {
      if (init.method === 'GET' && url.includes('/issues?')) {
        return jsonResponse(200, [
          {
            id: 'issue-1',
            identifier: 'GSO-200',
            description: existingDescription,
            projectId: 'intake-project-id'
          }
        ]);
      }
      if (init.method === 'POST') {
        postCount++;
        return jsonResponse(500, { error: 'should not be called on idempotent retry' });
      }
      return jsonResponse(404, { error: 'unexpected route' });
    });

    const result = await createDraftIssue(
      {
        title: 'Draft inbox sweeper (retry)',
        summary: 'A retry with the same canonical payload.',
        frontMatter: SAMPLE_FRONT_MATTER,
        projectId: 'intake-project-id',
        assigneeUserId: 'user-remi'
      },
      { env: SAMPLE_ENV, fetchImpl }
    );

    expect(result.created).toBe(false);
    expect(result.id).toBe('issue-1');
    expect(result.identifier).toBe('GSO-200');
    expect(postCount).toBe(0);
  });

  it('does not match unrelated mentions of the payload id in body text', async () => {
    // An existing issue mentions the same id incidentally, but not in the
    // front-matter row, so we must still create a new draft.
    const unrelatedDescription = `---
sourcePointer: capture:other
suggestedTag: idea
suggestedNextAction: do something else
rawPayloadId: pl_OTHER
confidence: 0.5
---

This text incidentally references pl_01HXZ8K2C0DEMOPAYLOAD123456789 inline.`;

    let postCalled = false;
    const { fetchImpl } = makeFetch((url, init) => {
      if (init.method === 'GET' && url.includes('/issues?')) {
        return jsonResponse(200, [
          {
            id: 'issue-other',
            identifier: 'GSO-199',
            description: unrelatedDescription,
            projectId: 'intake-project-id'
          }
        ]);
      }
      if (init.method === 'POST' && url.endsWith('/issues')) {
        postCalled = true;
        return jsonResponse(201, {
          id: 'issue-new',
          identifier: 'GSO-201'
        });
      }
      return jsonResponse(404, { error: 'unexpected route' });
    });

    const result = await createDraftIssue(
      {
        title: 'Draft new',
        summary: 'A genuinely new draft.',
        frontMatter: SAMPLE_FRONT_MATTER,
        projectId: 'intake-project-id',
        assigneeUserId: 'user-remi'
      },
      { env: SAMPLE_ENV, fetchImpl }
    );

    expect(postCalled).toBe(true);
    expect(result.created).toBe(true);
    expect(result.identifier).toBe('GSO-201');
  });
});
