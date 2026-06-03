const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const taskWidgetModulePath = path.resolve(__dirname, 'task-widget/task-widget.ts');

let createdWindows = [];

class FakeWebContents {
  on() {}
  send() {}
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
  hide() {
    this._visible = false;
    this.hideCount += 1;
  }
}

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        BrowserWindow: FakeBrowserWindow,
        ipcMain: { on: () => {}, removeAllListeners: () => {} },
        screen: {
          getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
          getDisplayMatching: () => ({
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          }),
        },
      };
    }
    if (request === 'electron-log/main') {
      return { info: () => {} };
    }
    if (request.endsWith('simple-store')) {
      return {
        loadSimpleStoreAll: async () => ({}),
        saveSimpleStore: () => {},
      };
    }
    if (request.endsWith('common.const')) {
      return { IS_MAC: false };
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
  createdWindows = [];
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
  assert.equal(win.showCount, 1);
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
