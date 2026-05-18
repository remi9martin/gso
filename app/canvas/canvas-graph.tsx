'use client';

import { forwardRef, type KeyboardEvent, type MouseEvent } from 'react';

import type { CanvasLayout, CanvasLayoutNode } from '@/lib/canvas/layout';
import type { AgentStatusFlag, CanvasNode } from '@/lib/canvas/types';

import styles from './canvas.module.css';

const NODE_WIDTH = 240;
const NODE_HEIGHT = 168;

export interface CanvasGraphProps {
  layout: CanvasLayout;
  focusedAgentId: string | null;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onFocusAgent: (agentId: string) => void;
  onCardKeyDown: (event: KeyboardEvent<HTMLDivElement>, agentId: string) => void;
}

export function CanvasGraph({
  layout,
  focusedAgentId,
  selectedAgentId,
  onSelectAgent,
  onFocusAgent,
  onCardKeyDown
}: CanvasGraphProps) {
  if (layout.nodes.length === 0) {
    return (
      <div className={styles.emptyState}>
        No agents to render yet. Hire your first agent to see them on the canvas.
      </div>
    );
  }

  const nodeIndex = new Map(layout.nodes.map((n) => [n.node.org.agentId, n]));

  return (
    <div className={styles.graphScroll} role="figure" aria-label="Agent reporting tree">
      <svg
        className={styles.graphSvg}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        xmlns="http://www.w3.org/2000/svg"
      >
        <g className={styles.edges}>
          {layout.edges.map((edge) => {
            const from = nodeIndex.get(edge.fromAgentId);
            const to = nodeIndex.get(edge.toAgentId);
            if (!from || !to) return null;
            const x1 = from.x + NODE_WIDTH / 2;
            const y1 = from.y + NODE_HEIGHT;
            const x2 = to.x + NODE_WIDTH / 2;
            const y2 = to.y;
            const midY = (y1 + y2) / 2;
            const path = `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`;
            return (
              <path
                key={`${edge.fromAgentId}->${edge.toAgentId}`}
                d={path}
                className={styles.edge}
                fill="none"
              />
            );
          })}
        </g>
        <g>
          {layout.nodes.map((laidOut) => {
            const agentId = laidOut.node.org.agentId;
            return (
              <AgentNode
                key={agentId}
                laidOut={laidOut}
                isFocused={focusedAgentId === agentId}
                isSelected={selectedAgentId === agentId}
                onSelect={onSelectAgent}
                onFocus={onFocusAgent}
                onCardKeyDown={onCardKeyDown}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}

interface AgentNodeProps {
  laidOut: CanvasLayoutNode;
  isFocused: boolean;
  isSelected: boolean;
  onSelect: (agentId: string) => void;
  onFocus: (agentId: string) => void;
  onCardKeyDown: (event: KeyboardEvent<HTMLDivElement>, agentId: string) => void;
}

const AgentNode = forwardRef<HTMLDivElement, AgentNodeProps>(function AgentNode(
  { laidOut, isFocused, isSelected, onSelect, onFocus, onCardKeyDown },
  ref
) {
  const { node, x, y } = laidOut;
  const statusTone = pickStatusTone(node);
  const agentId = node.org.agentId;

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    onSelect(agentId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onCardKeyDown(event, agentId);
  };

  return (
    <foreignObject x={x} y={y} width={NODE_WIDTH} height={NODE_HEIGHT}>
      <div
        ref={ref}
        className={`${styles.card} ${styles[`card_${statusTone}`]} ${isSelected ? styles.card_selected : ''}`}
        data-testid={`agent-card-${node.org.urlKey}`}
        data-agent-id={agentId}
        role="button"
        tabIndex={isFocused ? 0 : -1}
        aria-pressed={isSelected}
        aria-label={`${node.org.displayName} — ${node.org.roleKey}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onFocus={() => onFocus(agentId)}
      >
        <div className={styles.cardHeader}>
          <span className={styles.cardName}>{node.org.displayName}</span>
          <span className={styles.cardRole}>{node.org.roleKey}</span>
        </div>
        <FlagRow flags={node.flags} />
        <WorkloadRow node={node} />
        <BudgetRow node={node} />
      </div>
    </foreignObject>
  );
});

function FlagRow({ flags }: { flags: AgentStatusFlag[] }) {
  if (!flags.length) {
    return (
      <div className={styles.flagRow}>
        <span className={`${styles.flag} ${styles.flag_info}`}>unknown</span>
      </div>
    );
  }
  return (
    <div className={styles.flagRow}>
      {flags.map((flag) => (
        <span
          key={flag.key}
          className={`${styles.flag} ${styles[`flag_${flag.severity}`]}`}
          title={flag.label}
        >
          {flag.label}
        </span>
      ))}
    </div>
  );
}

function WorkloadRow({ node }: { node: CanvasNode }) {
  const w = node.workload;
  return (
    <div className={styles.workloadRow}>
      <span className={styles.workloadStat}>
        <strong>{w.openCount}</strong> open
      </span>
      <span className={styles.workloadStat}>{w.inProgressCount} in-progress</span>
      <span className={styles.workloadStat}>{w.blockedCount} blocked</span>
    </div>
  );
}

function BudgetRow({ node }: { node: CanvasNode }) {
  const b = node.budget;
  if (b.monthBudgetCents == null) {
    return <div className={styles.budgetRow}>budget: not set</div>;
  }
  const pct = b.monthUtilizationPct ?? 0;
  const tone =
    pct >= b.pauseThresholdPct ? 'critical' : pct >= b.attentionThresholdPct ? 'warn' : 'ok';
  const widthPct = Math.min(Math.max(pct * 100, 0), 100);
  return (
    <div className={styles.budgetRow}>
      <div className={styles.budgetLabel}>
        <span>{formatUSD(b.monthSpentCents ?? 0)}</span>
        <span className={styles.budgetSlash}> / </span>
        <span>{formatUSD(b.monthBudgetCents)}</span>
        <span className={`${styles.budgetPct} ${styles[`pct_${tone}`]}`}>
          {(pct * 100).toFixed(0)}%
        </span>
      </div>
      <div className={styles.budgetTrack}>
        <div
          className={`${styles.budgetFill} ${styles[`fill_${tone}`]}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}

function pickStatusTone(node: CanvasNode): 'running' | 'idle' | 'paused' | 'error' | 'unknown' {
  if (node.org.runtimeStatus === 'error') return 'error';
  if (node.org.runtimeStatus === 'paused' || node.org.pausedAt) return 'paused';
  if (node.org.runtimeStatus === 'running') return 'running';
  if (node.org.runtimeStatus === 'idle') return 'idle';
  return 'unknown';
}

function formatUSD(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) {
    return `$${(dollars / 1000).toFixed(1)}k`;
  }
  return `$${dollars.toFixed(0)}`;
}
