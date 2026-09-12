import { error } from 'electron-log/main';
import { saveSimpleStore } from './simple-store';
import { SimpleStoreKey } from './shared-with-frontend/simple-store.const';

// Whether the main window should come back maximized — both when re-shown from
// the tray within a session and when the app is relaunched (#7276).
//
// Why we track this ourselves instead of asking BrowserWindow: isMaximized() is
// unreliable exactly at the moments we need it. Measured on X11, a minimized
// window reports false; on Wayland hide() destroys the xdg_toplevel, so the
// window comes back un-maximized. Any value read at hide/minimize/quit time can
// therefore be stale. Only maximize/unmaximize transitions on an on-screen
// window are trustworthy, so those are the sole writers.
let isMaximizedTracked = false;

export const getWasMaximizedBeforeHide = (): boolean => isMaximizedTracked;

export const setWasMaximizedBeforeHide = (value: boolean): void => {
  if (value === isMaximizedTracked) {
    return;
  }
  isMaximizedTracked = value;
  // Fire-and-forget: a write lost to a crash only means the next launch opens
  // un-maximized, which is exactly the pre-fix behaviour.
  saveSimpleStore(SimpleStoreKey.WINDOW_WAS_MAXIMIZED, value).catch((e) =>
    error('Failed to persist maximized window state:', e),
  );
};

/**
 * Seed the tracked value from the persisted store on startup, without writing
 * it straight back to disk.
 */
export const initWasMaximizedBeforeHide = (value: boolean): void => {
  isMaximizedTracked = value;
};

/**
 * Is an `unmaximize` event a real un-maximize by the user?
 *
 * hide() and minimize() also emit `unmaximize` on some platforms even though the
 * user never un-maximized anything — measured on X11, where minimizing a
 * maximized window emits it with isMinimized() already true. Acting on those
 * would drop the flag we are trying to preserve across the hide (#7276).
 */
export const isUserUnmaximize = ({
  isVisible,
  isMinimized,
}: {
  isVisible: boolean;
  isMinimized: boolean;
}): boolean => isVisible && !isMinimized;
