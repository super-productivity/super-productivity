import { error } from 'electron-log/main';
import { saveSimpleStore } from './simple-store';
import { SimpleStoreKey } from './shared-with-frontend/simple-store.const';

// Whether the main window should come back full screen, both when it is shown
// again and when the app is relaunched.
//
// electron-window-state saves isFullScreen() from the live window when it
// closes, so a window that is hidden or was never shown (`--start-minimized`)
// records false and the user's full screen is lost. Like the maximized bit
// (#7276, window-maximized-state.ts), only enter/leave transitions on an
// on-screen window are trusted, so those are the sole writers.
let isFullScreenTracked = false;

export const getWasFullScreen = (): boolean => isFullScreenTracked;

export const setWasFullScreen = (value: boolean): void => {
  if (value === isFullScreenTracked) {
    return;
  }
  isFullScreenTracked = value;
  // Fire-and-forget: a write lost to a crash only means the next launch opens
  // without full screen.
  saveSimpleStore(SimpleStoreKey.WINDOW_WAS_FULL_SCREEN, value).catch((e) =>
    error('Failed to persist full-screen window state:', e),
  );
};

/**
 * Seed the tracked value on startup. Only writes it when asked, for a value
 * adopted from electron-window-state that the store doesn't hold yet.
 */
export const initWasFullScreen = (
  value: boolean,
  { isPersist = false }: { isPersist?: boolean } = {},
): void => {
  isFullScreenTracked = value;
  if (isPersist) {
    saveSimpleStore(SimpleStoreKey.WINDOW_WAS_FULL_SCREEN, value).catch((e) =>
      error('Failed to persist full-screen window state:', e),
    );
  }
};
