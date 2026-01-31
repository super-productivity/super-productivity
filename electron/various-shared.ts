import { app, BrowserWindow } from 'electron';
import { info } from 'electron-log/main';
import { getWin, getWasMaximizedBeforeHide } from './main-window';
import { hideOverlayWindow } from './overlay-indicator/overlay-indicator';
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

  if (win.isVisible()) {
    win.focus();
  } else {
    // restore explicitly
    if (win.isMinimized()) win.restore();
    win.show();
    if (getWasMaximizedBeforeHide()) win.maximize();
  }

  // Hide overlay when main window is shown
  hideOverlayWindow();

  // focus window afterwards always
  setTimeout(() => {
    win.focus();
  }, 60);
}
