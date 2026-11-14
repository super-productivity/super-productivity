const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
const modulePath = path.resolve(__dirname, 'menu-bar-panel.ts');
const commonConstPath = path.resolve(__dirname, 'common.const.ts');

let windows = [];
let ipcHandlers = new Map();
let ipcInvokeHandlers = new Map();
let dockCalls = [];
let activationPolicies = [];
let focusCalls = [];
let appFocusCalls = [];
let workArea = { x: 0, y: 25, width: 1440, height: 875 };
let mainWindow = null;

const resetModule = () => {
  delete require.cache[modulePath];
  // Electron's build emits common.const.js next to the .ts source, and Node
  // resolves the extensionless import to the .js file. Both cache keys have to
  // go so IS_MAC (computed at load from process.platform) reflects the test.
  delete require.cache[commonConstPath];
  delete require.cache[commonConstPath.replace(/\.ts$/, '.js')];
};

class FakeBrowserWindow {
  constructor(options) {
    this.options = options;
    this.bounds = {
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
    };
    this.visible = false;
    this.focused = false;
    this.destroyed = false;
    this.events = new Map();
    this.webContents = {
      sent: [],
      send: (channel, payload) => {
        this.webContents.sent.push([channel, payload]);
      },
      on: () => {},
      isDestroyed: () => false,
      isDevToolsOpened: () => false,
    };
    windows.push(this);
  }

  loadFile(file) {
    this.loadedFile = file;
  }

  setBounds(bounds) {
    this.bounds = bounds;
  }

  getBounds() {
    return this.bounds;
  }

  show() {
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }

  focus() {
    this.focused = true;
    focusCalls.push(this);
  }

  isVisible() {
    return this.visible;
  }

  isDestroyed() {
    return this.destroyed;
  }

  isFocused() {
    return this.focused;
  }

  destroy() {
    this.destroyed = true;
  }

  setVisibleOnAllWorkspaces() {}

  on(eventName, handler) {
    this.events.set(eventName, handler);
  }
}

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          setActivationPolicy: (policy) => activationPolicies.push(policy),
          dock: {
            hide: () => dockCalls.push('hide'),
            show: () => dockCalls.push('show'),
          },
          focus: (options) => appFocusCalls.push(options),
        },
        BrowserWindow: FakeBrowserWindow,
        ipcMain: {
          on: (channel, handler) => ipcHandlers.set(channel, handler),
          handle: (channel, handler) => ipcInvokeHandlers.set(channel, handler),
        },
        screen: {
          getDisplayMatching: () => ({ workArea }),
          getPrimaryDisplay: () => ({ workArea }),
        },
      };
    }

    if (request === 'electron-log/main') {
      return { log: () => {} };
    }

    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const loadModule = () => {
  resetModule();
  return require(modulePath);
};

test.beforeEach(() => {
  windows = [];
  ipcHandlers = new Map();
  ipcInvokeHandlers = new Map();
  dockCalls = [];
  activationPolicies = [];
  focusCalls = [];
  appFocusCalls = [];
  workArea = { x: 0, y: 25, width: 1440, height: 875 };
  mainWindow = {
    isDestroyed: () => false,
    webContents: {
      sent: [],
      isDestroyed: () => false,
      send: (channel, payload) => {
        mainWindow.webContents.sent.push([channel, payload]);
      },
    },
  };

  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: 'darwin',
  });
  installMocks();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  resetModule();
});

test('computeMenuBarPanelBounds centers under the tray and clamps to the work area', () => {
  const { computeMenuBarPanelBounds } = loadModule();

  const centered = computeMenuBarPanelBounds({
    trayBounds: { x: 700, y: 0, width: 24, height: 24 },
    workArea,
    width: 380,
    height: 520,
  });
  assert.deepEqual(centered, { x: 522, y: 33, width: 380, height: 520 });

  const rightEdge = computeMenuBarPanelBounds({
    trayBounds: { x: 1420, y: 0, width: 24, height: 24 },
    workArea,
    width: 380,
    height: 520,
  });
  assert.equal(rightEdge.x, 1440 - 380 - 8);

  const leftEdge = computeMenuBarPanelBounds({
    trayBounds: { x: 0, y: 0, width: 24, height: 24 },
    workArea,
    width: 380,
    height: 520,
  });
  assert.equal(leftEdge.x, 8);

  // A zero-width tray rect (hidden/unknown) falls back to the right edge.
  const unknownTray = computeMenuBarPanelBounds({
    trayBounds: { x: 0, y: 0, width: 0, height: 0 },
    workArea,
    width: 380,
    height: 520,
  });
  assert.equal(unknownTray.x, 1440 - 380 - 8);
});

test('init hides the Dock and switches to an accessory app', () => {
  const { initMenuBarPanel, isMenuBarPanelAvailable, getIsMenuBarOnly } = loadModule();

  initMenuBarPanel({
    showApp: () => {},
    getMainWindow: () => mainWindow,
    hideDock: true,
  });

  assert.deepEqual(dockCalls, ['hide']);
  assert.deepEqual(activationPolicies, ['accessory']);
  assert.equal(isMenuBarPanelAvailable(), true);
  assert.equal(getIsMenuBarOnly(), true);
  assert.ok(ipcHandlers.has('MENU_BAR_PANEL_ACTION'));
  assert.ok(ipcInvokeHandlers.has('MENU_BAR_PANEL_GET_STATE'));
});

test('init can keep the Dock icon (screenshot / opt-out mode)', () => {
  const { initMenuBarPanel, getIsMenuBarOnly } = loadModule();

  initMenuBarPanel({
    showApp: () => {},
    getMainWindow: () => mainWindow,
    hideDock: false,
  });

  assert.deepEqual(dockCalls, ['show']);
  assert.deepEqual(activationPolicies, ['regular']);
  assert.equal(getIsMenuBarOnly(), false);
});

test('the settings toggle shows and hides the Dock icon at runtime', () => {
  const { initMenuBarPanel, getIsMenuBarOnly } = loadModule();
  initMenuBarPanel({
    showApp: () => {},
    getMainWindow: () => mainWindow,
    hideDock: true,
  });

  const onSettings = ipcHandlers.get('UPDATE_MENU_BAR_SETTINGS');
  onSettings(null, { showDockIcon: true });

  assert.equal(getIsMenuBarOnly(), false);
  assert.deepEqual(activationPolicies, ['accessory', 'regular']);
  assert.deepEqual(dockCalls, ['hide', 'show']);

  onSettings(null, { showDockIcon: false });

  assert.equal(getIsMenuBarOnly(), true);
  assert.deepEqual(activationPolicies, ['accessory', 'regular', 'accessory']);
  assert.deepEqual(dockCalls, ['hide', 'show', 'hide']);
});

test('a pinned Dock icon ignores persisted settings for the launch', () => {
  const { initMenuBarPanel, getIsMenuBarOnly } = loadModule();
  initMenuBarPanel({
    showApp: () => {},
    getMainWindow: () => mainWindow,
    hideDock: false,
    lockDockVisible: true,
  });

  assert.deepEqual(dockCalls, ['show']);
  assert.equal(getIsMenuBarOnly(), false);

  ipcHandlers.get('UPDATE_MENU_BAR_SETTINGS')(null, { showDockIcon: false });

  assert.deepEqual(dockCalls, ['show']);
  assert.equal(getIsMenuBarOnly(), false);
});

test('toggle creates one frameless panel under the tray and toggles it closed again', () => {
  const { initMenuBarPanel, toggleMenuBarPanel } = loadModule();
  initMenuBarPanel({
    showApp: () => {},
    getMainWindow: () => mainWindow,
    hideDock: true,
  });

  const trayBounds = { x: 700, y: 0, width: 24, height: 24 };
  assert.equal(toggleMenuBarPanel(trayBounds), true);

  assert.equal(windows.length, 1);
  const win = windows[0];
  assert.equal(win.options.frame, false);
  assert.equal(win.options.resizable, false);
  assert.equal(win.options.skipTaskbar, true);
  assert.equal(win.options.vibrancy, 'popover');
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.deepEqual(win.bounds, { x: 522, y: 33, width: 380, height: 520 });
  assert.equal(win.visible, true);
  assert.equal(focusCalls.length, 1);
  assert.equal(appFocusCalls.length, 1);
  assert.match(win.loadedFile, /menu-bar-panel\.html$/);

  assert.equal(toggleMenuBarPanel(trayBounds), true);
  assert.equal(win.visible, false);
  assert.equal(windows.length, 1);
});

test('state is cached before the panel exists and pushed to it on update', () => {
  const { initMenuBarPanel, updateMenuBarPanel, toggleMenuBarPanel } = loadModule();
  initMenuBarPanel({
    showApp: () => {},
    getMainWindow: () => mainWindow,
    hideDock: true,
  });

  updateMenuBarPanel({
    todayTasks: [{ id: 'T1', title: 'Write tests' }],
    currentTask: { id: 'T1', title: 'Write tests' },
    isRunning: true,
  });

  const getState = ipcInvokeHandlers.get('MENU_BAR_PANEL_GET_STATE');
  const state = getState();
  assert.equal(state.todayTasks.length, 1);
  assert.equal(state.currentTask.id, 'T1');
  assert.equal(state.isRunning, true);

  toggleMenuBarPanel({ x: 700, y: 0, width: 24, height: 24 });
  const win = windows[0];
  const lastStateMessage = win.webContents.sent.at(-1);
  assert.equal(lastStateMessage[0], 'MENU_BAR_PANEL_STATE');
  assert.equal(lastStateMessage[1].todayTasks[0].title, 'Write tests');
});

test('panel actions are forwarded to the main window and validated', () => {
  const { initMenuBarPanel } = loadModule();
  let showAppCalls = 0;
  initMenuBarPanel({
    showApp: () => showAppCalls++,
    getMainWindow: () => mainWindow,
    hideDock: true,
  });

  const onAction = ipcHandlers.get('MENU_BAR_PANEL_ACTION');

  onAction(null, { type: 'toggleTask', id: 'T1' });
  onAction(null, { type: 'completeTask', id: 'T2' });
  onAction(null, { type: 'addTask', title: '  Ship it  ' });
  onAction(null, { type: 'addTask', title: '   ' });
  onAction(null, { type: 'toggleTask' });
  onAction(null, 'not-an-object');

  assert.deepEqual(mainWindow.webContents.sent, [
    ['MENU_BAR_PANEL_TOGGLE_TASK', 'T1'],
    ['MENU_BAR_PANEL_COMPLETE_TASK', 'T2'],
    ['MENU_BAR_PANEL_ADD_TASK', 'Ship it'],
  ]);

  onAction(null, { type: 'showApp' });
  assert.equal(showAppCalls, 1);
});

test('panel is unavailable outside an initialized macOS session', () => {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: 'linux',
  });
  const { initMenuBarPanel, isMenuBarPanelAvailable, toggleMenuBarPanel } = loadModule();

  initMenuBarPanel({
    showApp: () => {},
    getMainWindow: () => mainWindow,
    hideDock: true,
  });

  assert.equal(isMenuBarPanelAvailable(), false);
  assert.equal(toggleMenuBarPanel(), false);
  assert.deepEqual(dockCalls, []);
  assert.equal(windows.length, 0);
});
