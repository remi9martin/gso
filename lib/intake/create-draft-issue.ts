import 'server-only';

import { readPaperclipEnv, type PaperclipEnv } from '../paperclip/env';
import { renderDraftDescription, type DraftFrontMatter } from './front-matter';

export interface CreateDraftIssueInput {
  title: string;
  summary: string;
  frontMatter: DraftFrontMatter;
  projectId: string;
  assigneeUserId: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
}

export interface CreatedDraftIssue {
  id: string;
  identifier: string;
  rawPayloadId: string;
  created: boolean;
}

export interface CreateDraftIssueOptions {
  env?: PaperclipEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  runId?: string;
}

export class CreateDraftIssueError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    public readonly bodyText: string
  ) {
    super(`Intake createDraftIssue ${endpoint} returned ${status}: ${bodyText.slice(0, 200)}`);
    this.name = 'CreateDraftIssueError';
  }
}

interface PaperclipIssueShape {
  id: string;
  identifier: string;
  description?: string | null;
  projectId?: string | null;
}

export async function createDraftIssue(
  input: CreateDraftIssueInput,
  options: CreateDraftIssueOptions = {}
): Promise<CreatedDraftIssue> {
  const env = options.env ?? readPaperclipEnv();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const runId = options.runId ?? process.env.PAPERCLIP_RUN_ID;

  const existing = await findDraftByPayloadId(input.frontMatter.rawPayloadId, input.projectId, {
    env,
    fetchImpl,
    timeoutMs
  });
  if (existing) {
    return {
      id: existing.id,
      identifier: existing.identifier,
      rawPayloadId: input.frontMatter.rawPayloadId,
      created: false
    };
  }

  const description = renderDraftDescription(input.summary, input.frontMatter);
  const body = {
    title: input.title,
    description,
    projectId: input.projectId,
    assigneeUserId: input.assigneeUserId,
    priority: input.priority ?? 'medium',
    status: 'todo'
  };

  const issue = await request<PaperclipIssueShape>(
    `/api/companies/${env.companyId}/issues`,
    {
      method: 'POST',
      headers: jsonHeaders(env.apiKey, runId),
      body: JSON.stringify(body)
    },
    { env, fetchImpl, timeoutMs }
  );

  return {
    id: issue.id,
    identifier: issue.identifier,
    rawPayloadId: input.frontMatter.rawPayloadId,
    created: true
  };
}

async function findDraftByPayloadId(
  rawPayloadId: string,
  projectId: string,
  ctx: { env: PaperclipEnv; fetchImpl: typeof fetch; timeoutMs: number }
): Promise<PaperclipIssueShape | null> {
  const qs = new URLSearchParams({
    projectId,
    q: rawPayloadId,
    limit: '20'
  });
  const path = `/api/companies/${ctx.env.companyId}/issues?${qs.toString()}`;
  const result = await request<PaperclipIssueShape[] | { issues: PaperclipIssueShape[] }>(
    path,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${ctx.env.apiKey}`, Accept: 'application/json' }
    },
    ctx
  );
  const items = Array.isArray(result) ? result : (result.issues ?? []);
  for (const issue of items) {
    if (issue.projectId && issue.projectId !== projectId) continue;
    const description = issue.description ?? '';
    if (descriptionHasPayloadId(description, rawPayloadId)) return issue;
  }
  return null;
}

function descriptionHasPayloadId(description: string, rawPayloadId: string): boolean {
  // Match the front-matter line exactly so we don't trigger on incidental
  // text mentions of the payload id elsewhere in the body.
  const needle = `\nrawPayloadId: ${rawPayloadId}`;
  return ('\n' + description).includes(needle);
}

function jsonHeaders(apiKey: string, runId: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  if (runId) headers['X-Paperclip-Run-Id'] = runId;
  return headers;
}

async function request<T>(
  path: string,
  init: RequestInit,
  ctx: { env: PaperclipEnv; fetchImpl: typeof fetch; timeoutMs: number }
): Promise<T> {
  const url = `${ctx.env.apiUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  try {
    const res = await ctx.fetchImpl(url, { ...init, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new CreateDraftIssueError(res.status, path, text);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export { renderDraftDescription, parseDraftDescription } from './front-matter';
export type { DraftFrontMatter, SuggestedTag } from './front-matter';
