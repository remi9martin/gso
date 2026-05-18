import type { CanvasLayout } from './layout';

export type OrgDrawerSlot =
  | { kind: 'agent-detail'; agentId: string }
  | { kind: 'routing-trace'; issueId: string }
  | { kind: 'rules-explainer'; ruleSetId: string };

export type OrgDrawerSlotKind = OrgDrawerSlot['kind'];

export const ORG_DRAWER_WIDTH_PX = 384;

export type TreeNavDirection = 'up' | 'down' | 'left' | 'right';

export interface TreeNavResult {
  agentId: string;
  moved: boolean;
}

export function resolveTreeNavigation(
  layout: CanvasLayout,
  fromAgentId: string,
  direction: TreeNavDirection
): TreeNavResult {
  const nodes = layout.nodes;
  if (nodes.length === 0) return { agentId: fromAgentId, moved: false };

  const current = nodes.find((n) => n.node.org.agentId === fromAgentId);
  if (!current) {
    return { agentId: nodes[0].node.org.agentId, moved: true };
  }

  if (direction === 'up') {
    const parentId = current.node.org.reportsToAgentId;
    if (parentId) {
      const parent = nodes.find((n) => n.node.org.agentId === parentId);
      if (parent) return { agentId: parent.node.org.agentId, moved: true };
    }
    return { agentId: fromAgentId, moved: false };
  }

  if (direction === 'down') {
    const children = nodes
      .filter((n) => n.node.org.reportsToAgentId === fromAgentId)
      .sort((a, b) => a.x - b.x);
    if (children.length > 0) {
      return { agentId: children[0].node.org.agentId, moved: true };
    }
    return { agentId: fromAgentId, moved: false };
  }

  const siblings = nodes.filter((n) => n.level === current.level).sort((a, b) => a.x - b.x);
  const idx = siblings.findIndex((n) => n.node.org.agentId === fromAgentId);
  if (idx < 0) return { agentId: fromAgentId, moved: false };

  if (direction === 'left') {
    if (idx === 0) return { agentId: fromAgentId, moved: false };
    return { agentId: siblings[idx - 1].node.org.agentId, moved: true };
  }

  if (idx === siblings.length - 1) return { agentId: fromAgentId, moved: false };
  return { agentId: siblings[idx + 1].node.org.agentId, moved: true };
}

export function arrowKeyToTreeDirection(key: string): TreeNavDirection | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}
