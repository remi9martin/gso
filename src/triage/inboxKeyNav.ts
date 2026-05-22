// Pure keyboard-nav logic for the Triage Inbox — testable without React or DOM.

/** True when the event target is an interactive form element that captures keystrokes. */
export function isFormTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  // isContentEditable is not reliably implemented in jsdom; use the DOMString property.
  if (target.contentEditable === 'true') return true;
  return false;
}

export interface InboxNavState {
  focusedIdx: number;
  showHelp: boolean;
}

export const INITIAL_INBOX_NAV_STATE: InboxNavState = {
  focusedIdx: 0,
  showHelp: false,
};

export type InboxNavSideEffect =
  | { kind: 'approve'; idx: number }
  | { kind: 'reject'; idx: number }
  | { kind: 'open'; idx: number };

export interface InboxKeyResult {
  nextState: InboxNavState;
  sideEffect: InboxNavSideEffect | null;
}

/**
 * Pure key → (next-state, optional side-effect) transition.
 * Returns the same `state` reference when nothing changes (safe for React equality checks).
 */
export function inboxKeyPress(
  key: string,
  state: InboxNavState,
  count: number
): InboxKeyResult {
  if (count === 0) return { nextState: state, sideEffect: null };

  switch (key) {
    case 'j':
      if (state.focusedIdx >= count - 1) return { nextState: state, sideEffect: null };
      return { nextState: { ...state, focusedIdx: state.focusedIdx + 1 }, sideEffect: null };

    case 'k':
      if (state.focusedIdx <= 0) return { nextState: state, sideEffect: null };
      return { nextState: { ...state, focusedIdx: state.focusedIdx - 1 }, sideEffect: null };

    case 'a':
      return { nextState: state, sideEffect: { kind: 'approve', idx: state.focusedIdx } };

    case 'r':
      return { nextState: state, sideEffect: { kind: 'reject', idx: state.focusedIdx } };

    case 'e':
      return { nextState: state, sideEffect: { kind: 'open', idx: state.focusedIdx } };

    case '?':
      return { nextState: { ...state, showHelp: !state.showHelp }, sideEffect: null };

    case 'Escape':
      if (!state.showHelp) return { nextState: state, sideEffect: null };
      return { nextState: { ...state, showHelp: false }, sideEffect: null };

    default:
      return { nextState: state, sideEffect: null };
  }
}
