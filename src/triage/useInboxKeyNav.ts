'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { INITIAL_INBOX_NAV_STATE, inboxKeyPress, isFormTarget } from './inboxKeyNav';
import type { InboxNavState } from './inboxKeyNav';

export interface UseInboxKeyNavOptions {
  count: number;
  onApprove: (idx: number) => void;
  onReject: (idx: number) => void;
  onOpen: (idx: number) => void;
}

export interface UseInboxKeyNavResult extends InboxNavState {
  setFocusedIdx: (idx: number) => void;
  setShowHelp: (show: boolean) => void;
}

export function useInboxKeyNav({
  count,
  onApprove,
  onReject,
  onOpen,
}: UseInboxKeyNavOptions): UseInboxKeyNavResult {
  const [state, setState] = useState<InboxNavState>(INITIAL_INBOX_NAV_STATE);

  // Refs so handleKey never needs to re-register on prop changes.
  const stateRef = useRef(state);
  stateRef.current = state;
  const countRef = useRef(count);
  countRef.current = count;
  const cbRef = useRef({ onApprove, onReject, onOpen });
  cbRef.current = { onApprove, onReject, onOpen };

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (isFormTarget(e.target)) return;

    const { nextState, sideEffect } = inboxKeyPress(e.key, stateRef.current, countRef.current);

    if (nextState !== stateRef.current) {
      e.preventDefault();
      setState(nextState);
    }

    if (sideEffect) {
      e.preventDefault();
      const { onApprove, onReject, onOpen } = cbRef.current;
      if (sideEffect.kind === 'approve') onApprove(sideEffect.idx);
      else if (sideEffect.kind === 'reject') onReject(sideEffect.idx);
      else if (sideEffect.kind === 'open') onOpen(sideEffect.idx);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  return {
    ...state,
    setFocusedIdx: (idx: number) => setState((s) => ({ ...s, focusedIdx: idx })),
    setShowHelp: (show: boolean) => setState((s) => ({ ...s, showHelp: show })),
  };
}
