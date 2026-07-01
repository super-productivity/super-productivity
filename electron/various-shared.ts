import { app, BrowserWindow } from 'electron';
import { info } from 'electron-log/main';
import {
  getWin,
  getWasMaximizedBeforeHide,
  setWasMaximizedBeforeHide,
} from './main-window';
import {
  getIsTaskWidgetAlwaysShow,
  getIsTaskWidgetUserForcedVisible,
  hideTaskWidget,
} from './task-widget/task-widget';
import { getIsMinimizeToTray, setIsQuiting } from './shared-state';
import { ensureIndicator } from './indicator';
import { IS_MAC } from './common.const';

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function quitApp(): void {
  setIsQuiting(true);
  app.quit();
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function showOrFocus(passedWin: BrowserWindow): void {
  // default to main winpc
  const win = passedWin || getWin();

  // sometimes when starting a second instance we get here although we don't want to
  if (!win) {
    info(
      'special case occurred when showOrFocus is called even though, this is a second instance of the app',
    );
    return;
  }

  if (win.isVisible()) {
    win.focus();
  } else {
    // restore explicitly - always call restore() before show()
    // On Linux, event.preventDefault() on the minimize event has no effect, so the
    // window may be minimized. On some desktop environments (e.g. GNOME/Wayland),
    // isMinimized() returns false for a hidden+minimized window, so calling restore()
    // only when isMinimized() is true would skip it and leave show() to fail alone.
    win.restore();
    win.show();
    if (getWasMaximizedBeforeHide()) win.maximize();
  }

  // Hide task widget when main window is shown, unless the user explicitly
  // pinned it visible via the global shortcut.
  if (!getIsTaskWidgetAlwaysShow() && !getIsTaskWidgetUserForcedVisible()) {
    hideTaskWidget();
  }

  // focus window afterwards always
  setTimeout(() => {
    if (win.isDestroyed()) return;
    win.focus();
    // Ensure Chromium renderer also gets keyboard focus (electron#20464)
    if (!win.webContents.isDestroyed()) {
      win.webContents.focus();
    }
  }, 60);
}

// One physical key press can fire this action several times in a row: Electron's
// globalShortcut auto-repeats while the key is held (X11 XGrabKey), and a held compositor
// key bound to `xdg-open superproductivity://toggle-visibility` spawns repeated launches.
// Without a guard the burst hides the window and immediately re-shows it — the #7114
// flicker. We debounce in BOTH directions (a repeat must never undo the first event's
// toggle) with a sliding quiet-gap: every event — even a swallowed one — extends the
// window, so a held key settles on a single toggle instead of oscillating. The gap has to
// exceed the OS/compositor auto-repeat *initial* delay (commonly 250–660 ms) or the first
// repeat slips through and flickers again; 750 ms covers typical setups while keeping a
// deliberate later re-press responsive.
const TOGGLE_VISIBILITY_REPEAT_GAP_MS = 750;
let lastToggleVisibilityEvent = 0;

/**
 * Show the window if it is hidden/unfocused, otherwise hide it. Shared by the
 * `globalShowHide` global shortcut and the `superproductivity://toggle-visibility`
 * protocol action so both entry points behave identically.
 */
// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function toggleWindowVisibility(passedWin: BrowserWindow): void {
  const win = passedWin || getWin();
  if (!win) {
    return;
  }

  const now = Date.now();
  const sinceLastMs = now - lastToggleVisibilityEvent;
  // Update on every event (even swallowed ones) so a held key keeps the gap alive.
  lastToggleVisibilityEvent = now;
  if (sinceLastMs < TOGGLE_VISIBILITY_REPEAT_GAP_MS) {
    return;
  }

  if (!win.isFocused()) {
    showOrFocus(win);
    return;
  }

  // Hide strategy differs by platform:
  // - macOS: the dock icon always remains after hide(), so the window stays reachable
  //   without any tray. Match the native Cmd+H gesture users expect from "show/hide".
  // - Windows/Linux: hide() removes the taskbar entry. Without a visible tray icon the
  //   window becomes unreachable (#7282). Only hide to tray when minimize-to-tray is
  //   enabled AND the tray was successfully (re)created; otherwise minimize so a taskbar
  //   handle remains as a safety net. blur() is a Windows focus workaround (electron#20464)
  //   and a no-op elsewhere.
  setWasMaximizedBeforeHide(win.isMaximized());
  if (IS_MAC) {
    win.hide();
  } else if (getIsMinimizeToTray() && ensureIndicator()) {
    win.blur();
    win.hide();
  } else {
    win.minimize();
  }
}
