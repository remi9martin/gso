'use client';

import type { CanvasLayout, CanvasLayoutNode } from '@/lib/canvas/layout';
import type { AgentStatusFlag, CanvasNode } from '@/lib/canvas/types';
import { isOverloaded, pickCardTone } from '@/lib/canvas/filter';

import styles from './canvas.module.css';

const NODE_WIDTH = 240;
const NODE_HEIGHT = 168;

export function CanvasGraph({ layout }: { layout: CanvasLayout }) {
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
          {layout.nodes.map((laidOut) => (
            <AgentNode key={laidOut.node.org.agentId} laidOut={laidOut} />
          ))}
        </g>
      </svg>
    </div>
  );
}

function AgentNode({ laidOut }: { laidOut: CanvasLayoutNode }) {
  const { node, x, y } = laidOut;
  const tone = pickCardTone(node);
  const overloaded = isOverloaded(node);
  const isRunning = node.org.runtimeStatus === 'running';
  const cardClass = [
    styles.card,
    styles[`card_${tone}`],
    overloaded ? styles.card_overloaded : null
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <foreignObject x={x} y={y} width={NODE_WIDTH} height={NODE_HEIGHT}>
      <div
        className={cardClass}
        data-testid={`agent-card-${node.org.urlKey}`}
        data-overloaded={overloaded ? 'true' : undefined}
        data-tone={tone}
        tabIndex={0}
        role="button"
        aria-label={`${node.org.displayName} (${node.org.roleKey})`}
      >
        {isRunning ? <span className={styles.cardRunningStripe} aria-hidden /> : null}
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
}

function FlagRow({ flags }: { flags: AgentStatusFlag[] }) {
  // Hide the no-op `running` / `idle` informational flags now that the card
  // surfaces runtime state via the left stripe + role. Keep exception flags
  // so overload/paused/budget warnings still pop on the card.
  const visible = flags.filter((f) => f.key !== 'running' && f.key !== 'idle');
  if (!visible.length) return null;
  return (
    <div className={styles.flagRow}>
      {visible.map((flag) => (
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
      <div className={styles.budgetTrack} data-empty={pct === 0 ? 'true' : undefined} aria-hidden>
        <div
          className={`${styles.budgetFill} ${styles[`fill_${tone}`]}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}

function formatUSD(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) {
    return `$${(dollars / 1000).toFixed(1)}k`;
  }
  return `$${dollars.toFixed(0)}`;
}
