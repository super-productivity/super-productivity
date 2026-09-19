import { error } from 'electron-log/main';
import { saveSimpleStore } from './simple-store';
import { SimpleStoreKey } from './shared-with-frontend/simple-store.const';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The size/position the main window should come back to when it is not
// maximized (#10058). electron-window-state owns the same bits and corrupts
// them in two independent ways, so we keep our own copy alongside the
// maximized flag in window-maximized-state.ts.
//
// 1. Its isNormal() is `!isMaximized && !isMinimized && !isFullScreen` — it
//    never asks whether the window is on screen. Where a hidden window reports
//    isMaximized() === false (Wayland destroys the xdg_toplevel on hide()), a
//    hidden-but-maximized window passes that test and the maximized bounds get
//    written into the restore bounds.
// 2. Bounds that do not fit entirely inside one display make it discard the
//    whole persisted state rather than move the window, so a window merely
//    overhanging a screen edge loses its size as well as its position.
let trackedBounds: WindowBounds | null = null;

export const getRestoreBounds = (): WindowBounds | null => trackedBounds;

// Integer rather than finite, matching the hasBounds() check in
// electron-window-state that this replaces. Everything the app stores comes
// from getBounds() and is integral, so a fractional value is corruption.
const isIntegerNumber = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n);

const isSameBounds = (a: WindowBounds | null, b: WindowBounds): boolean =>
  a !== null &&
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height;

export const setRestoreBounds = (bounds: WindowBounds): void => {
  if (isSameBounds(trackedBounds, bounds)) {
    return;
  }
  trackedBounds = bounds;
  // Fire-and-forget: a write lost to a crash only means the next launch uses
  // whatever electron-window-state kept, which is the pre-fix behaviour.
  saveSimpleStore(SimpleStoreKey.WINDOW_RESTORE_BOUNDS, bounds).catch((e) =>
    error('Failed to persist window restore bounds:', e),
  );
};

/**
 * Seed the tracked value from the persisted store on startup, without writing
 * it straight back to disk.
 */
export const initRestoreBounds = (bounds: WindowBounds | null): void => {
  trackedBounds = bounds;
};

/**
 * Are the window's current bounds worth recording as the restore bounds?
 *
 * isVisible is the test electron-window-state omits, and omitting it is
 * mechanism 1 above: off-screen windows cannot be trusted to report their own
 * maximized state, so nothing sampled while hidden may be stored.
 */
export const isSampleableBounds = ({
  isVisible,
  isMinimized,
  isMaximized,
  isFullScreen,
}: {
  isVisible: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  isFullScreen: boolean;
}): boolean => isVisible && !isMinimized && !isMaximized && !isFullScreen;

/**
 * Validate bounds read back from the persisted store.
 *
 * The store is JSON on disk that another process, an older version or a failed
 * write can leave in any shape, so nothing from it reaches setBounds() unchecked.
 */
export const parseStoredBounds = (value: unknown): WindowBounds | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { x, y, width, height } = value as Record<string, unknown>;
  if (
    !isIntegerNumber(x) ||
    !isIntegerNumber(y) ||
    !isIntegerNumber(width) ||
    !isIntegerNumber(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { x, y, width, height };
};

/**
 * Move out-of-bounds bounds onto a display instead of discarding them.
 *
 * This is the half of mechanism 2 we can fix for our own copy: an overhanging
 * window keeps the size the user chose and is nudged back on screen, where
 * electron-window-state would have thrown the size away with everything else.
 * A window larger than the work area is shrunk to fit it.
 */
export const clampBoundsToDisplay = (
  bounds: WindowBounds,
  workArea: WindowBounds,
): WindowBounds => {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, workArea.x), maxX),
    y: Math.min(Math.max(bounds.y, workArea.y), maxY),
  };
};
