'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { layoutCanvas, type CanvasLayout } from '@/lib/canvas/layout';
import type { CanvasBundle } from '@/lib/canvas/types';

import { CanvasGraph } from './canvas-graph';
import styles from './canvas.module.css';

interface CanvasClientProps {
  initialBundle: CanvasBundle;
  initialLayout: CanvasLayout;
  initialSource: 'hit' | 'miss';
  pollIntervalMs: number;
}

interface CanvasState {
  bundle: CanvasBundle;
  layout: CanvasLayout;
  source: 'hit' | 'miss' | 'client';
  fetchedAt: number;
  error: string | null;
  isFetching: boolean;
}

export function CanvasClient({
  initialBundle,
  initialLayout,
  initialSource,
  pollIntervalMs
}: CanvasClientProps) {
  const [state, setState] = useState<CanvasState>(() => ({
    bundle: initialBundle,
    layout: initialLayout,
    source: initialSource,
    fetchedAt: Date.now(),
    error: null,
    isFetching: false
  }));

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
      const layout = layoutCanvas(bundle.nodes);
      const source = (res.headers.get('X-GSO-Canvas-Cache') as 'hit' | 'miss' | null) ?? 'client';
      setState({
        bundle,
        layout,
        source,
        fetchedAt: Date.now(),
        error: null,
        isFetching: false
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

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Org Canvas</h1>
          <p className={styles.subtitle}>
            {summary.totalAgents} agents · {summary.runningAgents} running · {summary.pausedAgents}{' '}
            paused · {summary.openIssues} open issues
          </p>
        </div>
        <div className={styles.controls}>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Generated</span>
            <span className={styles.metaValue}>
              {new Date(state.bundle.generatedAt).toLocaleTimeString()}
            </span>
            <span className={`${styles.badge} ${styles[`source_${state.source}`]}`}>
              {state.source === 'hit' ? 'cache' : state.source === 'miss' ? 'fresh' : 'live'}
            </span>
          </div>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => void fetchCanvas()}
            disabled={state.isFetching}
          >
            {state.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>
      {state.error ? <div className={styles.errorBanner}>{state.error}</div> : null}
      <CanvasGraph layout={state.layout} />
      <footer className={styles.legend}>
        <LegendDot tone="running" label="running" />
        <LegendDot tone="idle" label="idle" />
        <LegendDot tone="paused" label="paused" />
        <LegendDot tone="error" label="error" />
        <LegendDot tone="attention" label="budget attention (≥80%)" />
        <LegendDot tone="overloaded" label="overloaded" />
      </footer>
    </main>
  );
}

interface CanvasSummary {
  totalAgents: number;
  runningAgents: number;
  pausedAgents: number;
  openIssues: number;
}

function buildSummary(bundle: CanvasBundle): CanvasSummary {
  let running = 0;
  let paused = 0;
  let openIssues = 0;
  for (const n of bundle.nodes) {
    if (n.org.runtimeStatus === 'running') running += 1;
    if (n.org.runtimeStatus === 'paused' || n.org.pausedAt) paused += 1;
    openIssues += n.workload.openCount;
  }
  return {
    totalAgents: bundle.nodes.length,
    runningAgents: running,
    pausedAgents: paused,
    openIssues
  };
}

function LegendDot({ tone, label }: { tone: string; label: string }) {
  return (
    <span className={styles.legendItem}>
      <span className={`${styles.legendDot} ${styles[`dot_${tone}`]}`} aria-hidden />
      {label}
    </span>
  );
}
