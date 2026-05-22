import { describe, expect, it } from 'vitest';

import {
  INITIAL_INBOX_NAV_STATE,
  inboxKeyPress,
  isFormTarget,
} from '@/src/triage/inboxKeyNav';
import type { InboxNavState } from '@/src/triage/inboxKeyNav';

// ---------------------------------------------------------------------------
// isFormTarget

describe('isFormTarget', () => {
  it('returns false for null', () => {
    expect(isFormTarget(null)).toBe(false);
  });

  it('returns false for a plain div', () => {
    const el = document.createElement('div');
    expect(isFormTarget(el)).toBe(false);
  });

  it('returns true for <input>', () => {
    const el = document.createElement('input');
    expect(isFormTarget(el)).toBe(true);
  });

  it('returns true for <textarea>', () => {
    const el = document.createElement('textarea');
    expect(isFormTarget(el)).toBe(true);
  });

  it('returns true for <select>', () => {
    const el = document.createElement('select');
    expect(isFormTarget(el)).toBe(true);
  });

  it('returns true for a contenteditable element', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    expect(isFormTarget(el)).toBe(true);
  });

  it('returns false for a button', () => {
    const el = document.createElement('button');
    expect(isFormTarget(el)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// inboxKeyPress — navigation

describe('inboxKeyPress navigation', () => {
  const base: InboxNavState = { focusedIdx: 2, showHelp: false };

  it('j moves forward', () => {
    const { nextState, sideEffect } = inboxKeyPress('j', base, 5);
    expect(nextState.focusedIdx).toBe(3);
    expect(sideEffect).toBeNull();
  });

  it('k moves backward', () => {
    const { nextState, sideEffect } = inboxKeyPress('k', base, 5);
    expect(nextState.focusedIdx).toBe(1);
    expect(sideEffect).toBeNull();
  });

  it('j clamps at last index', () => {
    const { nextState } = inboxKeyPress('j', { ...base, focusedIdx: 4 }, 5);
    expect(nextState.focusedIdx).toBe(4);
  });

  it('k clamps at 0', () => {
    const { nextState } = inboxKeyPress('k', { ...base, focusedIdx: 0 }, 5);
    expect(nextState.focusedIdx).toBe(0);
  });

  it('j returns same state reference when already at end', () => {
    const state = { focusedIdx: 4, showHelp: false };
    const { nextState } = inboxKeyPress('j', state, 5);
    expect(nextState).toBe(state);
  });

  it('k returns same state reference when already at start', () => {
    const state = { focusedIdx: 0, showHelp: false };
    const { nextState } = inboxKeyPress('k', state, 5);
    expect(nextState).toBe(state);
  });

  it('unknown key returns same state reference', () => {
    const { nextState, sideEffect } = inboxKeyPress('z', base, 5);
    expect(nextState).toBe(base);
    expect(sideEffect).toBeNull();
  });

  it('no action when count is 0', () => {
    const { nextState, sideEffect } = inboxKeyPress('j', INITIAL_INBOX_NAV_STATE, 0);
    expect(nextState).toBe(INITIAL_INBOX_NAV_STATE);
    expect(sideEffect).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// inboxKeyPress — side effects (a / r / e)

describe('inboxKeyPress side effects', () => {
  const base: InboxNavState = { focusedIdx: 1, showHelp: false };

  it('a emits approve with current focusedIdx', () => {
    const { nextState, sideEffect } = inboxKeyPress('a', base, 5);
    expect(nextState).toBe(base);
    expect(sideEffect).toEqual({ kind: 'approve', idx: 1 });
  });

  it('r emits reject with current focusedIdx', () => {
    const { sideEffect } = inboxKeyPress('r', base, 5);
    expect(sideEffect).toEqual({ kind: 'reject', idx: 1 });
  });

  it('e emits open with current focusedIdx', () => {
    const { sideEffect } = inboxKeyPress('e', base, 5);
    expect(sideEffect).toEqual({ kind: 'open', idx: 1 });
  });

  it('a / r / e do not modify state', () => {
    for (const key of ['a', 'r', 'e']) {
      const { nextState } = inboxKeyPress(key, base, 5);
      expect(nextState).toBe(base);
    }
  });
});

// ---------------------------------------------------------------------------
// inboxKeyPress — help overlay (? / Escape)

describe('inboxKeyPress help overlay', () => {
  it('? toggles showHelp on', () => {
    const { nextState } = inboxKeyPress('?', INITIAL_INBOX_NAV_STATE, 3);
    expect(nextState.showHelp).toBe(true);
  });

  it('? toggles showHelp off', () => {
    const { nextState } = inboxKeyPress('?', { focusedIdx: 0, showHelp: true }, 3);
    expect(nextState.showHelp).toBe(false);
  });

  it('Escape closes help', () => {
    const { nextState } = inboxKeyPress('Escape', { focusedIdx: 0, showHelp: true }, 3);
    expect(nextState.showHelp).toBe(false);
  });

  it('Escape returns same state when help is already closed', () => {
    const state = { focusedIdx: 0, showHelp: false };
    const { nextState } = inboxKeyPress('Escape', state, 3);
    expect(nextState).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// isFormTarget — focus-check gates keyboard nav

describe('focus-check integration', () => {
  it('keypress on input target is blocked by isFormTarget', () => {
    const input = document.createElement('input');
    // Simulated handler: skip if isFormTarget
    const dispatched: string[] = [];
    const handle = (key: string, target: EventTarget) => {
      if (isFormTarget(target)) return;
      dispatched.push(key);
    };

    handle('j', input);
    handle('j', document.createElement('div'));

    expect(dispatched).toEqual(['j']);
  });
});
