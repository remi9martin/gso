'use client';

import { useEffect, useRef } from 'react';

import type { OrgDrawerSlot } from '@/lib/canvas/drawer';
import { ORG_DRAWER_WIDTH_PX } from '@/lib/canvas/drawer';
import type { CanvasNode } from '@/lib/canvas/types';

import styles from './canvas.module.css';

interface OrgCanvasDrawerProps {
  slot: OrgDrawerSlot | null;
  nodesByAgentId: Map<string, CanvasNode>;
  onClose: () => void;
  showRecentDecisions?: boolean;
}

export function OrgCanvasDrawer({
  slot,
  nodesByAgentId,
  onClose,
  showRecentDecisions = false
}: OrgCanvasDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!slot) return;
    closeButtonRef.current?.focus();
  }, [slot]);

  if (!slot) return null;

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={drawerAriaLabel(slot)}
      className={styles.drawer}
      style={{ width: `${ORG_DRAWER_WIDTH_PX}px` }}
      data-slot-kind={slot.kind}
    >
      <header className={styles.drawerHeader}>
        <span className={styles.drawerKind}>{slotHeaderLabel(slot)}</span>
        <button
          ref={closeButtonRef}
          type="button"
          className={styles.drawerClose}
          onClick={onClose}
          aria-label="Close drawer"
        >
          ×
        </button>
      </header>
      <div className={styles.drawerBody}>
        {slot.kind === 'agent-detail' ? (
          <AgentDetailSlot
            agentId={slot.agentId}
            node={nodesByAgentId.get(slot.agentId)}
            nodesByAgentId={nodesByAgentId}
            showRecentDecisions={showRecentDecisions}
          />
        ) : slot.kind === 'routing-trace' ? (
          <ComingSoonSlot
            issueRef="GSO-36"
            issueHref="/GSO/issues/GSO-36"
            label={`Routing trace for issue ${slot.issueId}`}
          />
        ) : (
          <ComingSoonSlot
            issueRef="GSO-29"
            issueHref="/GSO/issues/GSO-29"
            label={`Rules explainer for rule set ${slot.ruleSetId}`}
          />
        )}
      </div>
    </aside>
  );
}

function drawerAriaLabel(slot: OrgDrawerSlot): string {
  switch (slot.kind) {
    case 'agent-detail':
      return 'Agent detail';
    case 'routing-trace':
      return 'Routing trace';
    case 'rules-explainer':
      return 'Rules explainer';
  }
}

function slotHeaderLabel(slot: OrgDrawerSlot): string {
  switch (slot.kind) {
    case 'agent-detail':
      return 'Agent detail';
    case 'routing-trace':
      return 'Routing trace';
    case 'rules-explainer':
      return 'Rules explainer';
  }
}

interface AgentDetailSlotProps {
  agentId: string;
  node: CanvasNode | undefined;
  nodesByAgentId: Map<string, CanvasNode>;
  showRecentDecisions: boolean;
}

function AgentDetailSlot({
  agentId,
  node,
  nodesByAgentId,
  showRecentDecisions
}: AgentDetailSlotProps) {
  if (!node) {
    return (
      <div className={styles.drawerEmpty}>
        Agent <code>{agentId}</code> is no longer on the canvas. Refresh to reload.
      </div>
    );
  }

  const manager = node.org.reportsToAgentId
    ? nodesByAgentId.get(node.org.reportsToAgentId)
    : undefined;
  const reports = [...nodesByAgentId.values()]
    .filter((n) => n.org.reportsToAgentId === node.org.agentId)
    .sort((a, b) => a.org.displayName.localeCompare(b.org.displayName));

  return (
    <div className={styles.drawerSections}>
      <section className={styles.drawerSection}>
        <div className={styles.drawerAgentHeader}>
          <div>
            <h3 className={styles.drawerAgentName}>{node.org.displayName}</h3>
            <p className={styles.drawerAgentRole}>
              {node.org.title ?? node.org.roleKey}
              {node.org.title ? ` · ${node.org.roleKey}` : ''}
            </p>
          </div>
          <StatusPill node={node} />
        </div>
      </section>

      <section className={styles.drawerSection} aria-label="Budget burn">
        <DrawerBurnBar node={node} />
      </section>

      <section className={styles.drawerSection} aria-label="Routing rationale">
        <dl className={styles.drawerDl}>
          <dt>Capabilities</dt>
          <dd>
            <span className={styles.drawerChip}>{node.org.roleKey}</span>
            <span className={styles.drawerChip}>{node.org.adapterType}</span>
            {node.org.heartbeatEnabled ? (
              <span className={styles.drawerChip}>heartbeat: on</span>
            ) : (
              <span className={styles.drawerChip}>heartbeat: off</span>
            )}
            <span className={styles.drawerChip}>
              slots {node.capacity.slotsActive}/{node.capacity.slotsTotal}
            </span>
          </dd>

          <dt>Chain of command</dt>
          <dd>
            {manager ? (
              <span>
                Reports to <strong>{manager.org.displayName}</strong> ({manager.org.roleKey})
              </span>
            ) : (
              <span className={styles.drawerMuted}>Top-level (no manager)</span>
            )}
            {reports.length > 0 ? (
              <ul className={styles.drawerInlineList}>
                {reports.map((r) => (
                  <li key={r.org.agentId}>
                    {r.org.displayName}{' '}
                    <span className={styles.drawerMuted}>· {r.org.roleKey}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className={styles.drawerMuted}> · no direct reports</span>
            )}
          </dd>

          <dt>Open issues</dt>
          <dd>
            <span>
              <strong>{node.workload.openCount}</strong> open · {node.workload.inProgressCount}{' '}
              in-progress · {node.workload.blockedCount} blocked ·{' '}
              {node.workload.highPriorityOpenCount} high-priority
            </span>
            {node.workload.currentIssueRef ? (
              <p className={styles.drawerCurrent}>
                Currently:{' '}
                <a href={`/GSO/issues/${node.workload.currentIssueRef.identifier}`}>
                  <code>{node.workload.currentIssueRef.identifier}</code>
                </a>{' '}
                — {node.workload.currentIssueRef.title}
              </p>
            ) : null}
          </dd>
        </dl>
      </section>

      {showRecentDecisions ? (
        <section className={styles.drawerSection} aria-label="Recent decisions">
          <h4 className={styles.drawerSubhead}>Recent decisions</h4>
          <p className={styles.drawerMuted}>
            Decision history surface will land with <a href="/GSO/issues/GSO-36">GSO-36</a> (routing
            trace).
          </p>
        </section>
      ) : null}
    </div>
  );
}

function StatusPill({ node }: { node: CanvasNode }) {
  const tone = node.org.runtimeStatus;
  return (
    <span
      className={`${styles.drawerStatusPill} ${styles[`drawerStatus_${tone}`] ?? ''}`}
      data-runtime-status={tone}
    >
      {node.org.runtimeStatus}
      {node.org.pauseReason ? ` · ${node.org.pauseReason}` : ''}
    </span>
  );
}

function DrawerBurnBar({ node }: { node: CanvasNode }) {
  const b = node.budget;
  if (b.monthBudgetCents == null) {
    return <p className={styles.drawerMuted}>Budget not set for this agent.</p>;
  }
  const pct = b.monthUtilizationPct ?? 0;
  const tone =
    pct >= b.pauseThresholdPct ? 'critical' : pct >= b.attentionThresholdPct ? 'warn' : 'ok';
  const widthPct = Math.min(Math.max(pct * 100, 0), 100);
  return (
    <div className={styles.drawerBurn}>
      <div className={styles.drawerBurnLabel}>
        <span className={styles.drawerBurnLabelLeft}>
          <span>{formatUSD(b.monthSpentCents ?? 0)}</span>
          <span className={styles.budgetSlash}> / </span>
          <span>{formatUSD(b.monthBudgetCents)}</span>
        </span>
        <span className={`${styles.budgetPct} ${styles[`pct_${tone}`]}`}>
          {(pct * 100).toFixed(0)}%
        </span>
      </div>
      <div className={styles.drawerBurnTrack}>
        <div
          className={`${styles.budgetFill} ${styles[`fill_${tone}`]}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <p className={styles.drawerBurnNote}>
        Attention at {(b.attentionThresholdPct * 100).toFixed(0)}% · pause at{' '}
        {(b.pauseThresholdPct * 100).toFixed(0)}%
      </p>
    </div>
  );
}

interface ComingSoonSlotProps {
  issueRef: string;
  issueHref: string;
  label: string;
}

function ComingSoonSlot({ issueRef, issueHref, label }: ComingSoonSlotProps) {
  return (
    <div className={styles.drawerComing}>
      <h4 className={styles.drawerSubhead}>{label}</h4>
      <p>
        Coming in <a href={issueHref}>{issueRef}</a>.
      </p>
      <p className={styles.drawerMuted}>
        Slot surface is wired — content lands when the owning issue ships.
      </p>
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
