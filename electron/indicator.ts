import { App, ipcMain, IpcMainEvent, Menu, nativeTheme, Tray } from 'electron';
import { log } from 'electron-log/main';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { getIsTrayShowCurrentTask, getIsTrayShowCurrentCountdown } from './shared-state';
import { TaskCopy } from '../src/app/features/tasks/task.model';
import { GlobalConfigState } from '../src/app/features/config/global-config.model';
import { release } from 'os';
import {
  initOverlayIndicator,
  updateOverlayEnabled,
  updateOverlayTask,
} from './overlay-indicator/overlay-indicator';
import { getWin } from './main-window';

let tray: Tray;
let _showApp: () => void;
let _quitApp: () => void;
let _todayTasks: {
  id: string;
  title: string;
  timeEstimate: number;
  timeSpent: number;
}[] = [];
let _isRunning: boolean = false;
let _currentTaskId: string | null = null;
let DIR: string;
let shouldUseDarkColors: boolean;

// Caching variables for preventing Linux tray menu flickering
let _lastMsg: string | undefined;
let _lastTrayMsg: string | undefined;
let _lastIsRunning: boolean | undefined;
let _lastCurrentTaskId: string | null | undefined;
let _lastTodayTasksStr: string | undefined;

let _lastCurrentTask: any;
let _lastIsPomodoroEnabled: boolean;
let _lastCurrentPomodoroSessionTime: number;
let _lastIsFocusModeEnabled: boolean;
let _lastCurrentFocusSessionTime: number;
let _lastFocusModeMode: string;

const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
const IS_WINDOWS = process.platform === 'win32';

// Stable GUIDs per Windows distribution type.
// Windows ties tray icon GUIDs to the executable path (when unsigned).
// Different distribution types have different exe paths, so they need
// separate GUIDs to avoid silent tray creation failures.
// WARNING: These GUIDs must never change once deployed per distribution type.
// Changing a GUID makes Windows treat it as a new icon, resetting it to the
// overflow area. Users would have to manually re-show it on the taskbar.
// See: https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-notifyicondataa
const WINDOWS_TRAY_GUIDS = {
  portable: 'f7c06d50-4d3e-4f8d-b9a0-2c8e7f5a1b3d',
  nsis: 'a2512177-8bee-4b70-a0a8-f3d18e0eab90',
  store: '19b9d3fe-aa50-4792-917e-60ada97f3088',
} as const;

const getWindowsTrayGuid = (): string => {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return WINDOWS_TRAY_GUIDS.portable;
  }
  if ((process as NodeJS.Process & { windowsStore?: boolean }).windowsStore) {
    return WINDOWS_TRAY_GUIDS.store;
  }
  return WINDOWS_TRAY_GUIDS.nsis;
};

export const initIndicator = ({
  showApp,
  quitApp,
  app,
  ICONS_FOLDER,
  forceDarkTray,
}: {
  showApp: () => void;
  quitApp: () => void;
  app: App;
  ICONS_FOLDER: string;
  forceDarkTray: boolean;
}): Tray => {
  DIR = ICONS_FOLDER + 'indicator/';
  shouldUseDarkColors =
    forceDarkTray ||
    IS_LINUX ||
    (IS_WINDOWS && !isWindows11()) ||
    nativeTheme.shouldUseDarkColors;

  _showApp = showApp;
  _quitApp = quitApp;

  initAppListeners(app);
  initListeners();

  const suf = shouldUseDarkColors ? '-d.png' : '-l.png';
  const trayIconPath = DIR + `stopped${suf}`;
  if (IS_WINDOWS) {
    try {
      tray = new Tray(trayIconPath, getWindowsTrayGuid());
    } catch (e) {
      log('Tray creation with GUID failed, retrying without GUID:', e);
      tray = new Tray(trayIconPath);
    }
  } else {
    tray = new Tray(trayIconPath);
  }
  tray.setContextMenu(createContextMenu());

  tray.on('click', () => {
    showApp();
  });

  return tray;
};

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function initAppListeners(app: App): void {
  if (tray) {
    app.on('before-quit', () => {
      if (tray) {
        tray.destroy();
      }
    });
  }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function initListeners(): void {
  let isOverlayEnabled = false;
  // Listen for settings updates to handle overlay enable/disable
  ipcMain.on(IPC.UPDATE_SETTINGS, (ev, settings: GlobalConfigState) => {
    const isOverlayEnabledNew = settings?.misc?.isOverlayIndicatorEnabled || false;
    if (isOverlayEnabledNew === isOverlayEnabled) {
      return;
    }

    isOverlayEnabled = isOverlayEnabledNew;
    updateOverlayEnabled(isOverlayEnabled);

    // Initialize overlay without shortcut (overlay doesn't need shortcut, that's for focus mode)
    if (isOverlayEnabled) {
      initOverlayIndicator(isOverlayEnabled);
    }
  });

  ipcMain.on(IPC.SET_PROGRESS_BAR, (ev: IpcMainEvent, { progress }) => {
    const suf = shouldUseDarkColors ? '-d' : '-l';
    if (typeof progress === 'number' && progress > 0 && isFinite(progress)) {
      const f = Math.min(Math.round(progress * 15), 15);
      const t = DIR + `running-anim${suf}/${f || 0}.png`;
      setTrayIcon(tray, t);
    } else {
      const t = DIR + `running${suf}.png`;
      setTrayIcon(tray, t);
    }

    // Also update the context menu and tray title during the progress bar tick
    // This perfectly synchronizes the text "blinking" with the pie chart animation
    if (_lastCurrentTask && tray) {
      const isTrayShowCurrentTask = getIsTrayShowCurrentTask();
      const isTrayShowCurrentCountdown = getIsTrayShowCurrentCountdown();

      const menuMsg = createIndicatorMessage(
        _lastCurrentTask,
        _lastIsPomodoroEnabled || false,
        _lastCurrentPomodoroSessionTime || 0,
        true, // always show countdown in menu
        _lastIsFocusModeEnabled || false,
        _lastCurrentFocusSessionTime || 0,
        _lastFocusModeMode,
      );

      const trayMsg = createIndicatorMessage(
        _lastCurrentTask,
        _lastIsPomodoroEnabled || false,
        _lastCurrentPomodoroSessionTime || 0,
        isTrayShowCurrentCountdown,
        _lastIsFocusModeEnabled || false,
        _lastCurrentFocusSessionTime || 0,
        _lastFocusModeMode,
      );

      const todayTasksStr = JSON.stringify(
        (_todayTasks || []).map((t) => ({ id: t.id, title: t.title })),
      );

      const isMenuChanged =
        menuMsg !== _lastMsg ||
        _isRunning !== _lastIsRunning ||
        _currentTaskId !== _lastCurrentTaskId ||
        todayTasksStr !== _lastTodayTasksStr;

      if (isMenuChanged) {
        tray.setContextMenu(createContextMenu(menuMsg));
        _lastMsg = menuMsg;
        _lastIsRunning = _isRunning;
        _lastCurrentTaskId = _currentTaskId;
        _lastTodayTasksStr = todayTasksStr;
      }

      if (_lastTrayMsg !== trayMsg) {
        if (isTrayShowCurrentTask) {
          tray.setTitle(trayMsg);
          if (!IS_MAC) tray.setToolTip(trayMsg);
        } else {
          tray.setTitle('');
          if (!IS_MAC) tray.setToolTip('');
        }
        _lastTrayMsg = trayMsg;
      }
    }
  });

  ipcMain.on(
    IPC.CURRENT_TASK_UPDATED,
    (
      ev: IpcMainEvent,
      currentTask: any,
      isPomodoroEnabled: boolean,
      currentPomodoroSessionTime: number,
      isFocusModeEnabled: boolean,
      currentFocusSessionTime: number,
      focusModeMode: string,
    ) => {
      _isRunning = !!currentTask;
      _currentTaskId = currentTask ? currentTask.id : null;

      // Store current task details so SET_PROGRESS_BAR can re-render text
      _lastCurrentTask = currentTask;
      _lastIsPomodoroEnabled = isPomodoroEnabled;
      _lastCurrentPomodoroSessionTime = currentPomodoroSessionTime;
      _lastIsFocusModeEnabled = isFocusModeEnabled;
      _lastCurrentFocusSessionTime = currentFocusSessionTime;
      _lastFocusModeMode = focusModeMode;

      updateOverlayTask(
        currentTask,
        isPomodoroEnabled,
        currentPomodoroSessionTime,
        isFocusModeEnabled || false,
        currentFocusSessionTime || 0,
      );

      const isTrayShowCurrentTask = getIsTrayShowCurrentTask();
      const isTrayShowCurrentCountdown = getIsTrayShowCurrentCountdown();

      const menuMsg = currentTask
        ? createIndicatorMessage(
            currentTask,
            isPomodoroEnabled,
            currentPomodoroSessionTime,
            true, // isTrayShowCurrentCountdown: true for context menu to always show timer
            isFocusModeEnabled || false,
            currentFocusSessionTime || 0,
            focusModeMode,
          )
        : '';

      const trayMsg = currentTask
        ? createIndicatorMessage(
            currentTask,
            isPomodoroEnabled,
            currentPomodoroSessionTime,
            isTrayShowCurrentCountdown,
            isFocusModeEnabled || false,
            currentFocusSessionTime || 0,
            focusModeMode,
          )
        : '';

      if (tray) {
        // tray handling
        const todayTasksStr = JSON.stringify(
          (_todayTasks || []).map((t) => ({ id: t.id, title: t.title })),
        );
        const isMenuChanged =
          menuMsg !== _lastMsg ||
          _isRunning !== _lastIsRunning ||
          _currentTaskId !== _lastCurrentTaskId ||
          todayTasksStr !== _lastTodayTasksStr;

        if (isMenuChanged) {
          tray.setContextMenu(createContextMenu(menuMsg));
          _lastMsg = menuMsg;
          _lastIsRunning = _isRunning;
          _lastCurrentTaskId = _currentTaskId;
          _lastTodayTasksStr = todayTasksStr;
        }

        if (_lastTrayMsg !== trayMsg) {
          if (currentTask && currentTask.title) {
            if (isTrayShowCurrentTask) {
              tray.setTitle(trayMsg);
              if (!IS_MAC) {
                // NOTE apparently this has no effect for gnome
                tray.setToolTip(trayMsg);
              }
            } else {
              tray.setTitle('');
              if (!IS_MAC) {
                tray.setToolTip('');
              }
            }
          } else {
            tray.setTitle('');
            if (!IS_MAC) {
              tray.setToolTip('');
            }
            const suf = shouldUseDarkColors ? '-d.png' : '-l.png';
            setTrayIcon(tray, DIR + `stopped${suf}`);
          }
          _lastTrayMsg = trayMsg;
        }
      }
    },
  );

  ipcMain.on(IPC.TODAY_TASKS_UPDATED, (ev: IpcMainEvent, tasks: any[]) => {
    _todayTasks = tasks;
    if (tray) {
      const todayTasksStr = JSON.stringify(
        (_todayTasks || []).map((t) => ({ id: t.id, title: t.title })),
      );
      if (todayTasksStr !== _lastTodayTasksStr) {
        tray.setContextMenu(createContextMenu(_lastMsg));
        _lastTodayTasksStr = todayTasksStr;
      }
    }
  });

  // ipcMain.on(IPC.POMODORO_UPDATE, (ev, params) => {
  // const isOnBreak = params.isOnBreak;
  // const currentSessionTime = params.currentSessionTime;
  // const currentSessionInitialTime = params.currentSessionInitialTime;
  // if (isGnomeShellExtInstalled) {
  //  dbus.updatePomodoro(isOnBreak, currentSessionTime, currentSessionInitialTime);
  // }
  // });
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function createIndicatorMessage(
  task: TaskCopy,
  isPomodoroEnabled: boolean,
  currentPomodoroSessionTime: number,
  isTrayShowCurrentCountdown: boolean,
  isFocusModeEnabled: boolean,
  currentFocusSessionTime: number,
  focusModeMode: string | undefined,
): string {
  if (task && task.title) {
    let timeStr = '';

    if (isTrayShowCurrentCountdown) {
      // Priority 1: Focus mode with countdown/pomodoro (show countdown)
      if (isFocusModeEnabled && focusModeMode && focusModeMode !== 'Flowtime') {
        timeStr = getProgressMessage(currentFocusSessionTime);
        return timeStr;
      }

      // Priority 2: Flowtime mode (show nothing or task estimate)
      if (isFocusModeEnabled && focusModeMode === 'Flowtime') {
        if (task.timeEstimate) {
          const restOfTime = Math.max(task.timeEstimate - task.timeSpent, 0);
          timeStr = getProgressMessage(task.timeSpent, restOfTime, '-');
          return timeStr;
        }
        return getProgressMessage(task.timeSpent);
      }

      // Priority 3: Legacy pomodoro (if still used)
      if (isPomodoroEnabled) {
        timeStr = getProgressMessage(currentPomodoroSessionTime);
        return timeStr;
      }

      // Priority 4: Normal task time (no focus mode)
      if (task.timeEstimate) {
        let restOfTime = task.timeEstimate - task.timeSpent;
        const prefix = restOfTime >= 0 ? '-' : '+';
        restOfTime = Math.abs(restOfTime);
        timeStr = getProgressMessage(task.timeSpent, restOfTime, prefix);
      } else if (task.timeSpent) {
        timeStr = getProgressMessage(task.timeSpent);
      }
      return timeStr;
    }

    // Fallback if no countdown is supposed to be shown, but we have a running task
    return getProgressMessage(task.timeSpent);
  }

  return '';
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function createContextMenu(msg?: string): Menu {
  const template: any[] = [];

  // Either show the time string (if task is running) or "Super Productivity"
  if (msg) {
    template.push({ label: msg, enabled: false });
    template.push({ type: 'separator' });
  }

  if (_todayTasks && _todayTasks.length > 0) {
    _todayTasks.forEach((t) => {
      template.push({
        label: t.title.length > 40 ? t.title.substring(0, 37) + '...' : t.title,
        type: 'radio',
        checked: _currentTaskId === t.id && _isRunning,
        click: () => {
          const mainWindow = getWin();
          if (mainWindow) {
            if (_currentTaskId === t.id) {
              // Clicked the active task again -> toggle start/pause
              mainWindow.webContents.send(IPC.TASK_TOGGLE_START);
            } else {
              // Clicked a different task -> switch to it
              mainWindow.webContents.send(IPC.SWITCH_TASK, t.id);
            }
          }
        },
      });
    });
    template.push({ type: 'separator' });
  }

  template.push({ label: 'Show App', click: _showApp });
  template.push({ label: 'Quit', click: _quitApp });

  return Menu.buildFromTemplate(template);
}

let curIco: string;

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function setTrayIcon(tr: Tray, icoPath: string): void {
  if (icoPath !== curIco) {
    curIco = icoPath;
    tr.setImage(icoPath);
  }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function isWindows11(): boolean {
  if (!IS_WINDOWS) {
    return false;
  }

  const v = release();
  let isWin11 = false;
  if (v.startsWith('11.')) {
    isWin11 = true;
  } else if (v.startsWith('10.')) {
    const ss = v.split('.');
    isWin11 = ss.length > 2 && parseInt(ss[2]) >= 22000 ? true : false;
  }

  return isWin11;
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function getProgressMessage(
  elapsedMs: number,
  diffMs?: number,
  prefix: string = '',
): string {
  const formatTime = (ms: number): string => {
    const numValue = Number(ms) || 0;
    const hours = Math.floor(numValue / 3600000);
    const minutes = Math.floor((numValue - hours * 3600000) / 60000); // eslint-disable-line no-mixed-operators

    const parsed = (hours > 0 ? hours + 'h ' : '') + (minutes > 0 ? minutes + 'm ' : '');

    return parsed.trim() || '0m';
  };

  const elapsedStr = formatTime(elapsedMs);

  if (diffMs !== undefined) {
    // If the difference rounds to exactly 0 minutes, avoid "-0m"
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes === 0) {
      return `${elapsedStr}`;
    }
    const diffStr = formatTime(diffMs);
    return `${elapsedStr} (${prefix}${diffStr})`;
  }

  return elapsedStr;
}
