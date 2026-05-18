import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DISPATCH_METADATA_DOC_KEY,
  DispatchAuthorizationError,
  DispatchBriefError,
  dispatch
} from '@/lib/dispatch';
import { DispatcherKeyMissingError } from '@/lib/dispatch/secrets';

const ORIGIN_API_KEY = 'origin-jwt-NEVER-LEAK';
const SIBLING_API_KEY = 'sibling-jwt-NEVER-LEAK';
const ORIGIN_COMPANY_ID = 'co-origin';
const TARGET_COMPANY_ID = 'co-target';
const ENV_VAR_NAME = 'GSO_DISPATCHER_KEY_CO_TARGET';

const SOURCE_ID = 'issue-src';
const SOURCE_IDENTIFIER = 'GSO-200';
const MIRROR_ID = 'issue-mirror';
const MIRROR_IDENTIFIER = 'SIB-12';

const SOURCE_DESCRIPTION = `## Context

We need to ship the foo.

## Acceptance

- [ ] Foo ships.
- [ ] Bar is wired.

## Blast radius

🚪🚪 **Two-way door** — additive change.
`;

const SAMPLE_ENV = {
  apiUrl: 'http://api.test',
  apiKey: ORIGIN_API_KEY,
  companyId: ORIGIN_COMPANY_ID
};

interface RecordedCall {
  url: string;
  method: string;
  authorization: string;
  body: string;
  runId: string | null;
}

interface FakeTransportState {
  calls: RecordedCall[];
  authDoc: { body: string } | null;
  stdoutCapture: string[];
  stderrCapture: string[];
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function notFound(): Response {
  return jsonResponse(404, { error: 'not found' });
}

function makeTransport(state: FakeTransportState): typeof fetch {
  const handler: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === 'string' ? init.body : '';
    state.calls.push({
      url,
      method,
      authorization: headers['Authorization'] ?? '',
      body,
      runId: headers['X-Paperclip-Run-Id'] ?? null
    });

    // ---- Origin reads (use ORIGIN auth) ----
    if (url.endsWith(`/api/issues/${SOURCE_ID}`) && method === 'GET') {
      return jsonResponse(200, {
        id: SOURCE_ID,
        identifier: SOURCE_IDENTIFIER,
        title: 'Build the thing',
        description: SOURCE_DESCRIPTION,
        priority: 'high',
        assigneeAgentId: 'agent-src-owner',
        parentId: 'issue-parent',
        projectId: null,
        goalId: null
      });
    }
    if (url.endsWith('/api/issues/issue-parent') && method === 'GET') {
      return jsonResponse(200, {
        id: 'issue-parent',
        identifier: 'GSO-100',
        title: 'Parent goal',
        description: '',
        priority: 'high',
        assigneeAgentId: null,
        parentId: null
      });
    }
    if (url.endsWith('/api/agents/agent-src-owner') && method === 'GET') {
      return jsonResponse(200, {
        id: 'agent-src-owner',
        name: 'FoundingEngineer',
        role: 'engineer',
        reportsTo: 'agent-cto'
      });
    }
    if (url.endsWith('/api/agents/agent-cto') && method === 'GET') {
      return jsonResponse(200, {
        id: 'agent-cto',
        name: 'CTO',
        role: 'cto',
        reportsTo: null
      });
    }
    if (
      url.endsWith(`/api/issues/${SOURCE_ID}/documents/dispatch-authorized`) &&
      method === 'GET'
    ) {
      if (!state.authDoc) return notFound();
      return jsonResponse(200, { key: 'dispatch-authorized', body: state.authDoc.body });
    }
    if (url.endsWith(`/api/companies/${ORIGIN_COMPANY_ID}`) && method === 'GET') {
      return jsonResponse(200, {
        id: ORIGIN_COMPANY_ID,
        prefix: 'GSO',
        name: 'GSO',
        ceoAgentId: 'agent-cto'
      });
    }

    // ---- Sibling reads & writes (use SIBLING auth) ----
    if (url.endsWith(`/api/companies/${TARGET_COMPANY_ID}`) && method === 'GET') {
      return jsonResponse(200, {
        id: TARGET_COMPANY_ID,
        prefix: 'SIB',
        name: 'Sibling',
        ceoAgentId: 'agent-sib-ceo'
      });
    }
    if (url.endsWith(`/api/companies/${TARGET_COMPANY_ID}/agents`) && method === 'GET') {
      return jsonResponse(200, [
        { id: 'agent-sib-ceo', name: 'Sibling CEO', role: 'ceo', reportsTo: null }
      ]);
    }
    if (url.endsWith(`/api/companies/${TARGET_COMPANY_ID}/issues`) && method === 'POST') {
      return jsonResponse(201, { id: MIRROR_ID, identifier: MIRROR_IDENTIFIER });
    }
    if (
      url.endsWith(`/api/issues/${MIRROR_ID}/documents/${DISPATCH_METADATA_DOC_KEY}`) &&
      method === 'PUT'
    ) {
      return jsonResponse(200, { ok: true });
    }
    if (url.endsWith(`/api/issues/${MIRROR_ID}`) && method === 'PATCH') {
      return jsonResponse(200, { ok: true });
    }
    if (
      url.endsWith(`/api/issues/${SOURCE_ID}/documents/${DISPATCH_METADATA_DOC_KEY}`) &&
      method === 'PUT'
    ) {
      return jsonResponse(200, { ok: true });
    }
    if (url.endsWith(`/api/issues/${SOURCE_ID}/comments`) && method === 'POST') {
      return jsonResponse(201, { id: 'comment-1' });
    }
    return jsonResponse(404, { error: 'unexpected route', url, method });
  };
  return handler;
}

function freshState(): FakeTransportState {
  return {
    calls: [],
    authDoc: { body: 'authorized: true\nby: triage' },
    stdoutCapture: [],
    stderrCapture: []
  };
}

describe('dispatch — happy path', () => {
  let stdoutSpy: { mockRestore: () => void };
  let stderrSpy: { mockRestore: () => void };
  let state: FakeTransportState;

  beforeEach(() => {
    state = freshState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stdoutSpy = (vi.spyOn(process.stdout, 'write') as any).mockImplementation(
      (chunk: unknown) => {
        state.stdoutCapture.push(String(chunk));
        return true;
      }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stderrSpy = (vi.spyOn(process.stderr, 'write') as any).mockImplementation(
      (chunk: unknown) => {
        state.stderrCapture.push(String(chunk));
        return true;
      }
    );
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('returns mirror identifiers and writes both metadata docs', async () => {
    const fetchImpl = makeTransport(state);
    const result = await dispatch(SOURCE_ID, TARGET_COMPANY_ID, {
      env: SAMPLE_ENV,
      fetchImpl,
      envSource: { [ENV_VAR_NAME]: SIBLING_API_KEY },
      runId: 'run-xyz',
      now: () => new Date('2026-05-18T17:00:00.000Z')
    });

    expect(result).toEqual({
      mirrorIssueId: MIRROR_ID,
      mirrorIdentifier: MIRROR_IDENTIFIER,
      mirrorCompanyId: TARGET_COMPANY_ID,
      mirrorIssueUrl: '/SIB/issues/SIB-12'
    });

    const mirrorCreate = state.calls.find(
      (c) => c.method === 'POST' && c.url.endsWith(`/companies/${TARGET_COMPANY_ID}/issues`)
    );
    expect(mirrorCreate, 'expected mirror POST').toBeTruthy();
    expect(mirrorCreate!.authorization).toBe(`Bearer ${SIBLING_API_KEY}`);
    const mirrorPayload = JSON.parse(mirrorCreate!.body) as Record<string, unknown>;
    expect(mirrorPayload.priority).toBe('high');
    expect(mirrorPayload.status).toBe('todo');
    expect(mirrorPayload.assigneeAgentId).toBe('agent-sib-ceo');
    expect(String(mirrorPayload.description)).toContain('{{MIRROR_LINK}}');

    const mirrorPatch = state.calls.find(
      (c) => c.method === 'PATCH' && c.url.endsWith(`/issues/${MIRROR_ID}`)
    );
    expect(mirrorPatch, 'expected mirror PATCH').toBeTruthy();
    const patched = JSON.parse(mirrorPatch!.body) as Record<string, unknown>;
    expect(String(patched.description)).not.toContain('{{MIRROR_LINK}}');
    expect(String(patched.description)).toContain('[SIB-12](/SIB/issues/SIB-12)');

    const mirrorMeta = state.calls.find(
      (c) =>
        c.method === 'PUT' &&
        c.url.endsWith(`/issues/${MIRROR_ID}/documents/${DISPATCH_METADATA_DOC_KEY}`)
    );
    expect(mirrorMeta, 'expected mirror metadata PUT').toBeTruthy();
    expect(JSON.parse(mirrorMeta!.body).body).toContain('originIssueId: issue-src');
    expect(JSON.parse(mirrorMeta!.body).body).toContain('dispatchedAt: 2026-05-18T17:00:00.000Z');

    const sourceMeta = state.calls.find(
      (c) =>
        c.method === 'PUT' &&
        c.url.endsWith(`/issues/${SOURCE_ID}/documents/${DISPATCH_METADATA_DOC_KEY}`)
    );
    expect(sourceMeta, 'expected source metadata PUT').toBeTruthy();
    expect(JSON.parse(sourceMeta!.body).body).toContain(`mirrorIdentifier: ${MIRROR_IDENTIFIER}`);
    expect(JSON.parse(sourceMeta!.body).body).toContain(`mirrorCompanyId: ${TARGET_COMPANY_ID}`);

    const comment = state.calls.find(
      (c) => c.method === 'POST' && c.url.endsWith(`/issues/${SOURCE_ID}/comments`)
    );
    expect(comment, 'expected source comment').toBeTruthy();
    expect(JSON.parse(comment!.body).body).toContain('[SIB-12](/SIB/issues/SIB-12)');
  });

  it('uses origin auth for source reads and sibling auth for target writes', async () => {
    const fetchImpl = makeTransport(state);
    await dispatch(SOURCE_ID, TARGET_COMPANY_ID, {
      env: SAMPLE_ENV,
      fetchImpl,
      envSource: { [ENV_VAR_NAME]: SIBLING_API_KEY }
    });

    for (const call of state.calls) {
      const usesSibling = call.url.includes(TARGET_COMPANY_ID) || call.url.includes(MIRROR_ID);
      const usesSourceWrite = call.method !== 'GET' && call.url.includes(SOURCE_ID);
      if (usesSibling) {
        expect(call.authorization, `${call.method} ${call.url} should use sibling key`).toBe(
          `Bearer ${SIBLING_API_KEY}`
        );
      } else if (usesSourceWrite) {
        expect(call.authorization).toBe(`Bearer ${ORIGIN_API_KEY}`);
      }
    }
  });

  it('propagates the run id audit header on all mutating calls', async () => {
    const fetchImpl = makeTransport(state);
    await dispatch(SOURCE_ID, TARGET_COMPANY_ID, {
      env: SAMPLE_ENV,
      fetchImpl,
      envSource: { [ENV_VAR_NAME]: SIBLING_API_KEY },
      runId: 'run-xyz'
    });
    const mutations = state.calls.filter((c) => c.method !== 'GET');
    expect(mutations.length).toBeGreaterThan(0);
    for (const call of mutations) {
      expect(call.runId, `${call.method} ${call.url} missing run id`).toBe('run-xyz');
    }
  });

  it('never echoes the dispatcher key to stdout, stderr, or any comment body', async () => {
    const fetchImpl = makeTransport(state);
    await dispatch(SOURCE_ID, TARGET_COMPANY_ID, {
      env: SAMPLE_ENV,
      fetchImpl,
      envSource: { [ENV_VAR_NAME]: SIBLING_API_KEY }
    });

    for (const line of state.stdoutCapture) {
      expect(line).not.toContain(SIBLING_API_KEY);
    }
    for (const line of state.stderrCapture) {
      expect(line).not.toContain(SIBLING_API_KEY);
    }
    for (const call of state.calls) {
      if (call.method === 'POST' && call.url.endsWith('/comments')) {
        const parsed = JSON.parse(call.body) as { body?: string };
        expect(parsed.body ?? '').not.toContain(SIBLING_API_KEY);
      }
      if (call.method === 'PUT' && call.url.includes('/documents/')) {
        const parsed = JSON.parse(call.body) as { body?: string };
        expect(parsed.body ?? '').not.toContain(SIBLING_API_KEY);
      }
    }
  });
});

describe('dispatch — refusal paths', () => {
  it('refuses when the dispatcher key is missing', async () => {
    const state = freshState();
    const fetchImpl = makeTransport(state);
    await expect(
      dispatch(SOURCE_ID, TARGET_COMPANY_ID, {
        env: SAMPLE_ENV,
        fetchImpl,
        envSource: {} // no key
      })
    ).rejects.toBeInstanceOf(DispatcherKeyMissingError);
  });

  it('refuses without a dispatch-authorized document', async () => {
    const state = freshState();
    state.authDoc = null;
    const fetchImpl = makeTransport(state);
    await expect(
      dispatch(SOURCE_ID, TARGET_COMPANY_ID, {
        env: SAMPLE_ENV,
        fetchImpl,
        envSource: { [ENV_VAR_NAME]: SIBLING_API_KEY }
      })
    ).rejects.toBeInstanceOf(DispatchAuthorizationError);
  });

  it('refuses when the source has no Acceptance section', async () => {
    const state = freshState();
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      const method = (init.method ?? 'GET').toUpperCase();
      if (url.endsWith(`/api/issues/${SOURCE_ID}`) && method === 'GET') {
        return jsonResponse(200, {
          id: SOURCE_ID,
          identifier: SOURCE_IDENTIFIER,
          title: 'No acceptance',
          description: '## Context\nbut no acceptance here',
          priority: 'low',
          assigneeAgentId: null,
          parentId: null,
          projectId: null,
          goalId: null
        });
      }
      if (
        url.endsWith(`/api/issues/${SOURCE_ID}/documents/dispatch-authorized`) &&
        method === 'GET'
      ) {
        return jsonResponse(200, { key: 'dispatch-authorized', body: 'authorized: true' });
      }
      if (url.endsWith(`/api/companies/${ORIGIN_COMPANY_ID}`) && method === 'GET') {
        return jsonResponse(200, { id: ORIGIN_COMPANY_ID, prefix: 'GSO' });
      }
      return notFound();
    };
    await expect(
      dispatch(SOURCE_ID, TARGET_COMPANY_ID, {
        env: SAMPLE_ENV,
        fetchImpl,
        envSource: { [ENV_VAR_NAME]: SIBLING_API_KEY }
      })
    ).rejects.toBeInstanceOf(DispatchBriefError);

    // No mirror write should have happened.
    expect(
      state.calls.some(
        (c) => c.method === 'POST' && c.url.includes(`/companies/${TARGET_COMPANY_ID}/issues`)
      )
    ).toBe(false);
  });

  it('redacts any leaked key from error messages', async () => {
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      const method = (init.method ?? 'GET').toUpperCase();
      if (url.endsWith(`/api/issues/${SOURCE_ID}`) && method === 'GET') {
        return jsonResponse(200, {
          id: SOURCE_ID,
          identifier: SOURCE_IDENTIFIER,
          title: 'Body returns the key for some reason',
          description: SOURCE_DESCRIPTION,
          priority: 'high',
          assigneeAgentId: null,
          parentId: null,
          projectId: null,
          goalId: null
        });
      }
      if (
        url.endsWith(`/api/issues/${SOURCE_ID}/documents/dispatch-authorized`) &&
        method === 'GET'
      ) {
        return jsonResponse(200, { key: 'dispatch-authorized', body: 'authorized: true' });
      }
      if (url.endsWith(`/api/companies/${ORIGIN_COMPANY_ID}`) && method === 'GET') {
        return jsonResponse(200, { id: ORIGIN_COMPANY_ID, prefix: 'GSO' });
      }
      // Sibling fetch fails with a 500 that includes the key value in the
      // body (simulating a buggy upstream).
      return new Response(`upstream error: token=${SIBLING_API_KEY} not accepted`, {
        status: 500
      });
    };

    try {
      await dispatch(SOURCE_ID, TARGET_COMPANY_ID, {
        env: SAMPLE_ENV,
        fetchImpl,
        envSource: { [ENV_VAR_NAME]: SIBLING_API_KEY }
      });
      throw new Error('expected throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('[REDACTED]');
      expect(message).not.toContain(SIBLING_API_KEY);
    }
  });
});
