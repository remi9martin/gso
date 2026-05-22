'use client';

import { useState } from 'react';

import type { CanvasLayout, CanvasLayoutNode } from '@/lib/canvas/layout';
import type { AgentStatusFlag, CanvasNode } from '@/lib/canvas/types';
import { burnStateFor, type BurnState } from '@/styles/tokens';

import styles from './canvas.module.css';

const NODE_WIDTH = 240;
const NODE_HEIGHT = 168;

interface DragState {
  from: string | null;
  over: string | null;
}

interface CanvasGraphProps {
  layout: CanvasLayout;
  onReassign?: (sourceAgentId: string, targetAgentId: string) => void;
}

export function CanvasGraph({ layout, onReassign }: CanvasGraphProps) {
  const [drag, setDrag] = useState<DragState>({ from: null, over: null });

  if (layout.nodes.length === 0) {
    return (
      <div className={styles.emptyState}>
        No agents to render yet. Hire your first agent to see them on the canvas.
      </div>
    );
  }

  const nodeIndex = new Map(layout.nodes.map((n) => [n.node.org.agentId, n]));

  function handleDragStart(agentId: string) {
    setDrag({ from: agentId, over: null });
  }

  function handleDragOver(agentId: string) {
    setDrag((d) => ({ ...d, over: agentId }));
  }

  function handleDragLeave() {
    setDrag((d) => ({ ...d, over: null }));
  }

  function handleDrop(sourceId: string, targetId: string) {
    setDrag({ from: null, over: null });
    if (sourceId !== targetId) {
      onReassign?.(sourceId, targetId);
    }
  }

  function handleDragEnd() {
    setDrag({ from: null, over: null });
  }

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
          {layout.nodes.map((laidOut) => (
            <AgentNode
              key={laidOut.node.org.agentId}
              laidOut={laidOut}
              isDragging={drag.from === laidOut.node.org.agentId}
              isDropTarget={
                drag.over === laidOut.node.org.agentId &&
                drag.from !== null &&
                drag.from !== laidOut.node.org.agentId
              }
              dragFrom={drag.from}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

interface AgentNodeProps {
  laidOut: CanvasLayoutNode;
  isDragging: boolean;
  isDropTarget: boolean;
  dragFrom: string | null;
  onDragStart: (agentId: string) => void;
  onDragOver: (agentId: string) => void;
  onDragLeave: () => void;
  onDrop: (sourceId: string, targetId: string) => void;
  onDragEnd: () => void;
}

function AgentNode({
  laidOut,
  isDragging,
  isDropTarget,
  dragFrom,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd
}: AgentNodeProps) {
  const { node, x, y } = laidOut;
  const agentId = node.org.agentId;
  const statusTone = pickStatusTone(node);

  const cardClass = [
    styles.card,
    styles[`card_${statusTone}`],
    isDragging ? styles.card_dragging : '',
    isDropTarget ? styles.card_dropTarget : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <foreignObject x={x} y={y} width={NODE_WIDTH} height={NODE_HEIGHT}>
      <div
        className={cardClass}
        data-testid={`agent-card-${node.org.urlKey}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', agentId);
          e.dataTransfer.effectAllowed = 'move';
          onDragStart(agentId);
        }}
        onDragOver={(e) => {
          if (dragFrom && dragFrom !== agentId) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            onDragOver(agentId);
          }
        }}
        onDragLeave={(e) => {
          // Only fire leave when leaving the card entirely (not a child element)
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            onDragLeave();
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          const sourceId = e.dataTransfer.getData('text/plain');
          if (sourceId && sourceId !== agentId) {
            onDrop(sourceId, agentId);
          }
        }}
        onDragEnd={onDragEnd}
      >
        <div className={styles.cardHeader}>
          <span className={styles.cardName}>{node.org.displayName}</span>
          <span className={styles.cardRole}>{node.org.roleKey}</span>
        </div>
        <FlagRow flags={node.flags} />
        <WorkloadRow node={node} />
        <BudgetRow node={node} />
        {isDropTarget && (
          <div className={styles.dropHint} aria-hidden>
            Drop to reassign issues
          </div>
        )}
      </div>
    </foreignObject>
  );
}

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
  const state = burnStateFor(pct);
  const widthPct = Math.min(Math.max(pct * 100, 0), 100);
  return (
    <div className={styles.budgetRow}>
      <div className={styles.budgetLabel}>
        <span>{formatUSD(b.monthSpentCents ?? 0)}</span>
        <span className={styles.budgetSlash}> / </span>
        <span>{formatUSD(b.monthBudgetCents)}</span>
        <span className={`${styles.budgetPct} ${styles[`pct_${pctToneFor(state)}`]}`}>
          {(pct * 100).toFixed(0)}%
        </span>
      </div>
      <div
        className={styles.budgetTrack}
        role="meter"
        aria-label="Budget burn"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuetext={`${(pct * 100).toFixed(0)}% — ${state}`}
      >
        <div className={styles.budgetFill} data-state={state} style={{ width: `${widthPct}%` }} />
      </div>
    </div>
  );
}

function pctToneFor(state: BurnState): 'ok' | 'warn' | 'critical' {
  if (state === 'critical') return 'critical';
  if (state === 'healthy') return 'ok';
  return 'warn';
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
