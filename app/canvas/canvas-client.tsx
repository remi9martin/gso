'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { layoutCanvas, type CanvasLayout } from '@/lib/canvas/layout';
import type { CanvasBundle } from '@/lib/canvas/types';
import {
  applyOptimisticReassign,
  toReassignResult,
  type ReassignApiResponse,
  type ReassignResult
} from '@/lib/canvas/drag-reassign';

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

interface UndoState {
  result: ReassignResult;
  sourceAgentName: string;
  targetAgentName: string;
  expiresAt: number;
}

const UNDO_DURATION_MS = 10_000;

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

  const [undo, setUndo] = useState<UndoState | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Snapshot before any optimistic update so we can revert on undo
  const preReassignBundleRef = useRef<CanvasBundle | null>(null);

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

  const handleReassign = useCallback(
    async (sourceAgentId: string, targetAgentId: string) => {
      const currentBundle = state.bundle;
      const sourceNode = currentBundle.nodes.find((n) => n.org.agentId === sourceAgentId);
      const targetNode = currentBundle.nodes.find((n) => n.org.agentId === targetAgentId);
      if (!sourceNode || !targetNode) return;
      if (sourceNode.workload.openCount === 0) return;

      // Snapshot for potential undo revert
      preReassignBundleRef.current = currentBundle;

      // Optimistic update
      const optimisticBundle = applyOptimisticReassign(currentBundle, sourceAgentId, targetAgentId);
      const optimisticLayout = layoutCanvas(optimisticBundle.nodes);
      setState((prev) => ({
        ...prev,
        bundle: optimisticBundle,
        layout: optimisticLayout,
        error: null
      }));

      try {
        const res = await fetch(`/api/agents/${targetAgentId}/take-issues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceAgentId })
        });

        if (!res.ok) {
          // Revert optimistic update
          const pre = preReassignBundleRef.current;
          if (pre) {
            setState((prev) => ({
              ...prev,
              bundle: pre,
              layout: layoutCanvas(pre.nodes),
              error: `Reassignment failed: ${res.status}`
            }));
          }
          return;
        }

        const data = (await res.json()) as ReassignApiResponse;
        const result = toReassignResult(data, sourceAgentId, targetAgentId);

        if (result.issueIds.length === 0) {
          // Nothing moved — revert silently
          const pre = preReassignBundleRef.current;
          if (pre) {
            setState((prev) => ({ ...prev, bundle: pre, layout: layoutCanvas(pre.nodes) }));
          }
          return;
        }

        // Start undo window
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        setUndo({
          result,
          sourceAgentName: sourceNode.org.displayName,
          targetAgentName: targetNode.org.displayName,
          expiresAt: Date.now() + UNDO_DURATION_MS
        });
        undoTimerRef.current = setTimeout(() => {
          setUndo(null);
          preReassignBundleRef.current = null;
        }, UNDO_DURATION_MS);
      } catch (err) {
        const pre = preReassignBundleRef.current;
        if (pre) {
          setState((prev) => ({
            ...prev,
            bundle: pre,
            layout: layoutCanvas(pre.nodes),
            error: err instanceof Error ? err.message : 'Reassignment failed'
          }));
        }
      }
    },
    [state.bundle]
  );

  const handleUndo = useCallback(async () => {
    if (!undo) return;

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndo(null);

    // Revert to pre-reassign state optimistically
    const pre = preReassignBundleRef.current;
    if (pre) {
      setState((prev) => ({ ...prev, bundle: pre, layout: layoutCanvas(pre.nodes), error: null }));
      preReassignBundleRef.current = null;
    }

    try {
      await fetch(`/api/agents/${undo.result.sourceAgentId}/take-issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceAgentId: undo.result.targetAgentId,
          issueIds: undo.result.issueIds
        })
      });
      // Refresh to reconcile
      void fetchCanvas();
    } catch {
      void fetchCanvas();
    }
  }, [undo, fetchCanvas]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

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
      <CanvasGraph layout={state.layout} onReassign={(s, t) => void handleReassign(s, t)} />
      {undo ? (
        <UndoBanner
          sourceAgentName={undo.sourceAgentName}
          targetAgentName={undo.targetAgentName}
          issueCount={undo.result.issueIds.length}
          expiresAt={undo.expiresAt}
          onUndo={() => void handleUndo()}
          onDismiss={() => {
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
            setUndo(null);
            preReassignBundleRef.current = null;
          }}
        />
      ) : null}
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

interface UndoBannerProps {
  sourceAgentName: string;
  targetAgentName: string;
  issueCount: number;
  expiresAt: number;
  onUndo: () => void;
  onDismiss: () => void;
}

function UndoBanner({
  sourceAgentName,
  targetAgentName,
  issueCount,
  expiresAt,
  onUndo,
  onDismiss
}: UndoBannerProps) {
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()));

  useEffect(() => {
    const id = setInterval(() => {
      const rem = Math.max(0, expiresAt - Date.now());
      setRemaining(rem);
      if (rem === 0) clearInterval(id);
    }, 200);
    return () => clearInterval(id);
  }, [expiresAt]);

  const secs = Math.ceil(remaining / 1000);

  return (
    <div className={styles.undoBanner} role="status" aria-live="polite">
      <span className={styles.undoMessage}>
        Moved{' '}
        <strong>
          {issueCount} issue{issueCount !== 1 ? 's' : ''}
        </strong>{' '}
        from <strong>{sourceAgentName}</strong> to <strong>{targetAgentName}</strong>
      </span>
      <div className={styles.undoActions}>
        <button type="button" className={styles.undoButton} onClick={onUndo}>
          Undo ({secs}s)
        </button>
        <button type="button" className={styles.undoDismiss} onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
    </div>
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
