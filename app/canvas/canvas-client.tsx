'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { layoutCanvas, type CanvasLayout } from '@/lib/canvas/layout';
import {
  arrowKeyToTreeDirection,
  resolveTreeNavigation,
  type OrgDrawerSlot
} from '@/lib/canvas/drawer';
import type { CanvasBundle, CanvasNode } from '@/lib/canvas/types';

import { CanvasGraph } from './canvas-graph';
import { OrgCanvasDrawer } from './canvas-drawer';
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

  const [slot, setSlot] = useState<OrgDrawerSlot | null>(null);
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(
    initialLayout.nodes[0]?.node.org.agentId ?? null
  );
  const triggeringAgentIdRef = useRef<string | null>(null);
  const graphContainerRef = useRef<HTMLDivElement | null>(null);

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

  // Keep focusedAgentId valid as the bundle updates.
  useEffect(() => {
    if (state.layout.nodes.length === 0) {
      setFocusedAgentId(null);
      return;
    }
    setFocusedAgentId((prev) => {
      if (prev && state.layout.nodes.some((n) => n.node.org.agentId === prev)) return prev;
      return state.layout.nodes[0].node.org.agentId;
    });
  }, [state.layout]);

  const nodesByAgentId = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of state.bundle.nodes) m.set(n.org.agentId, n);
    return m;
  }, [state.bundle]);

  const summary = useMemo(() => buildSummary(state.bundle), [state.bundle]);

  const focusCardElement = useCallback((agentId: string) => {
    const container = graphContainerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLDivElement>(`[data-agent-id="${cssEscape(agentId)}"]`);
    el?.focus();
  }, []);

  const handleSelect = useCallback((agentId: string) => {
    triggeringAgentIdRef.current = agentId;
    setFocusedAgentId(agentId);
    setSlot({ kind: 'agent-detail', agentId });
  }, []);

  const handleFocusAgent = useCallback((agentId: string) => {
    setFocusedAgentId(agentId);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    const returnTo = triggeringAgentIdRef.current;
    setSlot(null);
    if (returnTo) {
      // Defer focus so the drawer fully unmounts first.
      window.requestAnimationFrame(() => focusCardElement(returnTo));
    }
  }, [focusCardElement]);

  const handleCardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, agentId: string) => {
      const dir = arrowKeyToTreeDirection(event.key);
      if (dir) {
        event.preventDefault();
        const result = resolveTreeNavigation(state.layout, agentId, dir);
        if (result.moved) {
          setFocusedAgentId(result.agentId);
          focusCardElement(result.agentId);
        }
        return;
      }
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        handleSelect(agentId);
        return;
      }
      if (event.key === 'Escape' && slot) {
        event.preventDefault();
        handleCloseDrawer();
      }
    },
    [state.layout, focusCardElement, handleSelect, handleCloseDrawer, slot]
  );

  // Global Esc handler when focus is inside the drawer.
  useEffect(() => {
    if (!slot) return undefined;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseDrawer();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [slot, handleCloseDrawer]);

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
      <div
        className={`${styles.canvasShell} ${slot ? styles.canvasShell_drawerOpen : ''}`}
        ref={graphContainerRef}
      >
        <div className={styles.canvasMain}>
          <CanvasGraph
            layout={state.layout}
            focusedAgentId={focusedAgentId}
            selectedAgentId={slot?.kind === 'agent-detail' ? slot.agentId : null}
            onSelectAgent={handleSelect}
            onFocusAgent={handleFocusAgent}
            onCardKeyDown={handleCardKeyDown}
          />
        </div>
        <OrgCanvasDrawer slot={slot} nodesByAgentId={nodesByAgentId} onClose={handleCloseDrawer} />
      </div>
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

function cssEscape(value: string): string {
  if (typeof window !== 'undefined' && typeof window.CSS?.escape === 'function') {
    return window.CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}
