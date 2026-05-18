'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { layoutCanvas } from '@/lib/canvas/layout';
import type { CanvasLayout } from '@/lib/canvas/layout';
import type { CanvasBundle } from '@/lib/canvas/types';
import {
  DEPTH_OPTIONS,
  FILTER_OPTIONS,
  buildSummary,
  nodeMatchesFilter,
  pruneByDepth,
  type DepthKey,
  type FilterKey
} from '@/lib/canvas/filter';

import { CanvasGraph } from './canvas-graph';
import styles from './canvas.module.css';

interface CanvasClientProps {
  initialBundle: CanvasBundle;
  initialLayout: CanvasLayout;
  initialSource: 'hit' | 'miss';
  initialMode?: 'live' | 'fixture';
  initialMissingEnv?: string[] | null;
  pollIntervalMs: number;
}

interface CanvasState {
  bundle: CanvasBundle;
  source: 'hit' | 'miss' | 'client';
  fetchedAt: number;
  error: string | null;
  isFetching: boolean;
  mode: 'live' | 'fixture';
  missingEnv: string[] | null;
}

export function CanvasClient({
  initialBundle,
  initialLayout: _initialLayout,
  initialSource,
  initialMode = 'live',
  initialMissingEnv = null,
  pollIntervalMs
}: CanvasClientProps) {
  const [state, setState] = useState<CanvasState>(() => ({
    bundle: initialBundle,
    source: initialSource,
    fetchedAt: Date.now(),
    error: null,
    isFetching: false,
    mode: initialMode,
    missingEnv: initialMissingEnv
  }));
  const [filter, setFilter] = useState<FilterKey>('all');
  const [depth, setDepth] = useState<DepthKey>('all');

  const fetchCanvas = useCallback(async () => {
    setState((prev) => ({ ...prev, isFetching: true, error: null }));
    try {
      const res = await fetch('/api/canvas', { cache: 'no-store' });
      if (!res.ok) {
        const message = `Canvas fetch failed: ${res.status}`;
        setState((prev) => ({ ...prev, isFetching: false, error: message }));
        return;
      }
      const bundle = (await res.json()) as CanvasBundle;
      const source = (res.headers.get('X-GSO-Canvas-Cache') as 'hit' | 'miss' | null) ?? 'client';
      const mode = (res.headers.get('X-GSO-Canvas-Mode') as 'live' | 'fixture' | null) ?? 'live';
      const missingEnvHeader = res.headers.get('X-GSO-Canvas-Missing-Env');
      const missingEnv = missingEnvHeader ? missingEnvHeader.split(',').filter(Boolean) : null;
      setState({
        bundle,
        source,
        fetchedAt: Date.now(),
        error: null,
        isFetching: false,
        mode,
        missingEnv
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setState((prev) => ({ ...prev, isFetching: false, error: message }));
    }
  }, []);

  useEffect(() => {
    if (pollIntervalMs <= 0) return undefined;
    const id = setInterval(() => {
      void fetchCanvas();
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [pollIntervalMs, fetchCanvas]);

  const summary = useMemo(() => buildSummary(state.bundle), [state.bundle]);

  const layout = useMemo(() => {
    const pruned = pruneByDepth(state.bundle.nodes, depth);
    const filtered = pruned.filter((n) => nodeMatchesFilter(n, filter));
    return layoutCanvas(filtered);
  }, [state.bundle.nodes, filter, depth]);

  const isFresh = !state.error;
  const isFixture = state.mode === 'fixture';

  return (
    <main className={styles.page}>
      {isFixture ? (
        <div className={styles.fixtureBanner} role="status">
          <strong>Demo data</strong>
          <span>
            — set <code>PAPERCLIP_API_KEY</code>
            {state.missingEnv && state.missingEnv.length > 1
              ? ` (and ${state.missingEnv.filter((v) => v !== 'PAPERCLIP_API_KEY').join(', ')})`
              : ''}{' '}
            to see your org.
          </span>
        </div>
      ) : null}

      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Org Canvas</h1>
          <div className={styles.pillRow} data-testid="topbar-pills">
            <Pill tone="info">{summary.runningAgents} running</Pill>
            {summary.overloadedAgents > 0 ? (
              <Pill tone="warn">{summary.overloadedAgents} overloaded</Pill>
            ) : null}
            <Pill tone={summary.pausedAgents > 0 ? 'warn' : 'neutral'}>
              {summary.pausedAgents} paused
            </Pill>
            {summary.budgetAttentionAgents > 0 ? (
              <Pill tone="warn">{summary.budgetAttentionAgents} budget ≥80%</Pill>
            ) : null}
          </div>
        </div>
        <div className={styles.controls}>
          <span className={styles.updatedLabel}>
            <span
              className={`${styles.freshDot} ${isFresh ? styles.freshDotOn : styles.freshDotOff}`}
              aria-hidden
            />
            Updated{' '}
            {new Date(state.bundle.generatedAt).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit'
            })}
          </span>
          <button
            type="button"
            className={`${styles.refreshButton} ${
              state.error ? styles.refreshPrimary : styles.refreshGhost
            }`}
            onClick={() => void fetchCanvas()}
            disabled={state.isFetching}
          >
            {state.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {state.error ? <div className={styles.errorBanner}>{state.error}</div> : null}

      <div className={styles.body}>
        <aside className={styles.leftRail} aria-label="Canvas controls">
          <section className={styles.railSection}>
            <h2 className={styles.railHeading}>Summary</h2>
            <dl className={styles.summaryGrid}>
              <SummaryStat label="Agents" value={summary.totalAgents} />
              <SummaryStat label="Running" value={summary.runningAgents} />
              <SummaryStat
                label="Overloaded"
                value={summary.overloadedAgents}
                tone={summary.overloadedAgents > 0 ? 'warn' : undefined}
              />
              <SummaryStat label="Open issues" value={summary.openIssues} tone="muted" />
            </dl>
          </section>

          <section className={styles.railSection}>
            <h2 className={styles.railHeading}>View</h2>
            <div className={styles.chipRow}>
              <Chip active label="Tree" />
              <Chip ghost label="List" />
            </div>
          </section>

          <section className={styles.railSection}>
            <h2 className={styles.railHeading}>Filter</h2>
            <div className={styles.chipRow}>
              {FILTER_OPTIONS.map((f) => (
                <Chip
                  key={f.key}
                  active={filter === f.key}
                  label={f.label}
                  onClick={() => setFilter(f.key)}
                />
              ))}
            </div>
          </section>

          <section className={styles.railSection}>
            <h2 className={styles.railHeading}>Depth</h2>
            <div className={styles.chipRow}>
              {DEPTH_OPTIONS.map((d) => (
                <Chip
                  key={d}
                  active={depth === d}
                  label={d === 'all' ? 'All' : d}
                  onClick={() => setDepth(d)}
                />
              ))}
            </div>
          </section>
        </aside>

        <div className={styles.graphCol}>
          <CanvasGraph layout={layout} />
          <footer className={styles.legend}>
            <LegendDot tone="running" label="running" />
            <LegendDot tone="idle" label="idle" />
            <LegendDot tone="paused" label="paused" />
            <LegendDot tone="error" label="error" />
            <LegendDot tone="attention" label="budget attention (≥80%)" />
            <LegendDot tone="overloaded" label="overloaded" />
          </footer>
        </div>
      </div>
    </main>
  );
}

function Pill({
  tone,
  children
}: {
  tone: 'info' | 'warn' | 'critical' | 'neutral';
  children: React.ReactNode;
}) {
  return <span className={`${styles.pill} ${styles[`pill_${tone}`]}`}>{children}</span>;
}

function Chip({
  active = false,
  ghost = false,
  label,
  onClick
}: {
  active?: boolean;
  ghost?: boolean;
  label: string;
  onClick?: () => void;
}) {
  const cls = [styles.chip, active ? styles.chipActive : null, ghost ? styles.chipGhost : null]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} onClick={onClick} disabled={ghost} aria-pressed={active}>
      {label}
    </button>
  );
}

function SummaryStat({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone?: 'warn' | 'muted';
}) {
  const valueClass = [
    styles.summaryValue,
    tone === 'warn' ? styles.summaryValueWarn : null,
    tone === 'muted' ? styles.summaryValueMuted : null
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={styles.summaryStat}>
      <span className={valueClass}>{value}</span>
      <span className={styles.summaryLabel}>{label}</span>
    </div>
  );
}

function LegendDot({ tone, label }: { tone: string; label: string }) {
  return (
    <span className={styles.legendItem}>
      <span className={`${styles.legendDot} ${styles[`dot_${tone}`]}`} aria-hidden />
      {label}
    </span>
  );
}
