import type { CanvasBundle } from './types';

export interface ReassignResult {
  issueIds: string[];
  sourceAgentId: string;
  targetAgentId: string;
}

export interface ReassignApiResponse {
  reassigned: Array<{ id: string; identifier: string; title: string }>;
  errors: Array<{ id: string; identifier: string; error: string }>;
}

/** Optimistically move all open-issue workload from source → target in the bundle. */
export function applyOptimisticReassign(
  bundle: CanvasBundle,
  sourceAgentId: string,
  targetAgentId: string
): CanvasBundle {
  const source = bundle.nodes.find((n) => n.org.agentId === sourceAgentId);
  const target = bundle.nodes.find((n) => n.org.agentId === targetAgentId);
  if (!source || !target) return bundle;

  const delta = {
    openCount: source.workload.openCount,
    inProgressCount: source.workload.inProgressCount,
    inReviewCount: source.workload.inReviewCount,
    blockedCount: source.workload.blockedCount,
    highPriorityOpenCount: source.workload.highPriorityOpenCount
  };

  return {
    ...bundle,
    nodes: bundle.nodes.map((node) => {
      if (node.org.agentId === sourceAgentId) {
        return {
          ...node,
          workload: {
            openCount: 0,
            inProgressCount: 0,
            inReviewCount: 0,
            blockedCount: 0,
            highPriorityOpenCount: 0,
            currentIssueRef: null
          }
        };
      }
      if (node.org.agentId === targetAgentId) {
        return {
          ...node,
          workload: {
            openCount: node.workload.openCount + delta.openCount,
            inProgressCount: node.workload.inProgressCount + delta.inProgressCount,
            inReviewCount: node.workload.inReviewCount + delta.inReviewCount,
            blockedCount: node.workload.blockedCount + delta.blockedCount,
            highPriorityOpenCount:
              node.workload.highPriorityOpenCount + delta.highPriorityOpenCount,
            currentIssueRef:
              node.workload.currentIssueRef ?? source.workload.currentIssueRef
          }
        };
      }
      return node;
    })
  };
}

/** Convert a successful API response to a ReassignResult. */
export function toReassignResult(
  response: ReassignApiResponse,
  sourceAgentId: string,
  targetAgentId: string
): ReassignResult {
  return {
    issueIds: response.reassigned.map((r) => r.id),
    sourceAgentId,
    targetAgentId
  };
}
