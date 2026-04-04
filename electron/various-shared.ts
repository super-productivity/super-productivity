import { app, BrowserWindow } from 'electron';
import { info } from 'electron-log/main';
import { getWin, getWasMaximizedBeforeHide } from './main-window';
import { getIsTaskWidgetAlwaysShow, hideTaskWidget } from './task-widget/task-widget';
import { setIsQuiting } from './shared-state';

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

  // Restore first so the focus/raise path can operate on a normal window.
  if (win.isMinimized()) {
    win.restore();
  }

  if (!win.isVisible()) {
    win.show();
    if (getWasMaximizedBeforeHide()) win.maximize();
  } else {
    // Re-show and raise already-visible windows because focus() alone can fail to
    // bring the existing instance to the foreground on some Linux window managers.
    win.show();
    win.moveTop();
  }

  // Hide task widget when main window is shown
  if (!getIsTaskWidgetAlwaysShow()) {
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
