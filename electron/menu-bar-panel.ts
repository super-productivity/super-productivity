import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';
import { log } from 'electron-log/main';
import { assertSecureWebPreferences } from './web-preferences-guard';
import { IS_MAC } from './common.const';
import { IPC } from './shared-with-frontend/ipc-events.const';

/**
 * macOS menu bar panel.
 *
 * A small popover anchored under the tray icon, in the spirit of DropNote: the
 * app lives in the menu bar (no Dock icon, main window hidden on launch) and
 * Today's tasks are reachable in one click. The panel is a separate renderer
 * with its own tight preload bridge; it never loads the Angular app, so opening
 * it cannot steal a frame from the main window.
 *
 * Data is pushed from the existing indicator IPC listeners
 * (`CURRENT_TASK_UPDATED` / `TODAY_TASKS_UPDATED`), so no new renderer-side
 * state source is introduced.
 */

export const MENU_BAR_PANEL_WIDTH = 380;
export const MENU_BAR_PANEL_HEIGHT = 520;
const PANEL_GAP = 6;
const SCREEN_EDGE_PADDING = 8;
// Blur fires before the tray click that caused it on macOS. Delaying the hide
// lets the click handler cancel it and treat the press as a toggle, so clicking
// the tray icon while the panel is open closes it instead of flickering it.
const BLUR_HIDE_DELAY_MS = 200;

export interface MenuBarPanelTask {
  id: string;
  title: string;
  timeEstimate?: number;
  timeSpent?: number;
}

export interface MenuBarPanelState {
  todayTasks: MenuBarPanelTask[];
  currentTask: MenuBarPanelTask | null;
  isRunning: boolean;
  isFocusModeEnabled: boolean;
  focusSessionTime: number;
  focusModeMode?: string;
}

export interface MenuBarPanelBoundsOptions {
  trayBounds: Electron.Rectangle;
  workArea: Electron.Rectangle;
  width?: number;
  height?: number;
}

export interface MenuBarPanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type MenuBarPanelConfig = {
  showApp: () => void;
  getMainWindow: () => BrowserWindow | null;
  hideDock: boolean;
  /**
   * `--show-dock` / the screenshot pipeline need the Dock icon regardless of
   * what the renderer's persisted setting says, so they pin it for the launch.
   */
  lockDockVisible?: boolean;
};

type MenuBarPanelAction =
  | { type: 'toggleTask'; id: string }
  | { type: 'completeTask'; id: string }
  | { type: 'addTask'; title: string }
  | { type: 'showApp' }
  | { type: 'hide' };

const EMPTY_STATE: MenuBarPanelState = {
  todayTasks: [],
  currentTask: null,
  isRunning: false,
  isFocusModeEnabled: false,
  focusSessionTime: 0,
  focusModeMode: undefined,
};

let panelWin: BrowserWindow | null = null;
let panelConfig: MenuBarPanelConfig | null = null;
let panelState: MenuBarPanelState = { ...EMPTY_STATE };
let areListenersRegistered = false;
let isMenuBarOnly = false;
let isDockVisibilityLocked = false;
let blurHideTimer: NodeJS.Timeout | null = null;

/**
 * Centers the panel horizontally on the tray icon and drops it just below the
 * menu bar, clamped to the display's work area so a tray icon near an edge
 * cannot push the panel off screen.
 */
export const computeMenuBarPanelBounds = ({
  trayBounds,
  workArea,
  width = MENU_BAR_PANEL_WIDTH,
  height = MENU_BAR_PANEL_HEIGHT,
}: MenuBarPanelBoundsOptions): MenuBarPanelRect => {
  const centerOffset = (trayBounds.width - width) / 2;
  const centeredX =
    trayBounds.width > 0
      ? Math.round(trayBounds.x + centerOffset)
      : Math.round(workArea.x + workArea.width - width - SCREEN_EDGE_PADDING);

  const minX = workArea.x + SCREEN_EDGE_PADDING;
  const maxX = workArea.x + workArea.width - width - SCREEN_EDGE_PADDING;
  const x = maxX >= minX ? Math.min(Math.max(centeredX, minX), maxX) : workArea.x;

  const maxY = workArea.y + workArea.height - height - SCREEN_EDGE_PADDING;
  const preferredY = trayBounds.y + trayBounds.height + PANEL_GAP;
  const y = Math.max(workArea.y + SCREEN_EDGE_PADDING, Math.min(preferredY, maxY));

  return { x: Math.round(x), y: Math.round(y), width, height };
};

const resolvePanelBounds = (trayBounds?: Electron.Rectangle): MenuBarPanelRect => {
  const anchor = trayBounds ?? {
    x: screen.getPrimaryDisplay().workArea.x,
    y: 0,
    width: 0,
    height: 0,
  };
  const display = screen.getDisplayMatching(anchor);
  return computeMenuBarPanelBounds({
    trayBounds: anchor,
    workArea: display.workArea,
  });
};

export const initMenuBarPanel = ({
  showApp,
  getMainWindow,
  hideDock,
  lockDockVisible = false,
}: MenuBarPanelConfig): void => {
  if (!IS_MAC) {
    return;
  }

  panelConfig = { showApp, getMainWindow, hideDock, lockDockVisible };
  isDockVisibilityLocked = lockDockVisible;

  registerIpcListeners();
  // Apply the initial state even when locked; the lock only blocks later IPC
  // updates from the renderer.
  applyDockVisibility({ showDockIcon: !hideDock, isLocked: false });
};

/**
 * Applies menu-bar-only mode (Dock hidden, accessory activation) or the user's
 * opted-in mode (regular app, Dock icon + running dot). Safe to call repeatedly.
 */
const applyDockVisibility = ({
  showDockIcon,
  isLocked = isDockVisibilityLocked,
}: {
  showDockIcon: boolean;
  isLocked?: boolean;
}): void => {
  if (isLocked) {
    return;
  }

  isMenuBarOnly = !showDockIcon;

  // Accessory + hidden Dock is what makes this a menu bar app: no Dock icon,
  // no Cmd+Tab entry, but the tray icon stays reachable. The opt-in restores a
  // regular app so macOS draws the Dock icon and its running dot.
  try {
    app.setActivationPolicy?.(showDockIcon ? 'regular' : 'accessory');
  } catch (e) {
    log('Could not set the menu bar activation policy', e);
  }
  try {
    if (showDockIcon) {
      app.dock?.show();
    } else {
      app.dock?.hide();
    }
  } catch (e) {
    log('Could not change the Dock icon visibility', e);
  }
};

export const isMenuBarPanelAvailable = (): boolean => !!panelConfig;
export const getIsMenuBarOnly = (): boolean => isMenuBarOnly;

export const updateMenuBarPanel = (patch: Partial<MenuBarPanelState>): void => {
  panelState = { ...panelState, ...patch };
  sendStateToPanel();
};

export const toggleMenuBarPanel = (trayBounds?: Electron.Rectangle): boolean => {
  if (!panelConfig) {
    return false;
  }

  clearBlurHideTimer();

  const win = getOrCreatePanelWindow();
  if (win.isVisible()) {
    win.hide();
    return true;
  }

  win.setBounds(resolvePanelBounds(trayBounds));
  sendStateToPanel();
  // Accessory apps are not frontmost when the panel is opened from the menu
  // bar, and an unfocused text input would swallow typing. Activate first.
  try {
    app.focus({ steal: true });
  } catch (e) {
    log('Could not focus the app for the menu bar panel', e);
  }
  win.show();
  win.focus();
  return true;
};

export const hideMenuBarPanel = (): void => {
  clearBlurHideTimer();
  if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) {
    panelWin.hide();
  }
};

export const destroyMenuBarPanel = (): void => {
  clearBlurHideTimer();
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.destroy();
  }
  panelWin = null;
};

const getOrCreatePanelWindow = (): BrowserWindow => {
  if (panelWin && !panelWin.isDestroyed()) {
    return panelWin;
  }

  const webPreferences: Electron.BrowserWindowConstructorOptions['webPreferences'] = {
    preload: join(__dirname, 'menu-bar-panel-preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    disableDialogs: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    backgroundThrottling: false,
    spellcheck: false,
  };
  assertSecureWebPreferences(webPreferences, 'menu-bar-panel');

  const bounds = resolvePanelBounds();
  panelWin = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    backgroundColor: '#00000000',
    title: 'Super Productivity',
    // Native popover material behind the translucent CSS surface.
    vibrancy: 'popover',
    visualEffectState: 'active',
    webPreferences,
  });

  panelWin.loadFile(join(__dirname, 'menu-bar-panel.html'));

  panelWin.webContents.on('did-finish-load', () => sendStateToPanel());

  panelWin.on('blur', () => {
    if (!panelWin || panelWin.isDestroyed() || !panelWin.isVisible()) {
      return;
    }
    if (panelWin.webContents.isDevToolsOpened()) {
      return;
    }
    clearBlurHideTimer();
    blurHideTimer = setTimeout(() => {
      if (panelWin && !panelWin.isDestroyed() && !panelWin.isFocused()) {
        panelWin.hide();
      }
    }, BLUR_HIDE_DELAY_MS);
  });

  panelWin.on('closed', () => {
    panelWin = null;
  });

  panelWin.webContents.on('context-menu', (event) => event.preventDefault());
  panelWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  return panelWin;
};

const clearBlurHideTimer = (): void => {
  if (blurHideTimer) {
    clearTimeout(blurHideTimer);
    blurHideTimer = null;
  }
};

const sendStateToPanel = (): void => {
  if (!panelWin || panelWin.isDestroyed() || panelWin.webContents.isDestroyed()) {
    return;
  }
  panelWin.webContents.send(IPC.MENU_BAR_PANEL_STATE, panelState);
};

const registerIpcListeners = (): void => {
  if (areListenersRegistered) {
    return;
  }
  areListenersRegistered = true;

  ipcMain.handle(IPC.MENU_BAR_PANEL_GET_STATE, () => panelState);
  ipcMain.on(IPC.MENU_BAR_PANEL_ACTION, (_event, rawAction: unknown) => {
    handlePanelAction(rawAction);
  });
  ipcMain.on(IPC.UPDATE_MENU_BAR_SETTINGS, (_event, rawConfig: unknown) => {
    const showDockIcon =
      !!rawConfig &&
      typeof rawConfig === 'object' &&
      (rawConfig as { showDockIcon?: unknown }).showDockIcon === true;
    applyDockVisibility({ showDockIcon });
  });
};

const handlePanelAction = (rawAction: unknown): void => {
  const action = parsePanelAction(rawAction);
  if (!action || !panelConfig) {
    return;
  }

  switch (action.type) {
    case 'toggleTask':
      sendToMainWindow(IPC.MENU_BAR_PANEL_TOGGLE_TASK, action.id);
      break;
    case 'completeTask':
      sendToMainWindow(IPC.MENU_BAR_PANEL_COMPLETE_TASK, action.id);
      break;
    case 'addTask':
      sendToMainWindow(IPC.MENU_BAR_PANEL_ADD_TASK, action.title);
      break;
    case 'showApp':
      hideMenuBarPanel();
      panelConfig.showApp();
      break;
    case 'hide':
      hideMenuBarPanel();
      break;
  }
};

const sendToMainWindow = (channel: string, payload: string): void => {
  const mainWindow = panelConfig?.getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(channel, payload);
};

const MAX_TASK_TITLE_LENGTH = 300;

const parsePanelAction = (rawAction: unknown): MenuBarPanelAction | null => {
  if (!rawAction || typeof rawAction !== 'object') {
    return null;
  }
  const action = rawAction as {
    type?: unknown;
    id?: unknown;
    title?: unknown;
  };

  if (action.type === 'showApp' || action.type === 'hide') {
    return { type: action.type };
  }

  if (action.type === 'toggleTask' || action.type === 'completeTask') {
    return typeof action.id === 'string' && action.id
      ? { type: action.type, id: action.id }
      : null;
  }

  if (action.type === 'addTask') {
    if (typeof action.title !== 'string') {
      return null;
    }
    const title = action.title.trim().slice(0, MAX_TASK_TITLE_LENGTH);
    return title ? { type: 'addTask', title } : null;
  }

  return null;
};
