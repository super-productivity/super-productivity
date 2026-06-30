const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const variousSharedPath = path.resolve(__dirname, 'various-shared.ts');

const originalModuleLoad = Module._load;
const originalDateNow = Date.now;

let mockNow = 0;
let mockIsMinimizeToTray = false;
let mockEnsureIndicator = false;

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return { app: { quit: () => {} }, BrowserWindow: class {} };
    }
    if (request === 'electron-log/main') {
      return { info: () => {} };
    }
    if (request === './main-window') {
      return {
        getWin: () => null,
        getWasMaximizedBeforeHide: () => false,
        setWasMaximizedBeforeHide: () => {},
      };
    }
    if (request === './task-widget/task-widget') {
      return {
        getIsTaskWidgetAlwaysShow: () => true,
        getIsTaskWidgetUserForcedVisible: () => false,
        hideTaskWidget: () => {},
      };
    }
    if (request === './shared-state') {
      return {
        getIsMinimizeToTray: () => mockIsMinimizeToTray,
        setIsQuiting: () => {},
      };
    }
    if (request === './indicator') {
      return { ensureIndicator: () => mockEnsureIndicator };
    }
    if (request === './common.const') {
      return { IS_MAC: false };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const restoreMocks = () => {
  Module._load = originalModuleLoad;
};

const loadModule = () => {
  delete require.cache[variousSharedPath];
  installMocks();
  try {
    return require(variousSharedPath);
  } finally {
    restoreMocks();
  }
};

const makeWin = (state) => {
  const calls = [];
  const win = {
    calls,
    _state: { ...state },
    isVisible: () => win._state.visible,
    isMinimized: () => win._state.minimized,
    isFocused: () => win._state.focused,
    isMaximized: () => false,
    isDestroyed: () => false,
    minimize: () => {
      calls.push('minimize');
      win._state = { visible: false, minimized: true, focused: false };
    },
    hide: () => {
      calls.push('hide');
      win._state = { visible: false, minimized: false, focused: false };
    },
    blur: () => calls.push('blur'),
    restore: () => calls.push('restore'),
    show: () => {
      calls.push('show');
      win._state = { visible: true, minimized: false, focused: false };
    },
    focus: () => calls.push('focus'),
    maximize: () => calls.push('maximize'),
    webContents: { isDestroyed: () => true, focus: () => {} },
  };
  return win;
};

test.beforeEach(() => {
  mockNow = 100000;
  mockIsMinimizeToTray = false;
  mockEnsureIndicator = false;
  Date.now = () => mockNow;
});

test.afterEach(() => {
  Date.now = originalDateNow;
});

test('a held key-repeat does not hide then immediately re-show the window (#7114)', () => {
  const { toggleWindowVisibility } = loadModule();
  const win = makeWin({ visible: true, minimized: false, focused: true });

  // 1) First press of one physical key: visible+focused -> minimize.
  toggleWindowVisibility(win);
  assert.deepEqual(win.calls, ['minimize']);
  assert.equal(win.isVisible(), false);

  // 2) Key-repeat 80ms later (same physical press): must be ignored, NOT re-shown.
  mockNow += 80;
  toggleWindowVisibility(win);
  assert.deepEqual(win.calls, ['minimize'], 'repeat within the quiet gap must be ignored');

  // 3) Another repeat, still within the gap relative to the previous event.
  mockNow += 80;
  toggleWindowVisibility(win);
  assert.deepEqual(win.calls, ['minimize'], 'consecutive repeats keep resetting the gap');
});

test('a deliberate later press re-shows a hidden window', () => {
  const { toggleWindowVisibility } = loadModule();
  const win = makeWin({ visible: false, minimized: true, focused: false });

  // More than the quiet gap has elapsed since any prior toggle -> real press, show it.
  mockNow += 5000;
  toggleWindowVisibility(win);

  assert.ok(win.calls.includes('show'), 'window should be shown again');
});

test('macless minimize-to-tray hides to tray only when the indicator exists', () => {
  mockIsMinimizeToTray = true;
  mockEnsureIndicator = true;
  const { toggleWindowVisibility } = loadModule();
  const win = makeWin({ visible: true, minimized: false, focused: true });

  toggleWindowVisibility(win);

  assert.deepEqual(win.calls, ['blur', 'hide']);
});
