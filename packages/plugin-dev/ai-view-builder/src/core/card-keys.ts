import type { CardAction } from './task-actions';

// The keys of a focused card, as Super Productivity's task shortcuts default to
// them (the plugin cannot read remapped keys). Alt+Left and Alt+Right stay with
// the board's move between columns.

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type KeyCommand =
  | { type: 'action'; action: CardAction }
  | { type: 'menu'; view: 'main' | 'tags' | 'project' }
  | { type: 'focus'; direction: -1 | 1 }
  | { type: 'collapse'; collapsed: boolean }
  | { type: 'release' };

const LETTERS: Record<string, KeyCommand> = {
  d: { type: 'action', action: 'toggleDone' },
  y: { type: 'action', action: 'toggleTrack' },
  i: { type: 'action', action: 'open' },
  t: { type: 'action', action: 'editEstimate' },
  a: { type: 'action', action: 'addSubTask' },
  e: { type: 'menu', view: 'project' },
  g: { type: 'menu', view: 'tags' },
  q: { type: 'menu', view: 'main' },
  k: { type: 'focus', direction: -1 },
  j: { type: 'focus', direction: 1 },
};

const bare = (e: KeyInput): boolean => !e.ctrlKey && !e.metaKey && !e.altKey;

/** The command a key press means on a focused card, or null when it means none. */
export const commandForKey = (e: KeyInput): KeyCommand | null => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === 'Enter') {
    return { type: 'action', action: 'addSubTask' };
  }
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    return { type: 'menu', view: 'main' };
  }
  if (!bare(e)) return null;
  switch (e.key) {
    case 'Enter':
      return e.shiftKey ? null : { type: 'action', action: 'editTitle' };
    case 'Backspace':
      return { type: 'action', action: 'delete' };
    case 'ArrowUp':
      return { type: 'focus', direction: -1 };
    case 'ArrowDown':
      return { type: 'focus', direction: 1 };
    case 'ArrowLeft':
      return { type: 'collapse', collapsed: true };
    case 'ArrowRight':
      return { type: 'collapse', collapsed: false };
    case 'Escape':
      return { type: 'release' };
    default:
      return e.shiftKey ? null : (LETTERS[e.key.toLowerCase()] ?? null);
  }
};
