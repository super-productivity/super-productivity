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
let mockIsMac = false;

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
      return { IS_MAC: mockIsMac };
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
    focus: () => {
      calls.push('focus');
      win._state = { ...win._state, focused: true };
    },
    maximize: () => calls.push('maximize'),
    webContents: { isDestroyed: () => true, focus: () => {} },
  };
  return win;
};

test.beforeEach(() => {
  mockNow = 100000;
  mockIsMinimizeToTray = false;
  mockEnsureIndicator = false;
  mockIsMac = false;
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
  assert.deepEqual(
    win.calls,
    ['minimize'],
    'repeat within the quiet gap must be ignored',
  );

  // 3) Another repeat, still within the gap relative to the previous event.
  mockNow += 80;
  toggleWindowVisibility(win);
  assert.deepEqual(win.calls, ['minimize'], 'consecutive repeats keep resetting the gap');
});

test('a deliberate press after the quiet gap toggles again (gap actually expires)', () => {
  const { toggleWindowVisibility } = loadModule();
  const win = makeWin({ visible: true, minimized: false, focused: true });

  // 1) First press hides it and records the toggle timestamp.
  toggleWindowVisibility(win);
  assert.deepEqual(win.calls, ['minimize']);

  // 2) A repeat within the gap is swallowed (and still slides the gap forward).
  mockNow += 200;
  toggleWindowVisibility(win);
  assert.deepEqual(win.calls, ['minimize'], 'within-gap repeat ignored');

  // 3) After a real pause (> the quiet gap, measured from the LAST event) a deliberate
  //    press shows it again — proving the debounce releases rather than sticking.
  mockNow += 1000;
  toggleWindowVisibility(win);
  assert.ok(win.calls.includes('show'), 'press after the gap re-shows the window');
});

test('a held key starting HIDDEN settles shown, not hidden (#7114, both directions)', () => {
  const { toggleWindowVisibility } = loadModule();
  const win = makeWin({ visible: false, minimized: true, focused: false });

  // 1) First event of the held key: hidden+unfocused -> show.
  toggleWindowVisibility(win);
  assert.ok(win.calls.includes('show'), 'first event shows the window');
  assert.equal(win.isVisible(), true);
  const callsAfterShow = [...win.calls];

  // 2-3) Repeats within the gap must NOT hide it again. The old isHidden-only guard let
  //      the now-visible window fall through to the hide branch -> ended HIDDEN.
  mockNow += 80;
  toggleWindowVisibility(win);
  mockNow += 80;
  toggleWindowVisibility(win);
  assert.deepEqual(win.calls, callsAfterShow, 'repeats swallowed in both directions');
  assert.equal(win.isVisible(), true, 'window stays shown for the whole held press');
});

test('a visible-but-unfocused window is brought to front, never hidden', () => {
  const { toggleWindowVisibility } = loadModule();
  const win = makeWin({ visible: true, minimized: false, focused: false });

  toggleWindowVisibility(win);

  assert.deepEqual(win.calls, ['focus'], 'should focus, not hide');
});

test('macless minimize-to-tray hides to tray only when the indicator exists', () => {
  mockIsMinimizeToTray = true;
  mockEnsureIndicator = true;
  const { toggleWindowVisibility } = loadModule();
  const win = makeWin({ visible: true, minimized: false, focused: true });

  toggleWindowVisibility(win);

  assert.deepEqual(win.calls, ['blur', 'hide']);
});

test('minimize-to-tray falls back to minimize when the tray is unavailable (#7282)', () => {
  mockIsMinimizeToTray = true;
  mockEnsureIndicator = false; // tray failed to (re)create
  const { toggleWindowVisibility } = loadModule();
  const win = makeWin({ visible: true, minimized: false, focused: true });

  toggleWindowVisibility(win);

  // Must keep a taskbar handle (minimize), not hide() into an unreachable state.
  assert.deepEqual(win.calls, ['minimize']);
});

test('on macOS the window hides (dock icon stays), never minimizes', () => {
  mockIsMac = true;
  const { toggleWindowVisibility } = loadModule();
  const win = makeWin({ visible: true, minimized: false, focused: true });

  toggleWindowVisibility(win);

  assert.deepEqual(win.calls, ['hide']);
});
