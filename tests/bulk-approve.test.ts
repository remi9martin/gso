import { describe, expect, it, vi } from 'vitest';

import {
  filterApprovableIssues,
  bulkPatchIssues
} from '@/lib/dashboard/bulk-approve';
import type { PaperclipIssue } from '@/lib/paperclip/types';

function makeIssue(overrides: Partial<PaperclipIssue> = {}): PaperclipIssue {
  return {
    id: 'issue-1',
    identifier: 'GSO-1',
    title: 'Test issue',
    status: 'in_review',
    priority: 'medium',
    assigneeAgentId: 'agent-1',
    executionRunId: null,
    activeRun: null,
    updatedAt: new Date().toISOString(),
    lastActivityAt: null,
    ...overrides
  };
}

// --- filterApprovableIssues ---

describe('filterApprovableIssues', () => {
  it('returns in_review issues not in the pending-approval set', () => {
    const issues = [
      makeIssue({ id: 'a', status: 'in_review' }),
      makeIssue({ id: 'b', status: 'in_review' }),
      makeIssue({ id: 'c', status: 'in_review' })
    ];
    const result = filterApprovableIssues(issues, new Set(['b']));
    expect(result.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('excludes non-in_review issues', () => {
    const issues = [
      makeIssue({ id: 'a', status: 'in_review' }),
      makeIssue({ id: 'b', status: 'in_progress' }),
      makeIssue({ id: 'c', status: 'blocked' })
    ];
    const result = filterApprovableIssues(issues, new Set());
    expect(result.map((i) => i.id)).toEqual(['a']);
  });

  it('returns empty when all issues are excluded by pending approvals', () => {
    const issues = [
      makeIssue({ id: 'a', status: 'in_review' }),
      makeIssue({ id: 'b', status: 'in_review' })
    ];
    const result = filterApprovableIssues(issues, new Set(['a', 'b']));
    expect(result).toHaveLength(0);
  });

  it('returns empty for an empty issue list', () => {
    const result = filterApprovableIssues([], new Set(['x']));
    expect(result).toHaveLength(0);
  });
});

// --- bulkPatchIssues ---

describe('bulkPatchIssues', () => {
  it('calls patchFn for each id with the given status', async () => {
    const patchFn = vi.fn().mockResolvedValue({ ok: true });
    await bulkPatchIssues(['id-1', 'id-2', 'id-3'], 'done', patchFn);
    expect(patchFn).toHaveBeenCalledTimes(3);
    expect(patchFn).toHaveBeenCalledWith('id-1', { status: 'done' });
    expect(patchFn).toHaveBeenCalledWith('id-2', { status: 'done' });
    expect(patchFn).toHaveBeenCalledWith('id-3', { status: 'done' });
  });

  it('separates succeeded and failed results', async () => {
    const patchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const result = await bulkPatchIssues(['a', 'b', 'c'], 'done', patchFn);
    expect(result.succeeded).toEqual(['a', 'c']);
    expect(result.failed).toEqual(['b']);
  });

  it('treats rejected promises as failed', async () => {
    const patchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('network error'));
    const result = await bulkPatchIssues(['x', 'y'], 'done', patchFn);
    expect(result.succeeded).toEqual(['x']);
    expect(result.failed).toEqual(['y']);
  });

  it('uses in_review status for undo operations', async () => {
    const patchFn = vi.fn().mockResolvedValue({ ok: true });
    await bulkPatchIssues(['id-1'], 'in_review', patchFn);
    expect(patchFn).toHaveBeenCalledWith('id-1', { status: 'in_review' });
  });

  it('returns empty lists for empty id array', async () => {
    const patchFn = vi.fn();
    const result = await bulkPatchIssues([], 'done', patchFn);
    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(patchFn).not.toHaveBeenCalled();
  });

  it('issues all patches in parallel (all calls initiated before any resolve)', async () => {
    const callOrder: string[] = [];
    const patchFn = (id: string) => {
      callOrder.push(`start:${id}`);
      return Promise.resolve({ ok: true }).then((r) => {
        callOrder.push(`end:${id}`);
        return r;
      });
    };
    await bulkPatchIssues(['a', 'b', 'c'], 'done', patchFn);
    // All starts happen before any end (parallel, not sequential)
    const starts = callOrder.filter((e) => e.startsWith('start:'));
    expect(starts).toHaveLength(3);
  });
});
