import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';
import { TaskCopy } from '../../src/app/features/tasks/task.model';
import { info } from 'electron-log/main';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { loadSimpleStoreAll, saveSimpleStore } from '../simple-store';

let taskWidgetWin: BrowserWindow | null = null;
let isTaskWidgetEnabled = false;
let isAlwaysShow = false;
let currentTask: TaskCopy | null = null;
let isPomodoroEnabled = false;
let currentPomodoroSessionTime = 0;
let isFocusModeEnabled = false;
let currentFocusSessionTime = 0;
let initTimeoutId: NodeJS.Timeout | null = null;
let currentOpacity = 95;
let listenersRegistered = false;
let isCreatingWindow = false;

const TASK_WIDGET_BOUNDS_KEY = 'taskWidgetBounds';
const LEGACY_BOUNDS_KEY = 'overlayBounds';
let boundsDebounceTimer: NodeJS.Timeout | null = null;

export const updateTaskWidgetEnabled = (isEnabled: boolean): void => {
  isTaskWidgetEnabled = isEnabled;

  if (isEnabled && !taskWidgetWin && !isCreatingWindow) {
    initListeners();
    createTaskWidgetWindow().then(() => {
      // Request current task state after window is ready
      const mainWindow = BrowserWindow.getAllWindows().find(
        (win) => win !== taskWidgetWin,
      );
      if (mainWindow) {
        mainWindow.webContents.send(IPC.REQUEST_CURRENT_TASK_FOR_TASK_WIDGET);
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

  // Clear bounds debounce timer
  if (boundsDebounceTimer) {
    clearTimeout(boundsDebounceTimer);
    boundsDebounceTimer = null;
  }

  // Disable task widget to prevent close event prevention
  isTaskWidgetEnabled = false;
  isCreatingWindow = false;

  // Remove IPC listeners
  ipcMain.removeAllListeners('task-widget-show-main-window');
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
  const { width: screenWidth } = primaryDisplay.workAreaSize;
  const defaultBounds = { width: 300, height: 80, x: screenWidth - 320, y: 20 };

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
      bounds = isOnScreen ? saved : defaultBounds;
    }
  } catch (_e) {
    // Use defaults (file may not exist on first run)
  }

  isCreatingWindow = false;
  taskWidgetWin = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    title: 'Super Productivity Task Widget',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minWidth: 60,
    minHeight: 24,
    maxWidth: 700,
    maxHeight: 120,
    minimizable: false,
    maximizable: false,
    closable: true, // Ensure window is closable
    hasShadow: false, // Disable shadow with transparent windows
    autoHideMenuBar: true,
    roundedCorners: false, // Disable rounded corners for better compatibility
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
    const mainWindow = BrowserWindow.getAllWindows().find((win) => win !== taskWidgetWin);
    if (mainWindow) {
      mainWindow.webContents.send(IPC.REQUEST_CURRENT_TASK_FOR_TASK_WIDGET);
    }
    // Don't show task widget here - it should only show when main window is minimized
  });

  const persistBoundsDebounced = (): void => {
    if (boundsDebounceTimer) clearTimeout(boundsDebounceTimer);
    boundsDebounceTimer = setTimeout(() => {
      if (taskWidgetWin && !taskWidgetWin.isDestroyed()) {
        saveSimpleStore(TASK_WIDGET_BOUNDS_KEY, taskWidgetWin.getBounds());
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
        taskWidgetWin.show();
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
    taskWidgetWin.show();
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

const initListeners = (): void => {
  if (listenersRegistered) {
    return;
  }
  listenersRegistered = true;

  // Listen for show main window request
  ipcMain.on('task-widget-show-main-window', () => {
    const mainWindow = BrowserWindow.getAllWindows().find((win) => win !== taskWidgetWin);
    if (mainWindow) {
      // Mirror showOrFocus() logic: restore() before show() to handle the case where
      // the window is minimized+hidden (e.g. minimize-to-tray on Linux where
      // event.preventDefault() on 'minimize' has no effect).
      mainWindow.restore();
      mainWindow.show();
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
  isAlwaysShow = alwaysShow;
};

export const getIsTaskWidgetAlwaysShow = (): boolean => isAlwaysShow;

export const updateTaskWidgetOpacity = (opacity: number): void => {
  currentOpacity = opacity;
  if (!taskWidgetWin || taskWidgetWin.isDestroyed()) {
    return;
  }
  // Send opacity to renderer as CSS variable (works on all platforms)
  const cssOpacity = Math.max(0.1, Math.min(1, opacity / 100));
  taskWidgetWin.webContents.send('update-opacity', cssOpacity);
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
