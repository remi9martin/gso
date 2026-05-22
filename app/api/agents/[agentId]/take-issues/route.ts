import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createPaperclipClient } from '@/lib/paperclip/client';
import { PaperclipEnvError } from '@/lib/paperclip/env';
import { PaperclipApiError } from '@/lib/paperclip/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  sourceAgentId: z.string().min(1),
  issueIds: z.array(z.string()).optional()
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId: targetAgentId } = await params;

  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await request.json();
    body = BodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { sourceAgentId, issueIds } = body;

  if (sourceAgentId === targetAgentId) {
    return NextResponse.json({ error: 'same_agent' }, { status: 400 });
  }

  try {
    const client = createPaperclipClient();

    // Fetch open issues for source agent (or use the provided list)
    let issues = await client.listIssuesByAgent(sourceAgentId);
    if (issueIds && issueIds.length > 0) {
      const idSet = new Set(issueIds);
      issues = issues.filter((i) => idSet.has(i.id));
    }

    if (issues.length === 0) {
      return NextResponse.json({ reassigned: [], errors: [] });
    }

    // Reassign each issue to target agent
    const results = await Promise.allSettled(
      issues.map((issue) => client.reassignIssue(issue.id, targetAgentId))
    );

    const reassigned: Array<{ id: string; identifier: string; title: string }> = [];
    const errors: Array<{ id: string; identifier: string; error: string }> = [];

    results.forEach((result, i) => {
      const issue = issues[i];
      if (result.status === 'fulfilled') {
        reassigned.push({ id: issue.id, identifier: issue.identifier, title: issue.title });
      } else {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push({ id: issue.id, identifier: issue.identifier, error: msg });
      }
    });

    return NextResponse.json({ reassigned, errors });
  } catch (err) {
    if (err instanceof PaperclipEnvError) {
      return NextResponse.json(
        { error: 'paperclip_env_missing', missing: err.missing, message: err.message },
        { status: 503 }
      );
    }
    if (err instanceof PaperclipApiError) {
      return NextResponse.json(
        {
          error: 'paperclip_api_error',
          upstreamStatus: err.status,
          endpoint: err.endpoint,
          message: err.message
        },
        { status: 502 }
      );
    }
    console.error('[gso] /api/agents/[agentId]/take-issues failed', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
