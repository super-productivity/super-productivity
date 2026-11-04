const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const modulePath = path.resolve(__dirname, 'window-restore-bounds.ts');

let savedCalls = [];
let saveRejection = null;
let loggedErrors = [];

const originalModuleLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './simple-store') {
    return {
      saveSimpleStore: (key, value) => {
        savedCalls.push({ key, value });
        return saveRejection ? Promise.reject(saveRejection) : Promise.resolve();
      },
    };
  }
  if (request === 'electron-log/main') {
    return { error: (...args) => loggedErrors.push(args) };
  }
  return originalModuleLoad(request, parent, isMain);
};

const loadModule = () => {
  delete require.cache[modulePath];
  return require(modulePath);
};

test.beforeEach(() => {
  savedCalls = [];
  saveRejection = null;
  loggedErrors = [];
});

test.after(() => {
  Module._load = originalModuleLoad;
});

// The display the issue's measurements were taken on.
const WORK_AREA = { x: 0, y: 0, width: 3072, height: 1728 };

// --- isSampleableBounds -----------------------------------------------------

test('an on-screen, un-maximized window is sampleable', () => {
  const { isSampleableBounds } = loadModule();

  assert.equal(
    isSampleableBounds({
      isVisible: true,
      isMinimized: false,
      isMaximized: false,
      isFullScreen: false,
    }),
    true,
  );
});

test('#10058: a hidden window is never sampled, whatever it claims about itself', () => {
  const { isSampleableBounds } = loadModule();

  // Mechanism 1. electron-window-state's isNormal() omits the visibility test,
  // so where hide() makes isMaximized() report false (Wayland destroys the
  // xdg_toplevel) it writes the maximized bounds into the restore bounds.
  assert.equal(
    isSampleableBounds({
      isVisible: false,
      isMinimized: false,
      isMaximized: false,
      isFullScreen: false,
    }),
    false,
  );
});

test('minimized, maximized and full-screen windows are not sampled', () => {
  const { isSampleableBounds } = loadModule();
  const on = {
    isVisible: true,
    isMinimized: false,
    isMaximized: false,
    isFullScreen: false,
  };

  assert.equal(isSampleableBounds({ ...on, isMinimized: true }), false);
  assert.equal(isSampleableBounds({ ...on, isMaximized: true }), false);
  assert.equal(isSampleableBounds({ ...on, isFullScreen: true }), false);
});

// --- parseStoredBounds ------------------------------------------------------

test('well-formed persisted bounds are read back', () => {
  const { parseStoredBounds } = loadModule();

  assert.deepEqual(parseStoredBounds({ x: 100, y: 100, width: 900, height: 700 }), {
    x: 100,
    y: 100,
    width: 900,
    height: 700,
  });
});

test('negative coordinates are kept, since a left or upper display has them', () => {
  const { parseStoredBounds } = loadModule();

  assert.deepEqual(parseStoredBounds({ x: -1920, y: -100, width: 800, height: 600 }), {
    x: -1920,
    y: -100,
    width: 800,
    height: 600,
  });
});

test('anything that is not a complete, integral, positively sized rectangle is rejected', () => {
  const { parseStoredBounds } = loadModule();

  assert.equal(parseStoredBounds(undefined), null);
  assert.equal(parseStoredBounds(null), null);
  assert.equal(parseStoredBounds('900x700'), null);
  assert.equal(parseStoredBounds({ x: 0, y: 0, width: 900 }), null);
  assert.equal(parseStoredBounds({ x: 0, y: 0, width: '900', height: 700 }), null);
  assert.equal(parseStoredBounds({ x: NaN, y: 0, width: 900, height: 700 }), null);
  assert.equal(parseStoredBounds({ x: 0, y: 0, width: Infinity, height: 700 }), null);
  assert.equal(parseStoredBounds({ x: 0, y: 0, width: 0, height: 700 }), null);
  assert.equal(parseStoredBounds({ x: 0, y: 0, width: 900, height: -700 }), null);
  assert.equal(parseStoredBounds({ x: 0.5, y: 0, width: 900, height: 700 }), null);
  assert.equal(parseStoredBounds({ x: 0, y: 0, width: 900.25, height: 700 }), null);
});

// --- clampBoundsToDisplay ---------------------------------------------------

test('bounds already on the display are returned unchanged', () => {
  const { clampBoundsToDisplay } = loadModule();
  const bounds = { x: 100, y: 100, width: 900, height: 700 };

  assert.deepEqual(clampBoundsToDisplay(bounds, WORK_AREA), bounds);
});

test('#10058: an overhanging window keeps its size and is moved back on screen', () => {
  const { clampBoundsToDisplay } = loadModule();

  // Measured in the issue: seeding x:2800 on a 3072-wide display made
  // electron-window-state discard the whole state and fall back to 800x800 at
  // 0,0 — the size went with the position. Clamping keeps the 900x700.
  assert.deepEqual(
    clampBoundsToDisplay({ x: 2800, y: 200, width: 900, height: 700 }, WORK_AREA),
    { x: 2172, y: 200, width: 900, height: 700 },
  );
});

test('a window off the top or left edge is pushed to the work area origin', () => {
  const { clampBoundsToDisplay } = loadModule();

  assert.deepEqual(
    clampBoundsToDisplay({ x: -500, y: -300, width: 900, height: 700 }, WORK_AREA),
    { x: 0, y: 0, width: 900, height: 700 },
  );
});

test('the work area origin is honoured, not assumed to be 0,0', () => {
  const { clampBoundsToDisplay } = loadModule();
  // A second display to the right, with a menu bar or panel taking the top.
  const secondary = { x: 3072, y: 25, width: 1920, height: 1055 };

  assert.deepEqual(
    clampBoundsToDisplay({ x: 3000, y: 0, width: 800, height: 600 }, secondary),
    { x: 3072, y: 25, width: 800, height: 600 },
  );
});

test('a window larger than the work area is shrunk to fit it', () => {
  const { clampBoundsToDisplay } = loadModule();
  const small = { x: 0, y: 0, width: 1280, height: 800 };

  assert.deepEqual(
    clampBoundsToDisplay({ x: 100, y: 100, width: 3072, height: 1701 }, small),
    {
      x: 0,
      y: 0,
      width: 1280,
      height: 800,
    },
  );
});

// --- tracking + persistence -------------------------------------------------

test('nothing is tracked or persisted until bounds are set', () => {
  const { getRestoreBounds } = loadModule();

  assert.equal(getRestoreBounds(), null);
  assert.deepEqual(savedCalls, []);
});

test('setting bounds persists them under the window key', () => {
  const { setRestoreBounds, getRestoreBounds } = loadModule();
  const bounds = { x: 100, y: 100, width: 900, height: 700 };

  setRestoreBounds(bounds);

  assert.deepEqual(getRestoreBounds(), bounds);
  assert.deepEqual(savedCalls, [{ key: 'windowRestoreBounds', value: bounds }]);
});

test('re-setting the same bounds does not write again', () => {
  const { setRestoreBounds } = loadModule();

  setRestoreBounds({ x: 100, y: 100, width: 900, height: 700 });
  setRestoreBounds({ x: 100, y: 100, width: 900, height: 700 });

  assert.equal(savedCalls.length, 1);
});

test('a move of one pixel is still a change and is written', () => {
  const { setRestoreBounds } = loadModule();

  setRestoreBounds({ x: 100, y: 100, width: 900, height: 700 });
  setRestoreBounds({ x: 101, y: 100, width: 900, height: 700 });

  assert.equal(savedCalls.length, 2);
});

test('a failed write is logged, not thrown, so a resize is never blocked', async () => {
  const { setRestoreBounds, getRestoreBounds } = loadModule();
  saveRejection = new Error('disk full');

  assert.doesNotThrow(() =>
    setRestoreBounds({ x: 100, y: 100, width: 900, height: 700 }),
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(getRestoreBounds(), { x: 100, y: 100, width: 900, height: 700 });
  assert.equal(loggedErrors.length, 1);
});

test('seeding from the persisted store does not write it straight back', () => {
  const { initRestoreBounds, getRestoreBounds } = loadModule();
  const bounds = { x: 100, y: 100, width: 900, height: 700 };

  initRestoreBounds(bounds);

  assert.deepEqual(getRestoreBounds(), bounds);
  assert.deepEqual(savedCalls, []);
});

// --- the two regressions, end to end ---------------------------------------

test('#10058 mechanism 1: maximize then hide does not overwrite the restore bounds', () => {
  const mod = loadModule();
  const win = {
    bounds: { x: 100, y: 100, width: 900, height: 700 },
    isVisible: true,
    isMinimized: false,
    isMaximized: false,
    isFullScreen: false,
  };
  const onBoundsChanged = () => {
    if (!mod.isSampleableBounds(win)) return;
    mod.setRestoreBounds(win.bounds);
  };

  onBoundsChanged(); // user sizes the window
  win.isMaximized = true;
  win.bounds = { x: 0, y: 0, width: 3072, height: 1701 };
  onBoundsChanged(); // maximize
  // hide(): on Wayland the xdg_toplevel is gone, so isMaximized() now lies.
  win.isVisible = false;
  win.isMaximized = false;
  onBoundsChanged();

  assert.deepEqual(mod.getRestoreBounds(), { x: 100, y: 100, width: 900, height: 700 });
  assert.equal(savedCalls.length, 1);
});

test('#10058 mechanism 2: an overhang at quit time survives the next launch', () => {
  const mod = loadModule();

  // Last session: the window was dragged partly off the right edge.
  mod.setRestoreBounds({ x: 2800, y: 200, width: 900, height: 700 });
  const persisted = savedCalls[0].value;

  // Next launch reads it back and puts it on screen, instead of the library
  // resetting the whole state to an 800x800 default.
  const restored = mod.clampBoundsToDisplay(mod.parseStoredBounds(persisted), WORK_AREA);

  assert.deepEqual(restored, { x: 2172, y: 200, width: 900, height: 700 });
});
