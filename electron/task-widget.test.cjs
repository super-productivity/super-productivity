const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const taskWidgetModulePath = path.resolve(__dirname, 'task-widget/task-widget.ts');

let createdWindows = [];
let loadSimpleStoreAllImpl;
let ipcHandlers;

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

class FakeWebContents {
  constructor() {
    this.sent = [];
    this._handlers = new Map();
  }
  on(eventName, handler) {
    this._handlers.set(eventName, handler);
  }
  once(eventName, handler) {
    this._handlers.set(eventName, handler);
  }
  emitOnce(eventName) {
    const handler = this._handlers.get(eventName);
    if (handler) handler();
  }
  send(channel, payload) {
    this.sent.push({ channel, payload });
  }
  focus() {}
  isDestroyed() {
    return false;
  }
  removeAllListeners() {}
}

class FakeBrowserWindow {
  constructor() {
    this._visible = false;
    this.showCount = 0;
    this.showInactiveCount = 0;
    this.hideCount = 0;
    this._handlers = new Map();
    this.webContents = new FakeWebContents();
    createdWindows.push(this);
  }

  static getAllWindows() {
    return createdWindows.slice();
  }

  loadFile() {}
  setVisibleOnAllWorkspaces() {}
  setOpacity() {}
  setClosable() {}
  removeAllListeners() {}
  destroy() {}
  on(eventName, handler) {
    this._handlers.set(eventName, handler);
  }
  emit(eventName) {
    const handler = this._handlers.get(eventName);
    if (handler) handler();
  }
  getBounds() {
    return { width: 300, height: 80, x: 0, y: 0 };
  }
  setBounds() {}
  setIgnoreMouseEvents() {}
  isDestroyed() {
    return false;
  }
  isVisible() {
    return this._visible;
  }
  show() {
    this._visible = true;
    this.showCount += 1;
  }
  showInactive() {
    this._visible = true;
    this.showInactiveCount += 1;
  }
  hide() {
    this._visible = false;
    this.hideCount += 1;
  }
}

let cursor;

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        BrowserWindow: FakeBrowserWindow,
        ipcMain: {
          on: (channel, handler) => ipcHandlers.set(channel, handler),
          removeAllListeners: (channel) => ipcHandlers.delete(channel),
        },
        screen: {
          getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
          getDisplayMatching: () => ({
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
          }),
          getDisplayNearestPoint: () => ({
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
          }),
          getCursorScreenPoint: () => cursor,
        },
      };
    }
    if (request === 'electron-log/main') {
      return { info: () => {} };
    }
    if (request.endsWith('simple-store')) {
      return {
        loadSimpleStoreAll: () => loadSimpleStoreAllImpl(),
        saveSimpleStore: () => {},
      };
    }
    if (request.endsWith('common.const')) {
      return { IS_MAC: false, isWaylandEnv: () => false };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const loadModule = () => {
  delete require.cache[taskWidgetModulePath];
  return require(taskWidgetModulePath);
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

test.beforeEach(() => {
  cursor = { x: 5000, y: 5000 };
  createdWindows = [];
  loadSimpleStoreAllImpl = async () => ({});
  ipcHandlers = new Map();
  installMocks();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
});

test('toggleTaskWidgetVisibility is a no-op while the task widget feature is disabled', () => {
  const mod = loadModule();
  mod.toggleTaskWidgetVisibility();
  assert.equal(createdWindows.length, 0, 'no window should be created when disabled');
});

test('toggleTaskWidgetVisibility shows the widget when it is enabled but hidden', async () => {
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  assert.equal(createdWindows.length, 1, 'enabling should create the widget window');
  const win = createdWindows[0];
  assert.equal(win.isVisible(), false, 'widget starts hidden');

  mod.toggleTaskWidgetVisibility();
  assert.equal(win.isVisible(), true, 'toggle should show the hidden widget');
  assert.equal(win.showInactiveCount, 1);
});

test('toggleTaskWidgetVisibility hides the widget when it is enabled and visible', async () => {
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  const win = createdWindows[0];
  mod.showTaskWidget();
  assert.equal(win.isVisible(), true, 'widget should be visible before toggling');

  mod.toggleTaskWidgetVisibility();
  assert.equal(win.isVisible(), false, 'toggle should hide the visible widget');
  assert.equal(win.hideCount, 1);
});

test('forcing the widget visible via the shortcut sets a sticky user-forced flag', async () => {
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  assert.equal(mod.getIsTaskWidgetUserForcedVisible(), false, 'flag starts cleared');

  mod.toggleTaskWidgetVisibility();
  assert.equal(
    mod.getIsTaskWidgetUserForcedVisible(),
    true,
    'showing via the shortcut sets the sticky flag',
  );

  mod.toggleTaskWidgetVisibility();
  assert.equal(
    mod.getIsTaskWidgetUserForcedVisible(),
    false,
    'hiding via the shortcut clears the sticky flag',
  );
});

test('disabling the widget clears the sticky user-forced flag', async () => {
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  mod.toggleTaskWidgetVisibility();
  assert.equal(mod.getIsTaskWidgetUserForcedVisible(), true);

  mod.updateTaskWidgetEnabled(false);
  assert.equal(
    mod.getIsTaskWidgetUserForcedVisible(),
    false,
    'disabling the feature resets the sticky flag',
  );
});

test('disabling clears the sticky flag even when the widget window is absent', () => {
  const mod = loadModule();

  // Enable but do not flush: createTaskWidgetWindow() is mid-flight, so
  // taskWidgetWin is still null (the "absent window" / async re-create gap).
  mod.updateTaskWidgetEnabled(true);

  // User hits the shortcut during that gap — the flag is set without a window.
  mod.toggleTaskWidgetVisibility();
  assert.equal(createdWindows.length, 0, 'no window exists yet');
  assert.equal(
    mod.getIsTaskWidgetUserForcedVisible(),
    true,
    'shortcut sets the sticky flag even without a window',
  );

  // Disabling now must clear the flag even though destroyTaskWidget() is
  // skipped (its guard requires an existing window), or it would leak into
  // the next enable.
  mod.updateTaskWidgetEnabled(false);
  assert.equal(
    mod.getIsTaskWidgetUserForcedVisible(),
    false,
    'disabling clears the flag regardless of whether the window exists',
  );
});

test('disabling while async creation is pending prevents the widget window from being created', async () => {
  const storeLoad = createDeferred();
  loadSimpleStoreAllImpl = () => storeLoad.promise;
  const mod = loadModule();

  mod.updateTaskWidgetEnabled(true);
  mod.updateTaskWidgetEnabled(false);

  storeLoad.resolve({});
  await flush();

  assert.equal(
    createdWindows.length,
    0,
    'disabling before persisted bounds load resolves should cancel window creation',
  );
});

test('shortcut reveal while async creation is pending shows the widget after creation completes', async () => {
  const storeLoad = createDeferred();
  loadSimpleStoreAllImpl = () => storeLoad.promise;
  const mod = loadModule();

  mod.updateTaskWidgetEnabled(true);
  mod.toggleTaskWidgetVisibility();

  storeLoad.resolve({});
  await flush();

  assert.equal(createdWindows.length, 1, 'only the initial in-flight creation is reused');
  assert.equal(
    createdWindows[0].isVisible(),
    true,
    'pending shortcut reveal should show the window once it exists',
  );
});

test('shortcut reveal uses showInactive so the current app keeps focus', async () => {
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  const win = createdWindows[0];
  mod.toggleTaskWidgetVisibility();

  assert.equal(win.showInactiveCount, 1);
  assert.equal(win.showCount, 0);
  assert.equal(win.isVisible(), true, 'widget should still become visible');
});

test('the closed event clears the sticky flag so it does not outlive the window', async () => {
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  const win = createdWindows[0];
  mod.toggleTaskWidgetVisibility();
  assert.equal(mod.getIsTaskWidgetUserForcedVisible(), true);

  win.emit('closed');
  assert.equal(
    mod.getIsTaskWidgetUserForcedVisible(),
    false,
    'closing the window clears the sticky flag',
  );
});

test('the opacity in effect at load time reaches the widget renderer once it finished loading', async () => {
  const mod = loadModule();

  mod.updateTaskWidgetEnabled(true);
  await flush();

  const { webContents } = createdWindows[0];

  // The user's saved opacity arrives while the widget page is still loading.
  // Sending it now is useless: the renderer only registers its `update-opacity`
  // listener when task-widget-renderer.js runs, and ipcRenderer does not replay.
  mod.updateTaskWidgetOpacity(5);
  webContents.sent.length = 0;

  webContents.emitOnce('did-finish-load');

  assert.deepEqual(
    webContents.sent.filter((m) => m.channel === 'update-opacity'),
    // 5 % is below the 10 % floor, so the renderer must get the clamped value.
    [{ channel: 'update-opacity', payload: 0.1 }],
    'the opacity current at load time must reach the renderer exactly once, clamped',
  );
});

const VIEW = { mode: 'tracking', title: 'Write report' };

const sentOn = (win, channel) =>
  win.webContents.sent.filter((message) => message.channel === channel);

test('the latest view reaches the widget, and again after the page finished loading', async () => {
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  const win = createdWindows[0];
  mod.updateTaskWidgetView(VIEW);
  assert.deepEqual(sentOn(win, 'update-view'), [
    { channel: 'update-view', payload: VIEW },
  ]);

  win.webContents.sent.length = 0;
  win.webContents.emitOnce('did-finish-load');

  assert.deepEqual(
    sentOn(win, 'update-view'),
    [{ channel: 'update-view', payload: VIEW }],
    'views sent before the page loaded are dropped, so it must be sent again',
  );
  assert.equal(sentOn(win, 'update-layout').length, 1, 'the layout must arrive too');
});

test('a view that arrives before the window exists is kept for the first load', async () => {
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  mod.updateTaskWidgetView(VIEW);
  await flush();

  const win = createdWindows[0];
  win.webContents.emitOnce('did-finish-load');

  assert.equal(sentOn(win, 'update-view').length, 1);
});

test('the widget buttons reach the main window through the existing task paths', async () => {
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  const mainWindow = new FakeBrowserWindow();
  ipcHandlers.get('task-widget-toggle-task')();
  ipcHandlers.get('task-widget-mark-done')();

  assert.deepEqual(
    mainWindow.webContents.sent.map((message) => message.channel),
    ['TASK_TOGGLE_START', 'TASK_WIDGET_MARK_DONE'],
  );
});

test('the pill follows the width the widget measured for its time', async () => {
  loadSimpleStoreAllImpl = async () => ({
    taskWidgetBounds: { x: 700, y: 0, edge: 'top', centerY: 48 },
  });
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  assert.doesNotThrow(() => ipcHandlers.get('task-widget-time-width')({}, 62));
  assert.doesNotThrow(() => ipcHandlers.get('task-widget-time-width')({}, 'nonsense'));
});

test('clicking the time opens the details and tells the widget', async () => {
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  mod.updateTaskWidgetView(VIEW);
  await flush();

  const win = createdWindows[0];
  win.webContents.sent.length = 0;
  ipcHandlers.get('task-widget-toggle-details')();

  assert.equal(sentOn(win, 'update-layout').at(-1).payload.isOpen, true);
});

test('disabling the widget removes its button listeners', async () => {
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  mod.updateTaskWidgetEnabled(false);

  assert.equal(ipcHandlers.has('task-widget-toggle-task'), false);
  assert.equal(ipcHandlers.has('task-widget-mark-done'), false);
  assert.equal(ipcHandlers.has('task-widget-toggle-details'), false);
  assert.equal(ipcHandlers.has('task-widget-resize-start'), false);
  assert.equal(ipcHandlers.has('task-widget-resize'), false);
  assert.equal(ipcHandlers.has('task-widget-resize-end'), false);
});

test('a docked widget comes back on its edge after a restart', async () => {
  loadSimpleStoreAllImpl = async () => ({
    taskWidgetBounds: { x: 1872, y: 200, edge: 'right', centerY: 244 },
  });
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  const win = createdWindows[0];
  win.webContents.emitOnce('did-finish-load');

  assert.equal(sentOn(win, 'update-layout')[0].payload.dock, 'right');
});

test('a widget stuck to the top comes back there after a restart', async () => {
  loadSimpleStoreAllImpl = async () => ({
    taskWidgetBounds: { x: 700, y: 0, edge: 'top', centerY: 26 },
  });
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  const win = createdWindows[0];
  win.webContents.emitOnce('did-finish-load');

  assert.equal(sentOn(win, 'update-layout')[0].payload.dock, 'top');
});

test('bounds saved by an older version are still understood', async () => {
  loadSimpleStoreAllImpl = async () => ({
    taskWidgetBounds: { x: 400, y: 200, width: 500, height: 90 },
  });
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  const win = createdWindows[0];
  win.webContents.emitOnce('did-finish-load');

  assert.equal(sentOn(win, 'update-layout')[0].payload.dock, null);
  assert.equal(sentOn(win, 'update-layout')[0].payload.width, 500);
});

test('a saved width outside the limits comes back inside them', async () => {
  loadSimpleStoreAllImpl = async () => ({
    taskWidgetBounds: { x: 400, y: 200, width: 60, height: 90 },
  });
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  const win = createdWindows[0];
  win.webContents.emitOnce('did-finish-load');

  assert.equal(sentOn(win, 'update-layout')[0].payload.width, 248);
});

test('a first run starts at the default width', async () => {
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  const win = createdWindows[0];
  win.webContents.emitOnce('did-finish-load');

  assert.equal(sentOn(win, 'update-layout')[0].payload.width, 324);
});

test('dragging an end of the widget changes its width', async () => {
  const mod = loadModule();
  mod.updateTaskWidgetEnabled(true);
  await flush();

  const win = createdWindows[0];
  cursor = { x: 1000, y: 40 };
  ipcHandlers.get('task-widget-resize-start')({}, 'nonsense');
  ipcHandlers.get('task-widget-resize')();
  assert.equal(sentOn(win, 'update-layout').length, 0, 'an unknown side starts nothing');

  ipcHandlers.get('task-widget-resize-start')({}, 'left');
  cursor = { x: 950, y: 40 };
  ipcHandlers.get('task-widget-resize')();
  ipcHandlers.get('task-widget-resize-end')();

  const layout = sentOn(win, 'update-layout').at(-1).payload;
  assert.equal(layout.width, 374);
  assert.equal(layout.isResizing, false);
});
