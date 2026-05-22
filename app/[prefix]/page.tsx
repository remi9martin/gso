import { createPaperclipClient } from '@/lib/paperclip/client';
import { PaperclipEnvError } from '@/lib/paperclip/env';
import { PaperclipApiError } from '@/lib/paperclip/client';
import type { PaperclipIssue } from '@/lib/paperclip/types';

import { DashboardClient } from './dashboard-client';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ prefix: string }>;
}

export default async function PrefixDashboardPage({ params }: Props) {
  const { prefix } = await params;
  const upperPrefix = prefix.toUpperCase();

  let issues: PaperclipIssue[] = [];
  let pendingApprovalIssueIds: string[] = [];
  let errorMessage: string | null = null;

  try {
    const client = createPaperclipClient();
    const [allInReview, approvals] = await Promise.all([
      client.listInReviewIssues(),
      client.listPendingApprovals().catch(() => [])
    ]);

    issues = allInReview;
    pendingApprovalIssueIds = approvals.flatMap((a) => a.issueIds);
  } catch (err) {
    if (err instanceof PaperclipEnvError) {
      errorMessage = `Missing env vars: ${err.missing.join(', ')}`;
    } else if (err instanceof PaperclipApiError) {
      errorMessage = `Paperclip API error (${err.status}): ${err.endpoint}`;
    } else {
      throw err;
    }
  }

  if (errorMessage) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem', maxWidth: '48rem' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>{upperPrefix} Dashboard</h1>
        <div
          style={{
            padding: '1rem',
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: '6px',
            color: '#b91c1c'
          }}
        >
          {errorMessage}
        </div>
      </main>
    );
  }

  return (
    <DashboardClient
      prefix={upperPrefix}
      issues={issues}
      pendingApprovalIssueIds={pendingApprovalIssueIds}
    />
  );
}
