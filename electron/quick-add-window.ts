import { app, BrowserWindow, IpcMainInvokeEvent, ipcMain, screen } from 'electron';
import { join, normalize } from 'path';
import { error } from 'electron-log/main';
import { IS_MAC } from './common.const';
import { getIsAppReady, getWinSafe } from './main-window';
import { isAppOriginUrl } from './navigation-guard';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { showOrFocus } from './various-shared';
import type {
  AddTaskPayload,
  AddTaskSubmitResult,
} from '../src/app/features/tasks/add-task-bar/add-task-payload-builder';
import type { QuickAddSnapshotResult } from '../src/app/features/tasks/add-task-bar/quick-add-hud.model';

let quickAddWin: BrowserWindow | null = null;
let loadUrl: string | undefined;
let wasMainWinFocused = false;
let mainWinWasVisible = false;
let isHidingProgrammatically = false;
let isQuickAddOpenedQueued = false;
let isQuickAddBridgeReady = false;
let requestCounter = 0;

const QUICK_ADD_WINDOW_WIDTH = 800;
const QUICK_ADD_WINDOW_HEIGHT = 420;
const QUICK_ADD_SCREEN_MARGIN = 16;
const QUICK_ADD_VERTICAL_OFFSET_FACTOR = 0.16;

type PendingRequest<T> = Readonly<{
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}>;

const pendingTaskSubmitRequests = new Map<string, PendingRequest<AddTaskSubmitResult>>();
const pendingSnapshotRequests = new Map<string, PendingRequest<QuickAddSnapshotResult>>();

export const initQuickAddWindow = (isDev: boolean, appUrl: string | undefined): void => {
  loadUrl =
    appUrl ||
    (isDev
      ? 'http://localhost:4200'
      : `file://${normalize(join(__dirname, '../.tmp/angular-dist/browser/index.html'))}`);

  ipcMain.on(IPC.QUICK_ADD_CLOSE, (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== quickAddWin) {
      return;
    }
    hideQuickAddWindow(true);
  });
  ipcMain.on(IPC.QUICK_ADD_SHOW, (event) => {
    if (!_isMainWindowSender(event.sender)) {
      return;
    }
    showQuickAddWindow();
  });

  ipcMain.handle(IPC.QUICK_ADD_TASK_SUBMIT_REQUEST, (event, payload: AddTaskPayload) =>
    _forwardQuickAddTaskSubmit(event, payload),
  );
  ipcMain.handle(IPC.QUICK_ADD_SNAPSHOT_REQUEST, (event) =>
    _forwardQuickAddSnapshotRequest(event),
  );

  ipcMain.on(IPC.QUICK_ADD_BRIDGE_READY, (event) => {
    if (!_isMainWindowSender(event.sender)) {
      return;
    }
    isQuickAddBridgeReady = true;
  });
  ipcMain.on(IPC.QUICK_ADD_TASK_SUBMIT_BRIDGE_READY, (event) => {
    if (!_isMainWindowSender(event.sender)) {
      return;
    }
    isQuickAddBridgeReady = true;
  });

  ipcMain.on(IPC.QUICK_ADD_TASK_SUBMIT_RESPONSE, (event, response) => {
    if (!_isMainWindowSender(event.sender)) {
      return;
    }
    _resolvePending(pendingTaskSubmitRequests, response);
  });
  ipcMain.on(IPC.QUICK_ADD_SNAPSHOT_RESPONSE, (event, response) => {
    if (!_isMainWindowSender(event.sender)) {
      return;
    }
    _resolvePending(pendingSnapshotRequests, response);
  });
};

export const destroyQuickAddWindow = (): void => {
  ipcMain.removeAllListeners(IPC.QUICK_ADD_CLOSE);
  ipcMain.removeAllListeners(IPC.QUICK_ADD_SHOW);
  ipcMain.removeHandler(IPC.QUICK_ADD_TASK_SUBMIT_REQUEST);
  ipcMain.removeHandler(IPC.QUICK_ADD_SNAPSHOT_REQUEST);
  ipcMain.removeAllListeners(IPC.QUICK_ADD_BRIDGE_READY);
  ipcMain.removeAllListeners(IPC.QUICK_ADD_TASK_SUBMIT_BRIDGE_READY);
  ipcMain.removeAllListeners(IPC.QUICK_ADD_TASK_SUBMIT_RESPONSE);
  ipcMain.removeAllListeners(IPC.QUICK_ADD_SNAPSHOT_RESPONSE);
  _rejectAllPending(new Error('Quick Add window destroyed'));
  isQuickAddOpenedQueued = false;
  isQuickAddBridgeReady = false;

  if (quickAddWin && !quickAddWin.isDestroyed()) {
    try {
      quickAddWin.destroy();
    } catch (e) {
      error('Error destroying quick-add window:', e);
    }
  }
  quickAddWin = null;
};

export const showQuickAddWindow = (): void => {
  const mainWin = getWinSafe();
  if (!getIsAppReady()) {
    if (mainWin && !mainWin.isDestroyed()) {
      showOrFocus(mainWin);
    }
    return;
  }
  if (!isQuickAddBridgeReady) {
    return;
  }

  if (!quickAddWin || quickAddWin.isDestroyed()) {
    createQuickAddWindow();
  }

  const activeWin = BrowserWindow.getFocusedWindow();
  wasMainWinFocused = !!activeWin && activeWin !== quickAddWin;

  if (IS_MAC) {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWinWasVisible = mainWin.isVisible() && !mainWin.isMinimized();
      if (!wasMainWinFocused) {
        mainWin.hide();
      }
    } else {
      mainWinWasVisible = false;
    }
  }

  if (quickAddWin) {
    const { x, y, width, height } = _getQuickAddWindowBounds();
    quickAddWin.setBounds({ width, height, x, y });
    quickAddWin.show();
    quickAddWin.focus();
    _sendQuickAddOpened();
  }
};

export const hideQuickAddWindow = (isProgrammatic = false): void => {
  if (!quickAddWin || quickAddWin.isDestroyed() || !quickAddWin.isVisible()) {
    return;
  }

  if (isProgrammatic) {
    isHidingProgrammatically = true;
  }

  quickAddWin.hide();
  _rejectAllPending(new Error('Quick Add window hidden'));

  if (IS_MAC) {
    const mainWin = getWinSafe();
    if (mainWinWasVisible && mainWin && !mainWin.isDestroyed()) {
      if (wasMainWinFocused) {
        mainWin.show();
      } else {
        mainWin.showInactive();
      }
    }

    if (!wasMainWinFocused) {
      app.hide();
    }
  }

  isHidingProgrammatically = false;
};

const createQuickAddWindow = (): void => {
  if (quickAddWin && !quickAddWin.isDestroyed()) {
    return;
  }

  const { x, y, width, height } = _getQuickAddWindowBounds();
  quickAddWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    title: 'Super Productivity Quick Add',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      devTools: false,
      scrollBounce: false,
      backgroundThrottling: false,
      webSecurity: true,
      preload: join(__dirname, 'quick-add-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      disableDialogs: true,
    },
  });

  const quickAddUrl = _buildQuickAddUrl(loadUrl);
  quickAddWin.loadURL(quickAddUrl);
  quickAddWin.webContents.on('will-navigate', (ev, navUrl) => {
    if (loadUrl && isAppOriginUrl(navUrl, loadUrl)) {
      return;
    }
    ev.preventDefault();
  });
  quickAddWin.webContents.on('will-redirect', (ev, navUrl) => {
    if (loadUrl && isAppOriginUrl(navUrl, loadUrl)) {
      return;
    }
    ev.preventDefault();
  });
  quickAddWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  quickAddWin.webContents.on('context-menu', (ev) => ev.preventDefault());
  quickAddWin.on('blur', () => {
    if (!isHidingProgrammatically) {
      hideQuickAddWindow(false);
    }
  });
  quickAddWin.on('closed', () => {
    _rejectAllPending(new Error('Quick Add window closed'));
    isQuickAddOpenedQueued = false;
    quickAddWin = null;
  });
};

const _sendQuickAddOpened = (): void => {
  if (!quickAddWin || quickAddWin.isDestroyed()) {
    return;
  }
  const sendOpened = (): void => {
    setTimeout(() => {
      if (quickAddWin && !quickAddWin.isDestroyed()) {
        quickAddWin.webContents.send(IPC.QUICK_ADD_OPENED);
      }
    });
  };
  if (quickAddWin.webContents.isLoading()) {
    if (isQuickAddOpenedQueued) {
      return;
    }
    isQuickAddOpenedQueued = true;
    quickAddWin.webContents.once('did-finish-load', () => {
      isQuickAddOpenedQueued = false;
      sendOpened();
    });
    return;
  }
  sendOpened();
};

const _getQuickAddWindowBounds = (): {
  x: number;
  y: number;
  width: number;
  height: number;
} => {
  const displayBounds = _getActiveDisplayBounds();
  const horizontalMargin = QUICK_ADD_SCREEN_MARGIN * 2;
  const verticalMargin = QUICK_ADD_SCREEN_MARGIN * 2;
  const maxWidth = displayBounds.width - horizontalMargin;
  const maxHeight = displayBounds.height - verticalMargin;
  const width = Math.min(QUICK_ADD_WINDOW_WIDTH, Math.max(0, maxWidth));
  const height = Math.min(QUICK_ADD_WINDOW_HEIGHT, Math.max(0, maxHeight));
  const centeredX = (displayBounds.width - width) / 2;
  const offsetY = displayBounds.height * QUICK_ADD_VERTICAL_OFFSET_FACTOR;

  return {
    width,
    height,
    x: Math.round(displayBounds.x + centeredX),
    y: Math.round(displayBounds.y + offsetY),
  };
};

const _getActiveDisplayBounds = (): {
  x: number;
  y: number;
  width: number;
  height: number;
} => {
  try {
    const cursorPoint = screen.getCursorScreenPoint();
    return screen.getDisplayNearestPoint(cursorPoint).bounds;
  } catch (e) {
    error('Error getting cursor display, falling back to primary display:', e);
    return screen.getPrimaryDisplay().bounds;
  }
};

const _buildQuickAddUrl = (baseUrl: string | undefined): string => {
  if (!baseUrl) {
    throw new Error('Quick Add load URL is not configured');
  }
  const url = new URL(baseUrl);
  url.searchParams.set('quickAdd', '1');
  url.hash = '/quick-add';
  return url.toString();
};

const _forwardQuickAddTaskSubmit = async (
  event: IpcMainInvokeEvent,
  payload: AddTaskPayload,
): Promise<AddTaskSubmitResult> => {
  if (BrowserWindow.fromWebContents(event.sender) !== quickAddWin) {
    throw new Error('Unauthorized quick-add IPC sender');
  }

  const mainWin = getWinSafe();
  if (!mainWin || mainWin.isDestroyed() || !getIsAppReady()) {
    throw new Error('Main window is not ready');
  }
  if (!isQuickAddBridgeReady) {
    throw new Error('Quick Add bridge is not ready');
  }

  const requestId = `quick-add-task-${++requestCounter}`;
  return new Promise<AddTaskSubmitResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingTaskSubmitRequests.delete(requestId);
      reject(new Error('Quick Add task submit timed out'));
    }, 5000);
    pendingTaskSubmitRequests.set(requestId, { resolve, reject, timer });
    mainWin.webContents.send(IPC.QUICK_ADD_TASK_SUBMIT_REQUEST, {
      requestId,
      payload,
    });
  });
};

const _forwardQuickAddSnapshotRequest = async (
  event: IpcMainInvokeEvent,
): Promise<QuickAddSnapshotResult> => {
  if (BrowserWindow.fromWebContents(event.sender) !== quickAddWin) {
    throw new Error('Unauthorized quick-add IPC sender');
  }

  const mainWin = getWinSafe();
  if (!mainWin || mainWin.isDestroyed() || !getIsAppReady()) {
    throw new Error('Main window is not ready');
  }
  if (!isQuickAddBridgeReady) {
    throw new Error('Quick Add bridge is not ready');
  }

  const requestId = `quick-add-snapshot-${++requestCounter}`;
  return new Promise<QuickAddSnapshotResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingSnapshotRequests.delete(requestId);
      reject(new Error('Quick Add snapshot request timed out'));
    }, 5000);
    pendingSnapshotRequests.set(requestId, { resolve, reject, timer });
    mainWin.webContents.send(IPC.QUICK_ADD_SNAPSHOT_REQUEST, {
      requestId,
    });
  });
};

const _isMainWindowSender = (sender: Electron.WebContents): boolean => {
  const mainWin = getWinSafe();
  return !!mainWin && !mainWin.isDestroyed() && sender === mainWin.webContents;
};

const _resolvePending = <T>(
  pending: Map<string, PendingRequest<T>>,
  response: { requestId?: string; payload?: T },
): void => {
  if (!response.requestId) {
    return;
  }
  const request = pending.get(response.requestId);
  if (!request) {
    return;
  }
  pending.delete(response.requestId);
  clearTimeout(request.timer);
  if (!('payload' in response)) {
    request.reject(new Error('Quick Add IPC response is missing payload'));
    return;
  }
  request.resolve(response.payload);
};

const _rejectAllPending = (reason: unknown): void => {
  pendingTaskSubmitRequests.forEach((request) => {
    clearTimeout(request.timer);
    request.reject(reason);
  });
  pendingTaskSubmitRequests.clear();
  pendingSnapshotRequests.forEach((request) => {
    clearTimeout(request.timer);
    request.reject(reason);
  });
  pendingSnapshotRequests.clear();
};
