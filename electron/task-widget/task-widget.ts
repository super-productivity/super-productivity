import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';
import type { TaskCopy } from '../../src/app/features/tasks/task.model';
import type { TaskWidgetConfig } from '../../src/app/features/config/global-config.model';
import type { TaskWidgetOverview } from '../../src/app/features/tasks/task-widget-overview.model';
import { info } from 'electron-log/main';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { loadSimpleStoreAll, saveSimpleStore } from '../simple-store';
import { IS_MAC } from '../common.const';
import {
  clamp,
  getCollapsedEdgeBounds,
  getClosestEdgeInfo,
  getDockedBounds,
  isPointInsideBounds,
  type TaskWidgetEdge,
} from './task-widget-edge-bounds';

type TaskWidgetBounds = { width: number; height: number; x: number; y: number };
type RequiredTaskWidgetConfig = Required<TaskWidgetConfig>;

let taskWidgetWin: BrowserWindow | null = null;
let isTaskWidgetEnabled = false;
let currentTask: TaskCopy | null = null;
let isPomodoroEnabled = false;
let currentPomodoroSessionTime = 0;
let isFocusModeEnabled = false;
let currentFocusSessionTime = 0;
let currentOverview: TaskWidgetOverview | null = null;
let initTimeoutId: NodeJS.Timeout | null = null;
let currentOpacity = 95;
let listenersRegistered = false;
let isCreatingWindow = false;
let collapseTimer: NodeJS.Timeout | null = null;
let animationTimer: NodeJS.Timeout | null = null;
let mouseWatcherTimer: NodeJS.Timeout | null = null;
let isCollapsed = false;
let lastExpandedBounds: TaskWidgetBounds | null = null;

const DEFAULT_TASK_WIDGET_CONFIG: RequiredTaskWidgetConfig = {
  isEnabled: false,
  isAlwaysShow: false,
  opacity: 95,
  autoHideToEdge: process.platform === 'win32',
  edge: 'right',
  expandedWidth: 360,
  collapsedWidth: 26,
};

let currentConfig: RequiredTaskWidgetConfig = { ...DEFAULT_TASK_WIDGET_CONFIG };

const TASK_WIDGET_BOUNDS_KEY = 'taskWidgetBounds';
const LEGACY_BOUNDS_KEY = 'overlayBounds';
const MOUSE_WATCHER_INTERVAL_MS = 50;
const AUTO_COLLAPSE_DELAY_MS = 50;
const WINDOW_ANIMATION_DURATION_MS = 100;
const EDGE_AUTO_HIDE_DISTANCE_PX = 96;
let boundsDebounceTimer: NodeJS.Timeout | null = null;
let overviewRequestRetryTimer: NodeJS.Timeout | null = null;

const isUsableExpandedBounds = (bounds: TaskWidgetBounds | null | undefined): boolean =>
  !!bounds &&
  bounds.width > currentConfig.collapsedWidth * 2 &&
  bounds.height > currentConfig.collapsedWidth * 2;

const isTaskWidgetEdge = (edge: unknown): edge is TaskWidgetEdge =>
  edge === 'left' || edge === 'right' || edge === 'top' || edge === 'bottom';

const getWidgetEdge = (): TaskWidgetEdge =>
  isTaskWidgetEdge(currentConfig.edge) ? currentConfig.edge : 'right';

const setWidgetEdge = (edge: TaskWidgetEdge): void => {
  if (currentConfig.edge === edge) return;
  currentConfig = {
    ...currentConfig,
    edge,
  };
  sendCollapsedState();
};

const areBoundsEqual = (a: TaskWidgetBounds, b: TaskWidgetBounds): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const getClampedBounds = (
  bounds: TaskWidgetBounds,
  workArea: Electron.Rectangle,
): TaskWidgetBounds => ({
  ...bounds,
  x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - bounds.width),
  y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height),
});

const isCloseEnoughToAutoHide = (bounds: TaskWidgetBounds): boolean => {
  const workArea = screen.getDisplayMatching(bounds).workArea;
  return getClosestEdgeInfo(bounds, workArea).distance <= EDGE_AUTO_HIDE_DISTANCE_PX;
};

const getDefaultBounds = (workArea: Electron.Rectangle): TaskWidgetBounds => {
  const width = currentConfig.autoHideToEdge ? currentConfig.expandedWidth : 300;
  const height = currentConfig.autoHideToEdge ? 620 : 80;
  const edge = getWidgetEdge();
  const y = edge === 'bottom' ? workArea.y + workArea.height - height : workArea.y + 20;
  const x =
    edge === 'left'
      ? workArea.x
      : edge === 'right'
        ? workArea.x + workArea.width - width
        : workArea.x + Math.round((workArea.width - width) / 2);
  return getDockedBounds(
    edge,
    {
      width,
      height: Math.min(height, workArea.height),
      x,
      y: clamp(
        y,
        workArea.y,
        workArea.y + workArea.height - Math.min(height, workArea.height),
      ),
    },
    workArea,
  );
};

const normalizeInitialBounds = (
  saved: TaskWidgetBounds,
  workArea: Electron.Rectangle,
): TaskWidgetBounds => {
  if (!currentConfig.autoHideToEdge) {
    return saved;
  }

  const wasCollapsedBounds = !isUsableExpandedBounds(saved);
  const width = clamp(
    wasCollapsedBounds
      ? currentConfig.expandedWidth
      : saved.width || currentConfig.expandedWidth,
    300,
    700,
  );
  const minHeight = 360;
  const height = clamp(
    wasCollapsedBounds ? 620 : saved.height,
    minHeight,
    Math.min(700, workArea.height),
  );
  const xFromSavedCenter = saved.x + Math.round((saved.width - width) / 2);
  const yFromSavedCenter = saved.y + Math.round((saved.height - height) / 2);
  const nextBounds = {
    ...saved,
    width,
    height,
    x: wasCollapsedBounds ? xFromSavedCenter : saved.x,
    y: wasCollapsedBounds ? yFromSavedCenter : saved.y,
  };
  const edgeInfo = getClosestEdgeInfo(nextBounds, workArea);
  if (edgeInfo.distance <= EDGE_AUTO_HIDE_DISTANCE_PX) {
    setWidgetEdge(edgeInfo.edge);
    return getDockedBounds(edgeInfo.edge, nextBounds, workArea);
  }
  return getClampedBounds(nextBounds, workArea);
};

const getMainWindow = (): BrowserWindow | undefined =>
  BrowserWindow.getAllWindows().find((win) => win !== taskWidgetWin);

const isMainWindowVisible = (): boolean => {
  const mainWindow = getMainWindow();
  return !!mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized();
};

const getCurrentWorkArea = (): Electron.Rectangle => {
  if (!taskWidgetWin || taskWidgetWin.isDestroyed()) {
    return screen.getPrimaryDisplay().workArea;
  }
  const referenceBounds =
    isCollapsed && lastExpandedBounds ? lastExpandedBounds : taskWidgetWin.getBounds();
  return screen.getDisplayMatching(referenceBounds).workArea;
};

const getExpandedBounds = (): TaskWidgetBounds => {
  const workArea = getCurrentWorkArea();
  const currentBounds = taskWidgetWin?.getBounds() || lastExpandedBounds;
  const usableLastBounds = isUsableExpandedBounds(lastExpandedBounds)
    ? lastExpandedBounds
    : null;
  const usableCurrentBounds =
    !isCollapsed && isUsableExpandedBounds(currentBounds) ? currentBounds : null;
  const width = clamp(
    usableCurrentBounds?.width ?? usableLastBounds?.width ?? currentConfig.expandedWidth,
    300,
    700,
  );
  const height = clamp(
    usableCurrentBounds?.height ?? usableLastBounds?.height ?? 620,
    360,
    Math.min(700, workArea.height),
  );
  const x = clamp(
    usableCurrentBounds?.x ?? usableLastBounds?.x ?? workArea.x + workArea.width - width,
    workArea.x,
    workArea.x + workArea.width - width,
  );
  const y = clamp(
    usableCurrentBounds?.y ?? usableLastBounds?.y ?? workArea.y + 20,
    workArea.y,
    workArea.y + workArea.height - height,
  );
  const nextBounds = {
    width,
    height,
    x,
    y,
  };
  const edgeInfo = getClosestEdgeInfo(nextBounds, workArea);
  if (edgeInfo.distance <= EDGE_AUTO_HIDE_DISTANCE_PX) {
    setWidgetEdge(edgeInfo.edge);
    return getDockedBounds(edgeInfo.edge, nextBounds, workArea);
  }
  return getClampedBounds(nextBounds, workArea);
};

const getCollapsedBounds = (): TaskWidgetBounds => {
  const expanded = getExpandedBounds();
  const workArea = getCurrentWorkArea();
  return getCollapsedEdgeBounds(
    expanded,
    workArea,
    getWidgetEdge(),
    currentConfig.collapsedWidth,
  );
};

const clearCollapseTimer = (): void => {
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
};

const clearMouseWatcherTimer = (): void => {
  if (mouseWatcherTimer) {
    clearInterval(mouseWatcherTimer);
    mouseWatcherTimer = null;
  }
};

const clearOverviewRequestRetryTimer = (): void => {
  if (overviewRequestRetryTimer) {
    clearTimeout(overviewRequestRetryTimer);
    overviewRequestRetryTimer = null;
  }
};

const sendCollapsedState = (): void => {
  if (!taskWidgetWin || taskWidgetWin.isDestroyed()) return;
  taskWidgetWin.webContents.send('collapsed-state', {
    isCollapsed,
    edge: getWidgetEdge(),
    collapsedWidth: currentConfig.collapsedWidth,
  });
};

const animateTaskWidgetBounds = (
  targetBounds: TaskWidgetBounds,
  durationMs = WINDOW_ANIMATION_DURATION_MS,
): void => {
  if (!taskWidgetWin || taskWidgetWin.isDestroyed()) return;

  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }

  const startBounds = taskWidgetWin.getBounds();
  const startedAt = Date.now();
  const easeOutCubic = (value: number): number => 1 - Math.pow(1 - value, 3);

  animationTimer = setInterval(() => {
    if (!taskWidgetWin || taskWidgetWin.isDestroyed()) {
      if (animationTimer) clearInterval(animationTimer);
      animationTimer = null;
      return;
    }

    const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
    const eased = easeOutCubic(progress);
    const interpolate = (from: number, to: number): number => {
      const delta = (to - from) * eased;
      return Math.round(from + delta);
    };
    const nextBounds = {
      x: interpolate(startBounds.x, targetBounds.x),
      y: interpolate(startBounds.y, targetBounds.y),
      width: interpolate(startBounds.width, targetBounds.width),
      height: interpolate(startBounds.height, targetBounds.height),
    };
    taskWidgetWin.setBounds(nextBounds);

    if (progress >= 1) {
      if (animationTimer) clearInterval(animationTimer);
      animationTimer = null;
      taskWidgetWin.setBounds(targetBounds);
    }
  }, 16);
};

const setCollapsedState = (nextIsCollapsed: boolean): void => {
  if (!taskWidgetWin || taskWidgetWin.isDestroyed() || !currentConfig.autoHideToEdge) {
    return;
  }

  clearCollapseTimer();

  if (nextIsCollapsed && !isCollapsed) {
    const currentBounds = taskWidgetWin.getBounds();
    if (isUsableExpandedBounds(currentBounds)) {
      const workArea = screen.getDisplayMatching(currentBounds).workArea;
      const edgeInfo = getClosestEdgeInfo(currentBounds, workArea);
      if (edgeInfo.distance > EDGE_AUTO_HIDE_DISTANCE_PX) {
        lastExpandedBounds = getClampedBounds(currentBounds, workArea);
        saveSimpleStore(TASK_WIDGET_BOUNDS_KEY, lastExpandedBounds);
        return;
      }
      setWidgetEdge(edgeInfo.edge);
      lastExpandedBounds = getDockedBounds(edgeInfo.edge, currentBounds, workArea);
      saveSimpleStore(TASK_WIDGET_BOUNDS_KEY, lastExpandedBounds);
    }
  }

  isCollapsed = nextIsCollapsed;
  const bounds = nextIsCollapsed ? getCollapsedBounds() : getExpandedBounds();
  sendCollapsedState();
  animateTaskWidgetBounds(bounds);
};

const scheduleCollapse = (): void => {
  if (!currentConfig.autoHideToEdge) return;
  if (
    taskWidgetWin &&
    !taskWidgetWin.isDestroyed() &&
    !isCollapsed &&
    !isCloseEnoughToAutoHide(taskWidgetWin.getBounds())
  ) {
    return;
  }
  if (collapseTimer) return;
  collapseTimer = setTimeout(() => {
    setCollapsedState(true);
  }, AUTO_COLLAPSE_DELAY_MS);
};

const expandTaskWidget = (): void => setCollapsedState(false);

export const collapseTaskWidgetToEdge = (): boolean => {
  if (!currentConfig.autoHideToEdge) return false;
  const wasCollapsed = isCollapsed;
  setCollapsedState(true);
  return wasCollapsed || isCollapsed;
};

export const shouldCollapseTaskWidgetWithMainWindow = (): boolean =>
  currentConfig.autoHideToEdge && currentConfig.isAlwaysShow;

const runMouseWatcherTick = (): void => {
  if (
    !taskWidgetWin ||
    taskWidgetWin.isDestroyed() ||
    !taskWidgetWin.isVisible() ||
    !currentConfig.autoHideToEdge
  ) {
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const currentBounds = taskWidgetWin.getBounds();

  if (isCollapsed) {
    if (isPointInsideBounds(cursor, currentBounds)) {
      expandTaskWidget();
    }
    return;
  }

  if (isPointInsideBounds(cursor, currentBounds)) {
    clearCollapseTimer();
  } else if (!isCloseEnoughToAutoHide(currentBounds)) {
    clearCollapseTimer();
  } else {
    scheduleCollapse();
  }
};

const startMouseWatcher = (): void => {
  if (!currentConfig.autoHideToEdge) return;
  if (!mouseWatcherTimer) {
    mouseWatcherTimer = setInterval(runMouseWatcherTick, MOUSE_WATCHER_INTERVAL_MS);
  }
  runMouseWatcherTick();
};

const applyVisibleAutoHideState = (): void => {
  if (!currentConfig.autoHideToEdge) return;
  startMouseWatcher();
  if (isMainWindowVisible() && shouldCollapseTaskWidgetWithMainWindow()) {
    collapseTaskWidgetToEdge();
  } else {
    expandTaskWidget();
    scheduleCollapse();
  }
};

export const updateTaskWidgetEnabled = (isEnabled: boolean): void => {
  isTaskWidgetEnabled = isEnabled;

  if (isEnabled && !taskWidgetWin && !isCreatingWindow) {
    initListeners();
    createTaskWidgetWindow().then(() => {
      // Window creation is async; re-apply the cached opacity here because
      // updateTaskWidgetOpacity() is a no-op while taskWidgetWin is still null,
      // and on macOS BrowserWindow.setOpacity() defaults to 1 (no CSS fallback).
      if (taskWidgetWin && !taskWidgetWin.isDestroyed()) {
        updateTaskWidgetOpacity(currentOpacity);
      }
      // Request current task state after window is ready
      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IPC.REQUEST_CURRENT_TASK_FOR_TASK_WIDGET);
        mainWindow.webContents.send(IPC.REQUEST_TASK_WIDGET_OVERVIEW);
      }
    });
  } else if (!isEnabled && taskWidgetWin) {
    destroyTaskWidget();
  }
};

export const destroyTaskWidget = (): void => {
  // Clear any pending timeouts
  if (initTimeoutId) {
    clearTimeout(initTimeoutId);
    initTimeoutId = null;
  }
  clearCollapseTimer();
  clearMouseWatcherTimer();
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }

  // Clear bounds debounce timer
  if (boundsDebounceTimer) {
    clearTimeout(boundsDebounceTimer);
    boundsDebounceTimer = null;
  }

  if (overviewRequestRetryTimer) {
    clearOverviewRequestRetryTimer();
  }

  // Disable task widget to prevent close event prevention
  isTaskWidgetEnabled = false;
  isCreatingWindow = false;

  // Remove IPC listeners
  ipcMain.removeAllListeners('task-widget-show-main-window');
  ipcMain.removeAllListeners('task-widget-add-note');
  ipcMain.removeAllListeners('task-widget-switch-task');
  ipcMain.removeAllListeners('task-widget-toggle-task-done');
  ipcMain.removeAllListeners('task-widget-pointer-state');
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

const createTaskWidgetWindow = async (): Promise<void> => {
  if (taskWidgetWin || isCreatingWindow) {
    return;
  }
  isCreatingWindow = true;

  const primaryDisplay = screen.getPrimaryDisplay();
  const defaultBounds = getDefaultBounds(primaryDisplay.workArea);

  // Restore persisted bounds or use defaults
  let bounds = defaultBounds;
  try {
    const store = await loadSimpleStoreAll();
    // Try new key first, fall back to legacy key for migration
    const saved = (store[TASK_WIDGET_BOUNDS_KEY] || store[LEGACY_BOUNDS_KEY]) as
      | { width: number; height: number; x: number; y: number }
      | undefined;
    if (
      saved &&
      typeof saved.width === 'number' &&
      saved.width > 0 &&
      typeof saved.height === 'number' &&
      saved.height > 0 &&
      typeof saved.x === 'number' &&
      typeof saved.y === 'number'
    ) {
      // Validate saved bounds are visible on any connected display
      const matchingDisplay = screen.getDisplayMatching({
        x: saved.x,
        y: saved.y,
        width: saved.width,
        height: saved.height,
      });
      const isOnScreen =
        matchingDisplay &&
        saved.x + saved.width > matchingDisplay.bounds.x &&
        saved.x < matchingDisplay.bounds.x + matchingDisplay.bounds.width &&
        saved.y >= matchingDisplay.bounds.y &&
        saved.y < matchingDisplay.bounds.y + matchingDisplay.bounds.height;
      bounds = isOnScreen
        ? normalizeInitialBounds(saved, matchingDisplay.workArea)
        : defaultBounds;
    }
  } catch (_e) {
    // Use defaults (file may not exist on first run)
  }

  lastExpandedBounds = bounds;

  isCreatingWindow = false;
  // On macOS, transparent + frameless windows do not support native window
  // dragging or edge resizing (see Electron's BrowserWindow docs: "Transparent
  // windows are not resizable. Setting `resizable` to `true` may make a
  // transparent window stop working on some platforms."). Use a solid window
  // instead and rely on BrowserWindow.setOpacity() for the user-set opacity so
  // the OS keeps native drag/resize behavior intact.
  taskWidgetWin = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    title: 'Super Productivity Task Widget',
    frame: false,
    transparent: !IS_MAC,
    backgroundColor: IS_MAC ? '#00000000' : undefined,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minWidth: currentConfig.autoHideToEdge ? currentConfig.collapsedWidth : 60,
    minHeight: currentConfig.autoHideToEdge ? currentConfig.collapsedWidth : 24,
    maxWidth: 700,
    maxHeight: 700,
    minimizable: false,
    maximizable: false,
    closable: true, // Ensure window is closable
    hasShadow: IS_MAC, // Mac: solid window can keep native shadow
    autoHideMenuBar: true,
    roundedCorners: IS_MAC, // Mac: rely on OS-native rounded corners
    webPreferences: {
      preload: join(__dirname, 'task-widget-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      disableDialogs: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false, // Prevent throttling when hidden
    },
  });

  taskWidgetWin.loadFile(join(__dirname, 'task-widget.html'));

  // Set visible on all workspaces immediately after creation
  taskWidgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  taskWidgetWin.on('closed', () => {
    taskWidgetWin = null;
  });

  taskWidgetWin.on('ready-to-show', () => {
    if (!taskWidgetWin || taskWidgetWin.isDestroyed()) return;
    // Ensure window stays on all workspaces
    taskWidgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Request current task state from main window
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC.REQUEST_CURRENT_TASK_FOR_TASK_WIDGET);
      mainWindow.webContents.send(IPC.REQUEST_TASK_WIDGET_OVERVIEW);
    }
    sendOverviewToRenderer();
    sendCollapsedState();
    // Don't show task widget here - it should only show when main window is minimized
  });

  const persistBoundsDebounced = (): void => {
    if (isCollapsed) return;
    if (boundsDebounceTimer) clearTimeout(boundsDebounceTimer);
    boundsDebounceTimer = setTimeout(() => {
      if (taskWidgetWin && !taskWidgetWin.isDestroyed()) {
        const nextBounds = taskWidgetWin.getBounds();
        if (isUsableExpandedBounds(nextBounds)) {
          const workArea = screen.getDisplayMatching(nextBounds).workArea;
          const edgeInfo = getClosestEdgeInfo(nextBounds, workArea);
          const targetBounds =
            edgeInfo.distance <= EDGE_AUTO_HIDE_DISTANCE_PX
              ? getDockedBounds(edgeInfo.edge, nextBounds, workArea)
              : getClampedBounds(nextBounds, workArea);

          if (edgeInfo.distance <= EDGE_AUTO_HIDE_DISTANCE_PX) {
            setWidgetEdge(edgeInfo.edge);
          } else {
            clearCollapseTimer();
          }
          lastExpandedBounds = targetBounds;
          saveSimpleStore(TASK_WIDGET_BOUNDS_KEY, lastExpandedBounds);
          if (!areBoundsEqual(nextBounds, targetBounds)) {
            taskWidgetWin.setBounds(targetBounds, true);
          }
        }
      }
    }, 300);
  };

  taskWidgetWin.on('resize', persistBoundsDebounced);
  taskWidgetWin.on('move', persistBoundsDebounced);

  // Prevent context menu on right-click to avoid crashes
  taskWidgetWin.webContents.on('context-menu', (e) => {
    e.preventDefault();
  });

  // Prevent any window system menu
  taskWidgetWin.on('system-context-menu', (e) => {
    e.preventDefault();
  });

  // Don't make window click-through initially to allow dragging
  // The renderer process will handle mouse events dynamically

  // Update initial state
  updateTaskWidgetContent();
  sendOverviewToRenderer();
  requestTaskWidgetOverview();
  sendCollapsedState();
};

export const showTaskWidget = (): void => {
  if (!isTaskWidgetEnabled) {
    return;
  }

  // Recreate task widget if it was accidentally closed
  if (!taskWidgetWin) {
    info('Task widget window was destroyed, recreating');
    createTaskWidgetWindow().then(() => {
      if (taskWidgetWin && !taskWidgetWin.isDestroyed()) {
        updateTaskWidgetOpacity(currentOpacity);
        requestTaskWidgetOverview();
        taskWidgetWin.show();
        applyVisibleAutoHideState();
      }
    });
    return;
  }

  if (taskWidgetWin.isDestroyed()) {
    return;
  }

  // Only show if not already visible
  if (!taskWidgetWin.isVisible()) {
    info('Showing task widget');
    requestTaskWidgetOverview();
    taskWidgetWin.show();
    applyVisibleAutoHideState();
  } else {
    info('Task widget already visible');
    requestTaskWidgetOverview();
    applyVisibleAutoHideState();
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
    clearCollapseTimer();
    clearMouseWatcherTimer();
    taskWidgetWin.hide();
  } else {
    info('Task widget already hidden');
  }
};

const initListeners = (): void => {
  if (listenersRegistered) {
    return;
  }
  listenersRegistered = true;

  // Listen for show main window request
  ipcMain.on('task-widget-show-main-window', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      // Mirror showOrFocus() logic: restore() before show() to handle the case where
      // the window is minimized+hidden (e.g. minimize-to-tray on Linux where
      // event.preventDefault() on 'minimize' has no effect).
      mainWindow.restore();
      mainWindow.show();
      if (shouldCollapseTaskWidgetWithMainWindow()) {
        collapseTaskWidgetToEdge();
      } else if (!currentConfig.isAlwaysShow) {
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

  ipcMain.on('task-widget-add-note', (_ev, content: unknown) => {
    if (typeof content !== 'string' || content.trim().length === 0) {
      return;
    }
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(IPC.TASK_WIDGET_ADD_NOTE, content);
  });

  ipcMain.on('task-widget-switch-task', (_ev, taskId: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      return;
    }
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(IPC.SWITCH_TASK, taskId);
  });

  ipcMain.on('task-widget-toggle-task-done', (_ev, data: unknown) => {
    if (
      !data ||
      typeof data !== 'object' ||
      typeof (data as { taskId?: unknown }).taskId !== 'string' ||
      typeof (data as { isDone?: unknown }).isDone !== 'boolean'
    ) {
      return;
    }
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(IPC.TASK_WIDGET_TOGGLE_TASK_DONE, data);
  });

  ipcMain.on('task-widget-pointer-state', (_ev, isInside: unknown) => {
    if (!currentConfig.autoHideToEdge) return;
    if (isInside) {
      expandTaskWidget();
    } else {
      scheduleCollapse();
    }
  });
};

export const updateTaskWidgetTask = (
  task: TaskCopy | null,
  pomodoroEnabled: boolean,
  pomodoroTime: number,
  focusModeEnabled: boolean,
  focusTime: number,
): void => {
  currentTask = task;
  isPomodoroEnabled = pomodoroEnabled;
  currentPomodoroSessionTime = pomodoroTime;
  isFocusModeEnabled = focusModeEnabled;
  currentFocusSessionTime = focusTime;

  updateTaskWidgetContent();
};

const updateTaskWidgetContent = (): void => {
  if (!taskWidgetWin || !isTaskWidgetEnabled) {
    return;
  }

  let title = '';
  let timeStr = '';
  let mode: 'pomodoro' | 'focus' | 'task' | 'idle' = 'idle';

  if (currentTask && currentTask.title) {
    title = currentTask.title;
    if (title.length > 40) {
      title = title.substring(0, 37) + '...';
    }

    if (isPomodoroEnabled) {
      mode = 'pomodoro';
      timeStr = formatTime(currentPomodoroSessionTime);
    } else if (isFocusModeEnabled) {
      mode = 'focus';
      timeStr = formatTime(currentFocusSessionTime);
    } else if (currentTask.timeEstimate) {
      mode = 'task';
      const remainingTime = Math.max(currentTask.timeEstimate - currentTask.timeSpent, 0);
      timeStr = formatTime(remainingTime);
    } else if (currentTask.timeSpent) {
      mode = 'task';
      timeStr = formatTime(currentTask.timeSpent);
    }
  }

  taskWidgetWin.webContents.send('update-content', {
    title,
    time: timeStr,
    mode,
  });
};

export const updateTaskWidgetAlwaysShow = (alwaysShow: boolean): void => {
  currentConfig = {
    ...currentConfig,
    isAlwaysShow: alwaysShow,
  };
};

export const getIsTaskWidgetAlwaysShow = (): boolean => currentConfig.isAlwaysShow;

const sendOverviewToRenderer = (): void => {
  if (!taskWidgetWin || taskWidgetWin.isDestroyed() || !isTaskWidgetEnabled) {
    return;
  }
  taskWidgetWin.webContents.send('update-overview', currentOverview);
};

const requestTaskWidgetOverview = (): void => {
  getMainWindow()?.webContents.send(IPC.REQUEST_TASK_WIDGET_OVERVIEW);
  if (!taskWidgetWin || taskWidgetWin.isDestroyed() || currentOverview) {
    return;
  }

  clearOverviewRequestRetryTimer();
  overviewRequestRetryTimer = setTimeout(() => {
    overviewRequestRetryTimer = null;
    if (
      taskWidgetWin &&
      !taskWidgetWin.isDestroyed() &&
      taskWidgetWin.isVisible() &&
      !currentOverview
    ) {
      requestTaskWidgetOverview();
    }
  }, 750);
};

export const updateTaskWidgetOverview = (overview: TaskWidgetOverview): void => {
  currentOverview = overview;
  clearOverviewRequestRetryTimer();
  sendOverviewToRenderer();
};

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
  const nextCfg = cfg || {};
  currentConfig = {
    isEnabled: !!nextCfg.isEnabled,
    isAlwaysShow: !!nextCfg.isAlwaysShow,
    opacity: nextCfg.opacity ?? DEFAULT_TASK_WIDGET_CONFIG.opacity,
    autoHideToEdge: nextCfg.autoHideToEdge ?? DEFAULT_TASK_WIDGET_CONFIG.autoHideToEdge,
    edge: isTaskWidgetEdge(nextCfg.edge) ? nextCfg.edge : 'right',
    expandedWidth: clamp(
      nextCfg.expandedWidth ?? DEFAULT_TASK_WIDGET_CONFIG.expandedWidth,
      300,
      560,
    ),
    collapsedWidth: clamp(
      nextCfg.collapsedWidth ?? DEFAULT_TASK_WIDGET_CONFIG.collapsedWidth,
      18,
      60,
    ),
  };
  const isEnabled = !!currentConfig.isEnabled;
  updateTaskWidgetEnabled(isEnabled);
  if (isEnabled) {
    updateTaskWidgetOpacity(currentConfig.opacity);
    updateTaskWidgetAlwaysShow(currentConfig.isAlwaysShow);
    if (taskWidgetWin && !taskWidgetWin.isDestroyed()) {
      taskWidgetWin.setMinimumSize(
        currentConfig.autoHideToEdge ? currentConfig.collapsedWidth : 60,
        currentConfig.autoHideToEdge ? currentConfig.collapsedWidth : 24,
      );
    }
    if (taskWidgetWin && !taskWidgetWin.isDestroyed() && currentConfig.autoHideToEdge) {
      startMouseWatcher();
      const nextBounds = getExpandedBounds();
      lastExpandedBounds = nextBounds;
      taskWidgetWin.setBounds(isCollapsed ? getCollapsedBounds() : nextBounds, true);
      sendCollapsedState();
      if (!isCollapsed) {
        scheduleCollapse();
      }
    } else {
      clearCollapseTimer();
      clearMouseWatcherTimer();
      if (taskWidgetWin && !taskWidgetWin.isDestroyed() && isCollapsed) {
        const fallbackBounds = lastExpandedBounds || taskWidgetWin.getBounds();
        taskWidgetWin.setBounds(
          {
            ...fallbackBounds,
            width: Math.max(fallbackBounds.width, 300),
          },
          true,
        );
      }
      isCollapsed = false;
      sendCollapsedState();
    }
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
  ipcMain.on(IPC.TASK_WIDGET_OVERVIEW_UPDATED, (_ev, overview: TaskWidgetOverview) => {
    updateTaskWidgetOverview(overview);
  });
};

const formatTime = (timeMs: number): string => {
  const totalSeconds = Math.floor(timeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};
