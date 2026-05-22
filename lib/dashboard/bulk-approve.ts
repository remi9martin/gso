import type { PaperclipIssue } from '@/lib/paperclip/types';

/**
 * Returns in_review issues safe to bulk-approve — excludes any whose IDs appear
 * in `pendingApprovalIssueIds` (board approval request still outstanding).
 */
export function filterApprovableIssues(
  issues: PaperclipIssue[],
  pendingApprovalIssueIds: ReadonlySet<string>
): PaperclipIssue[] {
  return issues.filter(
    (issue) => issue.status === 'in_review' && !pendingApprovalIssueIds.has(issue.id)
  );
}

export interface PatchResponse {
  ok: boolean;
}

export interface BulkApproveResult {
  succeeded: string[];
  failed: string[];
}

/** Parallel-PATCHes each issue ID to the given status. */
export async function bulkPatchIssues(
  issueIds: string[],
  status: 'done' | 'in_review',
  patchFn: (id: string, body: { status: string }) => Promise<PatchResponse>
): Promise<BulkApproveResult> {
  const results = await Promise.allSettled(
    issueIds.map((id) => patchFn(id, { status }))
  );
  const succeeded: string[] = [];
  const failed: string[] = [];
  results.forEach((result, i) => {
    const id = issueIds[i];
    if (result.status === 'fulfilled' && result.value.ok) {
      succeeded.push(id);
    } else {
      failed.push(id);
    }
  });
  return { succeeded, failed };
}
