import {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  ipcMain,
  screen,
} from 'electron';
import { join } from 'path';
import { assertSecureWebPreferences } from '../web-preferences-guard';
import { TaskWidgetConfig } from '../../src/app/features/config/global-config.model';
import { info } from 'electron-log/main';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { TaskWidgetView } from '../shared-with-frontend/task-widget-view.model';
import { loadSimpleStoreAll, saveSimpleStore } from '../simple-store';
import { IS_MAC } from '../common.const';
import { createTaskWidgetDockHint } from './task-widget-dock-hint';
import {
  BAR_HEIGHT,
  clampWidth,
  DEFAULT_WIDTH,
  FLOAT_HEIGHT,
  TaskWidgetEdge,
  TaskWidgetResizeSide,
} from './task-widget-layout';
import {
  createTaskWidgetPlacement,
  getTaskWidgetWindowBounds,
  TaskWidgetPlacement,
  TaskWidgetPlacementState,
} from './task-widget-placement';

let taskWidgetWin: BrowserWindow | null = null;
let isTaskWidgetEnabled = false;
let isAlwaysShow = false;
// Set when the user explicitly reveals the widget via the global shortcut
// (`globalToggleTaskWidget`) while the main window is visible. Like
// `isAlwaysShow`, it suppresses the automatic "hide the widget when the main
// window is shown/focused" behavior — but only until the user hides the widget
// again (toggles off) or opens the app from the widget. This gives the shortcut
// a sticky "user-forced visible" effect instead of being immediately undone by
// the next focus event.
let isUserForcedVisible = false;
let latestView: TaskWidgetView | null = null;
let placement: TaskWidgetPlacement | null = null;
let initTimeoutId: NodeJS.Timeout | null = null;
let currentOpacity = 95;
let listenersRegistered = false;
let taskWidgetCreationPromise: Promise<void> | null = null;
let taskWidgetCreationGeneration = 0;
let pendingShowAfterCreate = false;
let pendingShowAfterCreateInactive = false;

const TASK_WIDGET_BOUNDS_KEY = 'taskWidgetBounds';
const LEGACY_BOUNDS_KEY = 'overlayBounds';
const IPC_SHOW_MAIN_WINDOW = 'task-widget-show-main-window';
const IPC_TOGGLE_TASK = 'task-widget-toggle-task';
const IPC_MARK_DONE = 'task-widget-mark-done';
const IPC_TIME_WIDTH = 'task-widget-time-width';
const IPC_TOGGLE_DETAILS = 'task-widget-toggle-details';
const IPC_RESIZE_START = 'task-widget-resize-start';
const IPC_RESIZE = 'task-widget-resize';
const IPC_RESIZE_END = 'task-widget-resize-end';
const BAR_HALF_HEIGHT = BAR_HEIGHT / 2;
const FALLBACK_PRIMARY = '#6495ed';

type SavedPlacement = Readonly<{
  x: number;
  y: number;
  edge?: TaskWidgetEdge | null;
  centerY?: number;
  width?: number;
}>;

type ShowTaskWidgetOptions = Readonly<{
  inactive?: boolean;
}>;

export const updateTaskWidgetEnabled = (isEnabled: boolean): void => {
  isTaskWidgetEnabled = isEnabled;

  if (!isEnabled) {
    destroyTaskWidget();
    return;
  }

  if (!taskWidgetWin && !taskWidgetCreationPromise) {
    initListeners();
    createTaskWidgetWindow().then(() => {
      // Window creation is async; re-apply the cached opacity here because
      // updateTaskWidgetOpacity() is a no-op while taskWidgetWin is still null,
      // and on macOS BrowserWindow.setOpacity() defaults to 1 (no CSS fallback).
      if (taskWidgetWin && !taskWidgetWin.isDestroyed()) {
        updateTaskWidgetOpacity(currentOpacity);
      }
      // Request current task state after window is ready
      getMainWindow()?.webContents.send(IPC.REQUEST_CURRENT_TASK_FOR_TASK_WIDGET);
    });
  }
};

const getMainWindow = (): BrowserWindow | undefined =>
  BrowserWindow.getAllWindows().find((win) => win !== taskWidgetWin);

const clearPendingTaskWidgetCreation = (): void => {
  taskWidgetCreationGeneration += 1;
  taskWidgetCreationPromise = null;
  pendingShowAfterCreate = false;
  pendingShowAfterCreateInactive = false;
};

export const destroyTaskWidget = (): void => {
  // Clear any pending timeouts
  if (initTimeoutId) {
    clearTimeout(initTimeoutId);
    initTimeoutId = null;
  }

  placement?.destroy();
  placement = null;

  // Disable task widget to prevent close event prevention
  isTaskWidgetEnabled = false;
  isUserForcedVisible = false;
  clearPendingTaskWidgetCreation();

  // Remove IPC listeners
  ipcMain.removeAllListeners(IPC_SHOW_MAIN_WINDOW);
  ipcMain.removeAllListeners(IPC_TOGGLE_TASK);
  ipcMain.removeAllListeners(IPC_MARK_DONE);
  ipcMain.removeAllListeners(IPC_TIME_WIDTH);
  ipcMain.removeAllListeners(IPC_TOGGLE_DETAILS);
  ipcMain.removeAllListeners(IPC_RESIZE_START);
  ipcMain.removeAllListeners(IPC_RESIZE);
  ipcMain.removeAllListeners(IPC_RESIZE_END);
  listenersRegistered = false;

  if (taskWidgetWin && !taskWidgetWin.isDestroyed()) {
    try {
      // Remove ALL event listeners
      taskWidgetWin.removeAllListeners();

      // Remove webContents listeners
      if (taskWidgetWin.webContents && !taskWidgetWin.webContents.isDestroyed()) {
        taskWidgetWin.webContents.removeAllListeners();
      }

      // Hide first to prevent visual issues
      taskWidgetWin.hide();

      // Set closable to ensure we can close it
      taskWidgetWin.setClosable(true);

      // Force destroy the window
      taskWidgetWin.destroy();
    } catch (e) {
      // Window might already be destroyed
      console.error('Error destroying task widget window:', e);
    }

    taskWidgetWin = null;
  }
};

const getDefaultPlacement = (): TaskWidgetPlacementState => {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  const y = 20;
  return {
    x: screenWidth - DEFAULT_WIDTH - 20,
    y,
    edge: null,
    centerY: y + BAR_HALF_HEIGHT,
    width: DEFAULT_WIDTH,
  };
};

const loadPlacement = async (): Promise<TaskWidgetPlacementState> => {
  const defaultPlacement = getDefaultPlacement();
  try {
    const store = await loadSimpleStoreAll();
    // Try new key first, fall back to legacy key for migration
    const saved = (store[TASK_WIDGET_BOUNDS_KEY] || store[LEGACY_BOUNDS_KEY]) as
      | SavedPlacement
      | undefined;
    if (!saved || typeof saved.x !== 'number' || typeof saved.y !== 'number') {
      return defaultPlacement;
    }

    const width = Number.isFinite(saved.width)
      ? clampWidth(saved.width as number)
      : DEFAULT_WIDTH;

    // Validate saved position is visible on any connected display
    const matchingDisplay = screen.getDisplayMatching({
      x: saved.x,
      y: saved.y,
      width,
      height: FLOAT_HEIGHT,
    });
    const isOnScreen =
      matchingDisplay &&
      saved.x + width > matchingDisplay.bounds.x &&
      saved.x < matchingDisplay.bounds.x + matchingDisplay.bounds.width &&
      saved.y >= matchingDisplay.bounds.y &&
      saved.y < matchingDisplay.bounds.y + matchingDisplay.bounds.height;
    if (!isOnScreen) {
      return defaultPlacement;
    }

    return {
      x: saved.x,
      y: saved.y,
      edge:
        saved.edge === 'left' || saved.edge === 'right' || saved.edge === 'top'
          ? saved.edge
          : null,
      centerY:
        typeof saved.centerY === 'number' ? saved.centerY : saved.y + BAR_HALF_HEIGHT,
      width,
    };
  } catch (_e) {
    // Use defaults (file may not exist on first run)
    return defaultPlacement;
  }
};

const persistPlacement = (state: TaskWidgetPlacementState): void => {
  saveSimpleStore(TASK_WIDGET_BOUNDS_KEY, { ...state, height: FLOAT_HEIGHT });
};

const createTaskWidgetWindow = (): Promise<void> => {
  if (taskWidgetWin) {
    return Promise.resolve();
  }

  if (taskWidgetCreationPromise) {
    return taskWidgetCreationPromise;
  }

  const creationGeneration = taskWidgetCreationGeneration;
  const nextCreationPromise = createTaskWidgetWindowForGeneration(
    creationGeneration,
  ).finally(() => {
    if (taskWidgetCreationPromise === nextCreationPromise) {
      taskWidgetCreationPromise = null;
    }
  });

  taskWidgetCreationPromise = nextCreationPromise;
  return nextCreationPromise;
};

const createTaskWidgetWindowForGeneration = async (
  creationGeneration: number,
): Promise<void> => {
  if (taskWidgetWin) {
    return;
  }

  const placementState = await loadPlacement();

  if (
    taskWidgetWin ||
    !isTaskWidgetEnabled ||
    creationGeneration !== taskWidgetCreationGeneration
  ) {
    return;
  }

  const webPreferences: BrowserWindowConstructorOptions['webPreferences'] = {
    preload: join(__dirname, 'task-widget-preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    disableDialogs: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    backgroundThrottling: false, // Prevent throttling when hidden
    // Also disabled session-wide in start-app; this is the layer that holds if
    // that call is skipped or this window ever gets its own session.
    spellcheck: false,
  };
  // Keep the widget renderer's IPC boundary as tight as the main window's.
  assertSecureWebPreferences(webPreferences, 'task-widget');

  const isIdle = isIdleView();

  // On macOS, transparent + frameless windows do not support native window
  // dragging. Use a solid window instead and rely on BrowserWindow.setOpacity()
  // for the user-set opacity so the OS keeps native drag behavior intact.
  taskWidgetWin = new BrowserWindow({
    ...getTaskWidgetWindowBounds(placementState, false, isIdle),
    title: 'Super Productivity Task Widget',
    frame: false,
    transparent: !IS_MAC,
    backgroundColor: IS_MAC ? '#00000000' : undefined,
    alwaysOnTop: true,
    skipTaskbar: true,
    // The window keeps one size; the shape inside it does the moving.
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: true, // Ensure window is closable
    hasShadow: IS_MAC, // Mac: solid window can keep native shadow
    autoHideMenuBar: true,
    roundedCorners: IS_MAC, // Mac: rely on OS-native rounded corners
    webPreferences,
  });

  placement = createTaskWidgetPlacement(
    taskWidgetWin,
    placementState,
    isIdle,
    persistPlacement,
    () =>
      createTaskWidgetDockHint(
        () => latestView?.theme.primary || FALLBACK_PRIMARY,
        () => {
          if (taskWidgetWin && !taskWidgetWin.isDestroyed()) {
            taskWidgetWin.moveTop();
          }
        },
      ),
  );

  taskWidgetWin.loadFile(join(__dirname, 'task-widget.html'));

  // Re-apply opacity and content once the page loads. On Windows/Linux opacity is a CSS
  // variable driven by IPC; sends before did-finish-load are dropped. Uses 'on' (not 'once')
  // so a DevTools reload also restores them. macOS re-calls setOpacity() idempotently.
  taskWidgetWin.webContents.on('did-finish-load', () => {
    updateTaskWidgetOpacity(currentOpacity);
    sendLayout();
    sendView();
  });

  // Set visible on all workspaces immediately after creation
  taskWidgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  taskWidgetWin.on('closed', () => {
    placement?.destroy();
    placement = null;
    taskWidgetWin = null;
    // Tie "user-forced visible" to the window's lifetime: once the window is
    // gone the sticky flag has no widget to keep visible, so don't let it
    // linger into a future re-create.
    isUserForcedVisible = false;
  });

  taskWidgetWin.on('ready-to-show', () => {
    if (!taskWidgetWin || taskWidgetWin.isDestroyed()) return;
    // Ensure window stays on all workspaces
    taskWidgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Request current task state from main window
    getMainWindow()?.webContents.send(IPC.REQUEST_CURRENT_TASK_FOR_TASK_WIDGET);
    // Don't show task widget here - it should only show when main window is minimized
  });

  // Prevent context menu on right-click to avoid crashes
  taskWidgetWin.webContents.on('context-menu', (e) => {
    e.preventDefault();
  });

  // Prevent any window system menu
  taskWidgetWin.on('system-context-menu', (e) => {
    e.preventDefault();
  });

  // macOS: setOpacity() works immediately. Windows/Linux: IPC send is dropped before the
  // page loads; the did-finish-load handler above re-delivers it reliably.
  updateTaskWidgetOpacity(currentOpacity);

  if (pendingShowAfterCreate) {
    const showInactive = pendingShowAfterCreateInactive;
    pendingShowAfterCreate = false;
    pendingShowAfterCreateInactive = false;
    showTaskWidgetWindow({ inactive: showInactive });
  }
};

const showTaskWidgetWindow = (options: ShowTaskWidgetOptions = {}): void => {
  if (!taskWidgetWin || taskWidgetWin.isDestroyed()) {
    return;
  }

  if (options.inactive) {
    taskWidgetWin.showInactive();
  } else {
    taskWidgetWin.show();
  }
};

export const showTaskWidget = (options: ShowTaskWidgetOptions = {}): void => {
  if (!isTaskWidgetEnabled) {
    return;
  }

  // Recreate task widget if it was accidentally closed
  if (!taskWidgetWin) {
    info('Task widget window was destroyed, recreating');
    pendingShowAfterCreate = true;
    pendingShowAfterCreateInactive = pendingShowAfterCreateInactive || !!options.inactive;
    createTaskWidgetWindow();
    return;
  }

  if (taskWidgetWin.isDestroyed()) {
    return;
  }

  // Only show if not already visible
  if (!taskWidgetWin.isVisible()) {
    info('Showing task widget');
    showTaskWidgetWindow(options);
  } else {
    info('Task widget already visible');
  }
};

export const hideTaskWidget = (): void => {
  if (!taskWidgetWin || !isTaskWidgetEnabled) {
    info(
      'Task widget hide skipped: window=' +
        !!taskWidgetWin +
        ', enabled=' +
        isTaskWidgetEnabled,
    );
    return;
  }

  // Only hide if currently visible
  if (taskWidgetWin.isVisible()) {
    info('Hiding task widget');
    taskWidgetWin.hide();
  } else {
    info('Task widget already hidden');
  }
};

/**
 * Toggles the task widget's visibility. Intended for the global shortcut
 * (`globalToggleTaskWidget`): it only acts when the task widget feature is
 * enabled in settings and never changes that persisted enabled/disabled
 * preference — it just shows or hides the existing widget.
 */
export const toggleTaskWidgetVisibility = (): void => {
  if (!isTaskWidgetEnabled) {
    return;
  }

  if (taskWidgetWin && !taskWidgetWin.isDestroyed() && taskWidgetWin.isVisible()) {
    isUserForcedVisible = false;
    hideTaskWidget();
    return;
  }

  isUserForcedVisible = true;
  showTaskWidget({ inactive: true });
};

const initListeners = (): void => {
  if (listenersRegistered) {
    return;
  }
  listenersRegistered = true;

  ipcMain.on(IPC_TOGGLE_TASK, () => {
    getMainWindow()?.webContents.send(IPC.TASK_TOGGLE_START);
  });

  ipcMain.on(IPC_MARK_DONE, () => {
    getMainWindow()?.webContents.send(IPC.TASK_WIDGET_MARK_DONE);
  });

  ipcMain.on(IPC_TOGGLE_DETAILS, () => {
    placement?.toggleDetails();
  });

  ipcMain.on(IPC_RESIZE_START, (_ev, side: TaskWidgetResizeSide) => {
    if (side === 'left' || side === 'right') {
      placement?.startResize(side);
    }
  });

  ipcMain.on(IPC_RESIZE, () => {
    placement?.resize();
  });

  ipcMain.on(IPC_RESIZE_END, () => {
    placement?.endResize();
  });

  // The pill fits its time, and only the widget can measure the rendered text.
  ipcMain.on(IPC_TIME_WIDTH, (_ev, timeWidth: number) => {
    if (Number.isFinite(timeWidth) && timeWidth > 0) {
      placement?.setTimeWidth(timeWidth);
    }
  });

  // Listen for show main window request
  ipcMain.on(IPC_SHOW_MAIN_WINDOW, () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      // Mirror showOrFocus() logic: restore() before show() to handle the case where
      // the window is minimized+hidden (e.g. minimize-to-tray on Linux where
      // event.preventDefault() on 'minimize' has no effect).
      mainWindow.restore();
      mainWindow.show();
      // Opening the app from the widget is an explicit "I'm going to the app"
      // gesture, so clear any sticky user-forced visibility and let the widget
      // follow the normal companion behavior again.
      isUserForcedVisible = false;
      if (!isAlwaysShow) {
        hideTaskWidget();
      }
      setTimeout(() => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.focus();
          if (!mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.focus();
          }
        }
      }, 60);
    }
  });
};

const isIdleView = (): boolean => !latestView || latestView.mode === 'idle';

const sendLayout = (): void => {
  if (taskWidgetWin && placement) {
    taskWidgetWin.webContents.send('update-layout', placement.getLayout());
  }
};

const sendView = (): void => {
  if (taskWidgetWin && latestView) {
    taskWidgetWin.webContents.send('update-view', latestView);
  }
};

export const updateTaskWidgetView = (view: TaskWidgetView): void => {
  latestView = view;
  if (!isTaskWidgetEnabled) {
    return;
  }
  placement?.setIdle(isIdleView());
  sendView();
};

export const updateTaskWidgetAlwaysShow = (alwaysShow: boolean): void => {
  isAlwaysShow = alwaysShow;
};

export const getIsTaskWidgetAlwaysShow = (): boolean => isAlwaysShow;

export const getIsTaskWidgetUserForcedVisible = (): boolean => isUserForcedVisible;

export const updateTaskWidgetOpacity = (opacity: number): void => {
  currentOpacity = opacity;
  if (!taskWidgetWin || taskWidgetWin.isDestroyed()) {
    return;
  }
  const clamped = Math.max(0.1, Math.min(1, opacity / 100));
  if (IS_MAC) {
    // On Mac the window is solid (transparent: false), so opacity is applied
    // at the window level rather than via CSS background alpha.
    taskWidgetWin.setOpacity(clamped);
  } else {
    taskWidgetWin.webContents.send('update-opacity', clamped);
  }
};

// Apply the per-instance task widget settings sent by the renderer.
const applyTaskWidgetSettings = (cfg: TaskWidgetConfig | undefined): void => {
  const isEnabled = !!cfg?.isEnabled;
  updateTaskWidgetEnabled(isEnabled);
  if (isEnabled) {
    updateTaskWidgetOpacity(cfg?.opacity ?? 95);
    updateTaskWidgetAlwaysShow(!!cfg?.isAlwaysShow);
  } else {
    updateTaskWidgetAlwaysShow(false);
  }
};

let taskWidgetSettingsListenerRegistered = false;
export const initTaskWidgetSettingsListener = (): void => {
  if (taskWidgetSettingsListenerRegistered) return;
  taskWidgetSettingsListenerRegistered = true;
  ipcMain.on(IPC.UPDATE_TASK_WIDGET_SETTINGS, (_ev, cfg: TaskWidgetConfig) => {
    applyTaskWidgetSettings(cfg);
  });
  ipcMain.on(IPC.UPDATE_TASK_WIDGET_VIEW, (_ev, view: TaskWidgetView) => {
    updateTaskWidgetView(view);
  });
};
