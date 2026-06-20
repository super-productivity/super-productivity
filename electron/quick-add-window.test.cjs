const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const quickAddWindowModulePath = path.resolve(__dirname, 'quick-add-window.ts');
const { IPC } = require(
  path.resolve(__dirname, 'shared-with-frontend/ipc-events.const.ts'),
);

let listeners;
let handlers;
let createdWindows;
let mainWin;
let isAppReady;
let showOrFocusCalls;
let loadedMod;

class FakeWebContents {
  constructor(owner) {
    this.owner = owner;
    this.sent = [];
    this._isLoading = false;
    this._listeners = new Map();
    this._onceListeners = new Map();
  }

  send(channel, payload) {
    this.sent.push({ channel, payload });
  }

  on(channel, listener) {
    this._listeners.set(channel, listener);
  }

  once(channel, listener) {
    this._onceListeners.set(channel, listener);
  }

  emit(channel) {
    const listener = this._listeners.get(channel);
    if (listener) listener();
    const onceListener = this._onceListeners.get(channel);
    if (onceListener) {
      this._onceListeners.delete(channel);
      onceListener();
    }
  }

  isLoading() {
    return this._isLoading;
  }

  getURL() {
    return this.owner.url;
  }

  setWindowOpenHandler() {}
}

class FakeBrowserWindow {
  constructor(options) {
    this.options = options;
    this._destroyed = false;
    this._visible = false;
    this.webContents = new FakeWebContents(this);
    this._listeners = new Map();
    createdWindows.push(this);
  }

  static fromWebContents(webContents) {
    return webContents.owner || null;
  }

  static getFocusedWindow() {
    return mainWin;
  }

  loadURL(url) {
    this.url = url;
  }

  setBounds(bounds) {
    this.bounds = bounds;
  }

  show() {
    this._visible = true;
  }

  focus() {
    this.focused = true;
  }

  hide() {
    this._visible = false;
  }

  destroy() {
    this._destroyed = true;
    this.emit('closed');
  }

  isVisible() {
    return this._visible;
  }

  isDestroyed() {
    return this._destroyed;
  }

  isMinimized() {
    return false;
  }

  on(channel, listener) {
    this._listeners.set(channel, listener);
  }

  emit(channel) {
    const listener = this._listeners.get(channel);
    if (listener) listener();
  }
}

const createMainWindow = () => ({
  webContents: new FakeWebContents({ id: 'main' }),
  isDestroyed: () => false,
  isVisible: () => true,
  isMinimized: () => false,
  hide: () => {},
  show: () => {},
  showInactive: () => {},
});

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { hide: () => {} },
        BrowserWindow: FakeBrowserWindow,
        ipcMain: {
          handle: (channel, listener) => handlers.set(channel, listener),
          on: (channel, listener) => listeners.set(channel, listener),
          removeHandler: (channel) => handlers.delete(channel),
          removeAllListeners: (channel) => listeners.delete(channel),
        },
        screen: {
          getCursorScreenPoint: () => ({ x: 0, y: 0 }),
          getDisplayNearestPoint: () => ({
            bounds: { x: 0, y: 0, width: 800, height: 600 },
          }),
          getPrimaryDisplay: () => ({
            bounds: { x: 0, y: 0, width: 800, height: 600 },
          }),
        },
      };
    }
    if (request === 'electron-log/main') {
      return { error: () => {}, log: () => {} };
    }
    if (request.endsWith('main-window')) {
      return {
        getIsAppReady: () => isAppReady,
        getWinSafe: () => mainWin,
      };
    }
    if (request.endsWith('common.const')) {
      return { IS_MAC: false };
    }
    if (request.endsWith('various-shared')) {
      return {
        showOrFocus: (win) => showOrFocusCalls.push(win),
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const loadModule = () => {
  delete require.cache[require.resolve(quickAddWindowModulePath)];
  Object.keys(require.cache)
    .filter((cachePath) => cachePath.endsWith('/electron/quick-add-window.ts'))
    .forEach((cachePath) => delete require.cache[cachePath]);
  loadedMod = require(quickAddWindowModulePath);
  return loadedMod;
};

const markBridgeReady = () => {
  listeners.get(IPC.QUICK_ADD_BRIDGE_READY)({
    sender: mainWin.webContents,
  });
};

test.beforeEach(() => {
  listeners = new Map();
  handlers = new Map();
  createdWindows = [];
  mainWin = createMainWindow();
  isAppReady = false;
  showOrFocusCalls = [];
  loadedMod = undefined;
  installMocks();
});

test.afterEach(() => {
  if (loadedMod) {
    loadedMod.destroyQuickAddWindow();
  }
  Module._load = originalModuleLoad;
});

test('showQuickAddWindow does not create HUD before the main app is ready', () => {
  const mod = loadModule();
  mod.initQuickAddWindow(true, 'http://localhost:4200');

  mod.showQuickAddWindow();

  assert.equal(createdWindows.length, 0);
  assert.deepEqual(showOrFocusCalls, [mainWin]);
});

test('quick-add window uses compact transparent bounds and the minimal preload', () => {
  const mod = loadModule();
  mod.initQuickAddWindow(true, 'http://localhost:4200');
  isAppReady = true;
  markBridgeReady();

  mod.showQuickAddWindow();

  const quickAddWin = createdWindows[0];
  assert.equal(quickAddWin.options.transparent, true);
  assert.equal(quickAddWin.options.webPreferences.devTools, false);
  assert.equal(
    path.basename(quickAddWin.options.webPreferences.preload),
    'quick-add-preload.js',
  );
  assert.equal(quickAddWin.url, 'http://localhost:4200/?quickAdd=1#/quick-add');
  assert.equal(quickAddWin.options.width, 768);
  assert.equal(quickAddWin.options.height, 420);
  assert.deepEqual(quickAddWin.bounds, { width: 768, height: 420, x: 16, y: 96 });
});

test('quick-add close IPC is accepted only from the quick-add window sender', () => {
  const mod = loadModule();
  mod.initQuickAddWindow(true, 'http://localhost:4200');
  isAppReady = true;
  markBridgeReady();
  mod.showQuickAddWindow();

  const quickAddWin = createdWindows[0];
  listeners.get(IPC.QUICK_ADD_CLOSE)({
    sender: { owner: { id: 'other-window' } },
  });

  assert.equal(quickAddWin.isVisible(), true);

  listeners.get(IPC.QUICK_ADD_CLOSE)({
    sender: quickAddWin.webContents,
  });

  assert.equal(quickAddWin.isVisible(), false);
});

test('quick-add show IPC opens the Quick Add HUD', () => {
  const mod = loadModule();
  mod.initQuickAddWindow(true, 'http://localhost:4200');
  isAppReady = true;
  markBridgeReady();

  listeners.get(IPC.QUICK_ADD_SHOW)({
    sender: mainWin.webContents,
  });

  assert.equal(createdWindows.length, 1);
  assert.equal(createdWindows[0].isVisible(), true);
});

test('quick-add show IPC rejects non-main window senders', () => {
  const mod = loadModule();
  mod.initQuickAddWindow(true, 'http://localhost:4200');
  isAppReady = true;

  listeners.get(IPC.QUICK_ADD_SHOW)({
    sender: { owner: { id: 'other-window' } },
  });

  assert.equal(createdWindows.length, 0);
});

test('quick-add task submit fails fast before the main bridge is ready', async () => {
  const mod = loadModule();
  mod.initQuickAddWindow(true, 'http://localhost:4200');
  isAppReady = true;
  mod.showQuickAddWindow();

  assert.equal(createdWindows.length, 0);
  assert.equal(mainWin.webContents.sent.length, 0);
});

test('quick-add task submit bridge readiness is accepted only from main window', async () => {
  const mod = loadModule();
  mod.initQuickAddWindow(true, 'http://localhost:4200');
  isAppReady = true;
  const payload = {
    title: 'HUD task',
    taskData: { projectId: 'INBOX_PROJECT' },
    isAddToBacklog: false,
    isAddToBottom: false,
    remindOption: 'DoNotRemind',
    repeatQuickSetting: null,
  };

  listeners.get(IPC.QUICK_ADD_BRIDGE_READY)({
    sender: { owner: { id: 'other-window' } },
  });
  mod.showQuickAddWindow();

  assert.equal(createdWindows.length, 0);

  listeners.get(IPC.QUICK_ADD_BRIDGE_READY)({
    sender: mainWin.webContents,
  });
  mod.showQuickAddWindow();

  const quickAddWin = createdWindows[0];
  const submitPromise = handlers.get(IPC.QUICK_ADD_TASK_SUBMIT_REQUEST)(
    {
      sender: quickAddWin.webContents,
    },
    payload,
  );
  const forwarded = mainWin.webContents.sent[0];
  listeners.get(IPC.QUICK_ADD_TASK_SUBMIT_RESPONSE)(
    {
      sender: mainWin.webContents,
    },
    {
      requestId: forwarded.payload.requestId,
      payload: { ok: true, taskId: 'task-1' },
    },
  );

  assert.deepEqual(await submitPromise, { ok: true, taskId: 'task-1' });
});

test('quick-add task submit is forwarded to the main window and resolves from main response', async () => {
  const mod = loadModule();
  mod.initQuickAddWindow(true, 'http://localhost:4200');
  isAppReady = true;
  markBridgeReady();
  mod.showQuickAddWindow();

  const quickAddWin = createdWindows[0];
  const payload = {
    title: 'HUD task',
    taskData: { projectId: 'INBOX_PROJECT' },
    isAddToBacklog: false,
    isAddToBottom: false,
    remindOption: 'DoNotRemind',
    repeatQuickSetting: null,
  };

  const submitPromise = handlers.get(IPC.QUICK_ADD_TASK_SUBMIT_REQUEST)(
    {
      sender: quickAddWin.webContents,
    },
    payload,
  );

  const forwarded = mainWin.webContents.sent[0];
  assert.equal(forwarded.channel, IPC.QUICK_ADD_TASK_SUBMIT_REQUEST);
  assert.deepEqual(forwarded.payload.payload, payload);

  listeners.get(IPC.QUICK_ADD_TASK_SUBMIT_RESPONSE)(
    {
      sender: mainWin.webContents,
    },
    {
      requestId: forwarded.payload.requestId,
      payload: { ok: true, taskId: 'task-1' },
    },
  );

  assert.deepEqual(await submitPromise, { ok: true, taskId: 'task-1' });
});

test('quick-add snapshot request is forwarded to the main window and resolves from main response', async () => {
  const mod = loadModule();
  mod.initQuickAddWindow(true, 'http://localhost:4200');
  isAppReady = true;
  markBridgeReady();
  mod.showQuickAddWindow();

  const quickAddWin = createdWindows[0];
  const snapshotPromise = handlers.get(IPC.QUICK_ADD_SNAPSHOT_REQUEST)({
    sender: quickAddWin.webContents,
  });

  const forwarded = mainWin.webContents.sent[0];
  assert.equal(forwarded.channel, IPC.QUICK_ADD_SNAPSHOT_REQUEST);

  listeners.get(IPC.QUICK_ADD_SNAPSHOT_RESPONSE)(
    {
      sender: mainWin.webContents,
    },
    {
      requestId: forwarded.payload.requestId,
      payload: { ok: false, error: 'not ready' },
    },
  );

  assert.deepEqual(await snapshotPromise, { ok: false, error: 'not ready' });
});

test('quick-add snapshot request rejects non-HUD senders', async () => {
  const mod = loadModule();
  mod.initQuickAddWindow(true, 'http://localhost:4200');
  isAppReady = true;
  markBridgeReady();
  mod.showQuickAddWindow();

  await assert.rejects(
    () =>
      handlers.get(IPC.QUICK_ADD_SNAPSHOT_REQUEST)({
        sender: { owner: { id: 'other-window' } },
      }),
    /Unauthorized quick-add IPC sender/,
  );
});

test('quick-add task submit rejects non-HUD senders', async () => {
  const mod = loadModule();
  mod.initQuickAddWindow(true, 'http://localhost:4200');
  isAppReady = true;
  markBridgeReady();
  mod.showQuickAddWindow();

  await assert.rejects(
    () =>
      handlers.get(IPC.QUICK_ADD_TASK_SUBMIT_REQUEST)(
        {
          sender: { owner: { id: 'other-window' } },
        },
        {
          title: 'bad',
          taskData: {},
          isAddToBacklog: false,
          isAddToBottom: false,
          remindOption: 'DO_NOT_REMIND',
          repeatQuickSetting: null,
        },
      ),
    /Unauthorized quick-add IPC sender/,
  );
});
