import 'server-only';

import { readPaperclipEnv, type PaperclipEnv } from '../paperclip/env';
import {
  DispatchBriefError,
  fillMirrorLink,
  renderBrief,
  type AncestorLike,
  type NamedEntityLike,
  type SourceIssueLike
} from './brief';
import {
  DISPATCH_AUTHORIZED_DOC_KEY,
  DispatchAuthorizationError,
  checkDispatchAuthorization
} from './authorization';
import { loadDispatcherKey, redactKey } from './secrets';

export const DISPATCH_METADATA_DOC_KEY = 'dispatch-metadata';

export interface DispatchResult {
  mirrorIssueId: string;
  mirrorIdentifier: string;
  mirrorCompanyId: string;
  mirrorIssueUrl: string;
}

export interface DispatchOptions {
  env?: PaperclipEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  runId?: string;
  envSource?: Record<string, string | undefined>;
  /** Override the rendered "now" for deterministic tests. */
  now?: () => Date;
}

export class DispatchError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    public readonly bodyText: string
  ) {
    super(`Dispatch ${endpoint} returned ${status}: ${bodyText.slice(0, 200)}`);
    this.name = 'DispatchError';
  }
}

interface IssueResponse extends SourceIssueLike {
  parentId: string | null;
  projectId?: string | null;
  goalId?: string | null;
}

interface CompanyResponse {
  id: string;
  prefix?: string | null;
  identifierPrefix?: string | null;
  name?: string | null;
  ceoAgentId?: string | null;
}

interface AgentResponse {
  id: string;
  name: string;
  role?: string | null;
  reportsTo?: string | null;
}

interface DocumentResponse {
  key: string;
  body?: string | null;
  title?: string | null;
  format?: string | null;
  latestRevisionId?: string | null;
}

interface MirrorCreateResponse {
  id: string;
  identifier: string;
}

export async function dispatch(
  sourceIssueId: string,
  targetCompanyId: string,
  options: DispatchOptions = {}
): Promise<DispatchResult> {
  const env = options.env ?? readPaperclipEnv();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const runId = options.runId ?? process.env.PAPERCLIP_RUN_ID;
  const dispatchedByAgentId = process.env.PAPERCLIP_AGENT_ID;
  const now = options.now ?? (() => new Date());
  const ctx: RequestCtx = { env, fetchImpl, timeoutMs };

  // 1. Load the dispatcher key (env-scoped, opaque).
  const dispatcherKey = loadDispatcherKey(targetCompanyId, options.envSource);

  try {
    // 2. Fetch source issue + ancestors + project + goal (origin auth).
    const sourceIssue = await getJson<IssueResponse>(
      `/api/issues/${sourceIssueId}`,
      ctx,
      env.apiKey
    );
    const ancestors = await fetchAncestors(sourceIssue.parentId, ctx, env.apiKey);
    const project = sourceIssue.projectId
      ? await getJsonOrNull<NamedEntityLike>(
          `/api/projects/${sourceIssue.projectId}`,
          ctx,
          env.apiKey
        )
      : null;
    const goal = sourceIssue.goalId
      ? await getJsonOrNull<NamedEntityLike>(`/api/goals/${sourceIssue.goalId}`, ctx, env.apiKey)
      : null;

    // 3. dispatch_authorized gate — refuse without the marker.
    const authDoc = await getDocumentOrNull(
      sourceIssueId,
      DISPATCH_AUTHORIZED_DOC_KEY,
      ctx,
      env.apiKey
    );
    checkDispatchAuthorization(
      sourceIssue.identifier,
      authDoc ? { body: authDoc.body ?? null } : null
    );

    // 4. Resolve origin company prefix (for in-brief links).
    const originCompany = await getJsonOrNull<CompanyResponse>(
      `/api/companies/${env.companyId}`,
      ctx,
      env.apiKey
    );
    const originPrefix = pickPrefix(originCompany, sourceIssue.identifier);

    // 5. Resolve escalation chain (assignee + manager).
    const escalation = await resolveEscalation(sourceIssue.assigneeAgentId, ctx, env.apiKey);

    // 6. Render the brief with the {{MIRROR_LINK}} placeholder.
    const briefInput = {
      sourceIssue: {
        id: sourceIssue.id,
        identifier: sourceIssue.identifier,
        title: sourceIssue.title,
        description: sourceIssue.description ?? '',
        priority: sourceIssue.priority,
        assigneeAgentId: sourceIssue.assigneeAgentId
      },
      ancestors,
      project,
      goal,
      originCompanyPrefix: originPrefix,
      escalation
    };
    const rendered = renderBrief(briefInput);

    // 7. Resolve target company + CEO (sibling auth).
    const targetCompany = await getJson<CompanyResponse>(
      `/api/companies/${targetCompanyId}`,
      ctx,
      dispatcherKey.reveal()
    );
    const targetAgents = await getJson<AgentResponse[]>(
      `/api/companies/${targetCompanyId}/agents`,
      ctx,
      dispatcherKey.reveal()
    );
    const ceo = pickCeo(targetCompany, targetAgents);
    if (!ceo) {
      throw new Error(
        `Target company ${targetCompanyId} has no resolvable CEO agent — cannot assign the mirror.`
      );
    }
    const targetPrefix = pickPrefix(targetCompany, null);

    // 8. POST mirror issue (sibling JWT). Use the placeholder description.
    const mirror = await postJson<MirrorCreateResponse>(
      `/api/companies/${targetCompanyId}/issues`,
      {
        title: sourceIssue.title,
        description: rendered.body,
        priority: sourceIssue.priority,
        status: 'todo',
        assigneeAgentId: ceo.id
      },
      ctx,
      dispatcherKey.reveal(),
      runId
    );

    const dispatchedAt = now().toISOString();
    const mirrorUrl = `/${targetPrefix}/issues/${mirror.identifier}`;
    const mirrorLinkMarkdown = `[${mirror.identifier}](${mirrorUrl})`;

    // 9. Write dispatch-metadata on the mirror (sibling JWT).
    await putDocument(
      mirror.id,
      DISPATCH_METADATA_DOC_KEY,
      renderMirrorMetadata({
        originIssueId: sourceIssue.id,
        originCompanyId: env.companyId,
        originIdentifier: sourceIssue.identifier,
        dispatchedAt,
        dispatchedByAgentId: dispatchedByAgentId ?? null
      }),
      ctx,
      dispatcherKey.reveal(),
      runId
    );

    // 10. Re-render with the real mirror URL and PATCH the mirror description.
    const finalBody = fillMirrorLink(rendered.body, mirrorLinkMarkdown);
    await patchIssue(mirror.id, { description: finalBody }, ctx, dispatcherKey.reveal(), runId);

    // 11. Write dispatch-metadata on the source (origin JWT).
    await putDocument(
      sourceIssueId,
      DISPATCH_METADATA_DOC_KEY,
      renderSourceMetadata({
        mirrorIssueId: mirror.id,
        mirrorCompanyId: targetCompanyId,
        mirrorIdentifier: mirror.identifier,
        dispatchedAt
      }),
      ctx,
      env.apiKey,
      runId
    );

    // 12. Comment on the source linking the mirror. The comment body must
    //     never include the dispatcher key — we only embed the identifier.
    await postComment(
      sourceIssueId,
      `Dispatched to sibling company → ${mirrorLinkMarkdown}\n\n- Mirror status: \`todo\` (assignee: target CEO)\n- Metadata document: \`${DISPATCH_METADATA_DOC_KEY}\` on both sides.`,
      ctx,
      env.apiKey,
      runId
    );

    return {
      mirrorIssueId: mirror.id,
      mirrorIdentifier: mirror.identifier,
      mirrorCompanyId: targetCompanyId,
      mirrorIssueUrl: mirrorUrl
    };
  } catch (err) {
    // Defense in depth: never let the key value leak through an Error.message
    // from any upstream service.
    if (err instanceof Error && err.message) {
      err.message = redactKey(err.message, dispatcherKey);
    }
    throw err;
  }
}

interface RequestCtx {
  env: PaperclipEnv;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}

async function getJson<T>(path: string, ctx: RequestCtx, token: string): Promise<T> {
  return request<T>(path, { method: 'GET', headers: jsonHeaders(token) }, ctx);
}

async function getJsonOrNull<T>(path: string, ctx: RequestCtx, token: string): Promise<T | null> {
  try {
    return await getJson<T>(path, ctx, token);
  } catch (err) {
    if (err instanceof DispatchError && err.status === 404) return null;
    throw err;
  }
}

async function getDocumentOrNull(
  issueId: string,
  key: string,
  ctx: RequestCtx,
  token: string
): Promise<DocumentResponse | null> {
  return getJsonOrNull<DocumentResponse>(`/api/issues/${issueId}/documents/${key}`, ctx, token);
}

async function postJson<T>(
  path: string,
  body: unknown,
  ctx: RequestCtx,
  token: string,
  runId: string | undefined
): Promise<T> {
  return request<T>(
    path,
    {
      method: 'POST',
      headers: jsonHeaders(token, runId),
      body: JSON.stringify(body)
    },
    ctx
  );
}

async function patchIssue(
  issueId: string,
  body: unknown,
  ctx: RequestCtx,
  token: string,
  runId: string | undefined
): Promise<void> {
  await request<unknown>(
    `/api/issues/${issueId}`,
    {
      method: 'PATCH',
      headers: jsonHeaders(token, runId),
      body: JSON.stringify(body)
    },
    ctx
  );
}

async function putDocument(
  issueId: string,
  key: string,
  body: string,
  ctx: RequestCtx,
  token: string,
  runId: string | undefined
): Promise<void> {
  await request<unknown>(
    `/api/issues/${issueId}/documents/${key}`,
    {
      method: 'PUT',
      headers: jsonHeaders(token, runId),
      body: JSON.stringify({
        title: 'Dispatch metadata',
        format: 'markdown',
        body,
        baseRevisionId: null
      })
    },
    ctx
  );
}

async function postComment(
  issueId: string,
  body: string,
  ctx: RequestCtx,
  token: string,
  runId: string | undefined
): Promise<void> {
  await request<unknown>(
    `/api/issues/${issueId}/comments`,
    {
      method: 'POST',
      headers: jsonHeaders(token, runId),
      body: JSON.stringify({ body })
    },
    ctx
  );
}

async function fetchAncestors(
  parentId: string | null,
  ctx: RequestCtx,
  token: string
): Promise<AncestorLike[]> {
  const out: AncestorLike[] = [];
  let current = parentId;
  // Hard cap on chain depth so a malformed parentId never loops.
  for (let i = 0; i < 12 && current; i++) {
    const issue = await getJsonOrNull<IssueResponse>(`/api/issues/${current}`, ctx, token);
    if (!issue) break;
    out.push({ identifier: issue.identifier, title: issue.title });
    current = issue.parentId ?? null;
  }
  return out;
}

async function resolveEscalation(
  assigneeAgentId: string | null,
  ctx: RequestCtx,
  token: string
): Promise<{ primary?: string | null; secondary?: string | null }> {
  if (!assigneeAgentId) return {};
  const agent = await getJsonOrNull<AgentResponse>(`/api/agents/${assigneeAgentId}`, ctx, token);
  if (!agent) return {};
  let secondary: string | null = null;
  if (agent.reportsTo) {
    const manager = await getJsonOrNull<AgentResponse>(
      `/api/agents/${agent.reportsTo}`,
      ctx,
      token
    );
    if (manager) secondary = manager.name;
  }
  return { primary: agent.name, secondary };
}

function pickPrefix(company: CompanyResponse | null, identifier: string | null): string {
  if (company?.prefix) return company.prefix;
  if (company?.identifierPrefix) return company.identifierPrefix;
  if (identifier && identifier.includes('-')) return identifier.split('-')[0];
  return (
    company?.name
      ?.replace(/[^A-Za-z0-9]+/g, '')
      .toUpperCase()
      .slice(0, 6) || 'CO'
  );
}

function pickCeo(company: CompanyResponse | null, agents: AgentResponse[]): AgentResponse | null {
  if (company?.ceoAgentId) {
    const direct = agents.find((a) => a.id === company.ceoAgentId);
    if (direct) return direct;
  }
  const byRole = agents.find((a) => (a.role ?? '').toLowerCase() === 'ceo');
  if (byRole) return byRole;
  const topOfChain = agents.find((a) => !a.reportsTo);
  return topOfChain ?? null;
}

function jsonHeaders(token: string, runId?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  if (runId) h['X-Paperclip-Run-Id'] = runId;
  return h;
}

async function request<T>(path: string, init: RequestInit, ctx: RequestCtx): Promise<T> {
  const url = `${ctx.env.apiUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  try {
    const res = await ctx.fetchImpl(url, { ...init, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new DispatchError(res.status, path, text);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

function renderMirrorMetadata(fields: {
  originIssueId: string;
  originCompanyId: string;
  originIdentifier: string;
  dispatchedAt: string;
  dispatchedByAgentId: string | null;
}): string {
  return [
    `originIssueId: ${fields.originIssueId}`,
    `originCompanyId: ${fields.originCompanyId}`,
    `originIdentifier: ${fields.originIdentifier}`,
    `dispatchedAt: ${fields.dispatchedAt}`,
    `dispatchedByAgentId: ${fields.dispatchedByAgentId ?? ''}`
  ].join('\n');
}

function renderSourceMetadata(fields: {
  mirrorIssueId: string;
  mirrorCompanyId: string;
  mirrorIdentifier: string;
  dispatchedAt: string;
}): string {
  return [
    `mirrorIssueId: ${fields.mirrorIssueId}`,
    `mirrorCompanyId: ${fields.mirrorCompanyId}`,
    `mirrorIdentifier: ${fields.mirrorIdentifier}`,
    `dispatchedAt: ${fields.dispatchedAt}`
  ].join('\n');
}

export { DispatchAuthorizationError, DispatchBriefError };
