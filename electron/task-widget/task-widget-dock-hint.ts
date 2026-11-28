import { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { join } from 'path';
import { assertSecureWebPreferences } from '../web-preferences-guard';
import { TaskWidgetDockPreview, WidgetRect } from './task-widget-layout';

export interface TaskWidgetDockHint {
  update: (preview: TaskWidgetDockPreview, bounds: WidgetRect) => void;
  destroy: () => void;
}

/**
 * The glow on the screen edge that reaches for the widget while it is dragged
 * close. It has to be its own window, since the widget cannot draw outside its
 * bounds or resize during a drag. It only exists for the length of a drag.
 */
export const createTaskWidgetDockHint = (
  getAccent: () => string,
  onShown: () => void,
): TaskWidgetDockHint => {
  let hintWin: BrowserWindow | null = null;
  let latest: (TaskWidgetDockPreview & { accent: string }) | null = null;

  const send = (): void => {
    hintWin?.webContents.send('update-dock-hint', latest);
  };

  const create = (bounds: WidgetRect): BrowserWindow => {
    const webPreferences: BrowserWindowConstructorOptions['webPreferences'] = {
      preload: join(__dirname, 'task-widget-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      disableDialogs: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    };
    assertSecureWebPreferences(webPreferences, 'task-widget-dock-hint');

    const win = new BrowserWindow({
      ...bounds,
      title: 'Super Productivity Task Widget Dock Hint',
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      webPreferences,
    });
    win.setIgnoreMouseEvents(true);
    win.webContents.on('did-finish-load', () => {
      send();
      win.showInactive();
      // The hint belongs behind the widget, so the time stays readable and the
      // widget looks like it plugs into it.
      onShown();
    });
    win.loadFile(join(__dirname, 'task-widget-dock-hint.html'));
    return win;
  };

  return {
    update: (preview, bounds) => {
      latest = { ...preview, accent: getAccent() };
      if (hintWin) {
        hintWin.setBounds(bounds);
        send();
      } else {
        hintWin = create(bounds);
      }
    },
    destroy: () => {
      if (hintWin && !hintWin.isDestroyed()) {
        hintWin.destroy();
      }
      hintWin = null;
    },
  };
};
