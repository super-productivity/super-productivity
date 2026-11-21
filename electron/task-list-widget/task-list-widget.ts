import { BrowserWindow, ipcMain, IpcMainEvent, screen } from 'electron';
import { join } from 'path';
import { error } from 'electron-log/main';
import { getWin } from '../main-window';
import { assertSecureWebPreferences } from '../web-preferences-guard';
import { loadSimpleStoreAll, saveSimpleStore } from '../simple-store';
import {
  clampBoundsToDisplay,
  parseStoredBounds,
  WindowBounds,
} from '../window-restore-bounds';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { TaskListWidgetContent } from '../shared-with-frontend/task-list-widget.model';
import { TaskWidgetConfig } from '../../src/app/features/config/global-config.model';

const BOUNDS_KEY = 'taskListWidgetBounds';
const COLLAPSED_HEIGHT = 48;
let widget: BrowserWindow | null = null;
let enabled = false;
let collapsed = false;
let filter: 'all' | 'today' = 'all';
let opacity = 95;
let expandedBounds: WindowBounds | null = null;
let content: TaskListWidgetContent | null = null;
let generation = 0;
let creating = false;
let initialized = false;
let boundsTimer: ReturnType<typeof setTimeout> | undefined;

const sendState = (): void => {
  if (widget && !widget.isDestroyed() && content) {
    widget.webContents.send('task-list-widget-state', {
      ...content,
      filter,
      isCollapsed: collapsed,
    });
  }
};

const persistBounds = (): void => {
  if (!widget || widget.isDestroyed()) return;
  const bounds = widget.getBounds();
  expandedBounds = {
    ...bounds,
    height: collapsed ? (expandedBounds?.height ?? 480) : bounds.height,
  };
  void saveSimpleStore(BOUNDS_KEY, expandedBounds).catch(() =>
    error('Failed to persist task list widget bounds'),
  );
};

const scheduleBoundsSave = (): void => {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(persistBounds, 250);
};

const applyCollapsed = (): void => {
  if (!widget || widget.isDestroyed() || !expandedBounds) return;
  const current = widget.getBounds();
  widget.setMinimumSize(320, collapsed ? COLLAPSED_HEIGHT : 200);
  widget.setResizable(!collapsed);
  const next = {
    ...current,
    height: collapsed ? COLLAPSED_HEIGHT : expandedBounds.height,
  };
  widget.setBounds(clampBoundsToDisplay(next, screen.getDisplayMatching(next).workArea));
};

const updateSettings = (partial: Partial<TaskWidgetConfig>): void => {
  getWin().webContents.send(IPC.TASK_LIST_WIDGET_SETTINGS_CHANGED, partial);
};

export const destroyTaskListWidget = (): void => {
  persistBounds();
  enabled = false;
  generation++;
  creating = false;
  clearTimeout(boundsTimer);
  const old = widget;
  widget = null;
  content = null;
  old?.destroy();
};

const createWidget = async (): Promise<void> => {
  if (widget || creating || !enabled) return;
  creating = true;
  const expectedGeneration = generation;
  try {
    const workArea = screen.getPrimaryDisplay().workArea;
    const fallback = {
      x: workArea.x + workArea.width - 390,
      y: workArea.y + 100,
      width: 370,
      height: 480,
    };
    const store = await loadSimpleStoreAll().catch(() => ({}));
    if (!enabled || generation !== expectedGeneration) return;
    const stored = parseStoredBounds((store as Record<string, unknown>)[BOUNDS_KEY]);
    const preferred = stored ?? fallback;
    preferred.width = Math.max(320, preferred.width);
    preferred.height = Math.max(200, preferred.height);
    expandedBounds = clampBoundsToDisplay(
      preferred,
      screen.getDisplayMatching(preferred).workArea,
    );
    const webPreferences = {
      preload: join(__dirname, 'task-list-widget-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    };
    assertSecureWebPreferences(webPreferences, 'task-list-widget');
    const win = new BrowserWindow({
      ...expandedBounds,
      height: collapsed ? COLLAPSED_HEIGHT : expandedBounds.height,
      title: 'Super Productivity',
      frame: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      minWidth: 320,
      minHeight: collapsed ? COLLAPSED_HEIGHT : 200,
      resizable: !collapsed,
      maximizable: false,
      minimizable: false,
      webPreferences,
    });
    widget = win;
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setOpacity(Math.max(0.1, Math.min(1, opacity / 100)));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.on('did-finish-load', sendState);
    win.once('ready-to-show', () => {
      if (widget === win && enabled) win.showInactive();
    });
    win.on('resize', scheduleBoundsSave);
    win.on('move', scheduleBoundsSave);
    win.on('close', (event) => {
      event.preventDefault();
      updateSettings({ isTaskListEnabled: false });
      destroyTaskListWidget();
    });
    await win.loadFile(join(__dirname, 'task-list-widget.html'));
  } catch {
    error('Failed to create task list widget');
    if (generation === expectedGeneration) destroyTaskListWidget();
  } finally {
    if (generation === expectedGeneration) creating = false;
  }
};

export const applyTaskListWidgetSettings = (cfg: TaskWidgetConfig): void => {
  if (!cfg.isTaskListEnabled) {
    destroyTaskListWidget();
    return;
  }
  enabled = true;
  filter = cfg.taskListFilter === 'today' ? 'today' : 'all';
  opacity = cfg.opacity ?? 95;
  const nextCollapsed = !!cfg.isTaskListCollapsed;
  if (widget && nextCollapsed !== collapsed) {
    persistBounds();
    collapsed = nextCollapsed;
    applyCollapsed();
  } else {
    collapsed = nextCollapsed;
  }
  widget?.setOpacity(Math.max(0.1, Math.min(1, opacity / 100)));
  sendState();
  void createWidget();
};

export const initTaskListWidget = (): void => {
  if (initialized) return;
  initialized = true;
  ipcMain.on(IPC.UPDATE_TASK_WIDGET_SETTINGS, (event, cfg: TaskWidgetConfig) => {
    if (event.sender === getWin().webContents) applyTaskListWidgetSettings(cfg);
  });
  ipcMain.on(IPC.UPDATE_TASK_LIST_WIDGET, (event, next: TaskListWidgetContent) => {
    if (event.sender !== getWin().webContents || !enabled) return;
    content = next;
    sendState();
  });
  const fromWidget = (event: IpcMainEvent): boolean =>
    !!widget &&
    event.sender === widget.webContents &&
    event.senderFrame === widget.webContents.mainFrame;
  ipcMain.on('task-list-widget-filter', (event, value: unknown) => {
    if (fromWidget(event) && (value === 'all' || value === 'today')) {
      updateSettings({ taskListFilter: value });
    }
  });
  ipcMain.on('task-list-widget-collapse', (event) => {
    if (fromWidget(event)) updateSettings({ isTaskListCollapsed: !collapsed });
  });
  ipcMain.on('task-list-widget-hide', (event) => {
    if (fromWidget(event)) {
      updateSettings({ isTaskListEnabled: false });
      destroyTaskListWidget();
    }
  });
  ipcMain.on('task-list-widget-open', (event) => {
    if (!fromWidget(event)) return;
    const main = getWin();
    main.restore();
    main.show();
    main.focus();
  });
};
