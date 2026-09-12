const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const modulePath = path.resolve(__dirname, 'window-maximized-state.ts');

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

// --- isUserUnmaximize -------------------------------------------------------

test('an unmaximize on an on-screen window is a real user un-maximize', () => {
  const { isUserUnmaximize } = loadModule();

  assert.equal(isUserUnmaximize({ isVisible: true, isMinimized: false }), true);
});

test('#7276: the unmaximize that minimize() emits is ignored', () => {
  const { isUserUnmaximize } = loadModule();

  // Measured on X11: minimizing a maximized window emits `unmaximize` with
  // isMinimized() already true. Treating it as a real un-maximize is what lost
  // the maximized state across a restart.
  assert.equal(isUserUnmaximize({ isVisible: false, isMinimized: true }), false);
  assert.equal(isUserUnmaximize({ isVisible: true, isMinimized: true }), false);
});

test('#7276: the unmaximize that hide() emits is ignored', () => {
  const { isUserUnmaximize } = loadModule();

  assert.equal(isUserUnmaximize({ isVisible: false, isMinimized: false }), false);
});

// --- flag tracking + persistence -------------------------------------------

test('the flag starts false and is not persisted until it changes', () => {
  const { getWasMaximizedBeforeHide } = loadModule();

  assert.equal(getWasMaximizedBeforeHide(), false);
  assert.deepEqual(savedCalls, []);
});

test('setting the flag persists it under the window key', () => {
  const { setWasMaximizedBeforeHide, getWasMaximizedBeforeHide } = loadModule();

  setWasMaximizedBeforeHide(true);

  assert.equal(getWasMaximizedBeforeHide(), true);
  assert.deepEqual(savedCalls, [{ key: 'windowWasMaximized', value: true }]);
});

test('setting the flag to its current value does not write again', () => {
  const { setWasMaximizedBeforeHide } = loadModule();

  setWasMaximizedBeforeHide(true);
  setWasMaximizedBeforeHide(true);

  assert.equal(savedCalls.length, 1);
});

test('a failed write is logged, not thrown, so a hide is never blocked', async () => {
  const { setWasMaximizedBeforeHide, getWasMaximizedBeforeHide } = loadModule();
  saveRejection = new Error('disk full');

  assert.doesNotThrow(() => setWasMaximizedBeforeHide(true));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(getWasMaximizedBeforeHide(), true);
  assert.equal(loggedErrors.length, 1);
});

test('seeding from the persisted store does not write it straight back', () => {
  const { initWasMaximizedBeforeHide, getWasMaximizedBeforeHide } = loadModule();

  initWasMaximizedBeforeHide(true);

  assert.equal(getWasMaximizedBeforeHide(), true);
  assert.deepEqual(savedCalls, []);
});

// --- the regression, end to end over the tracked flag ----------------------

test('#7276: maximize → minimize → hide → quit keeps the maximized flag', () => {
  const mod = loadModule();
  const win = { isVisible: true, isMinimized: false };
  const onUnmaximize = () => {
    if (!mod.isUserUnmaximize(win)) return;
    mod.setWasMaximizedBeforeHide(false);
  };

  mod.setWasMaximizedBeforeHide(true); // 'maximize' event
  win.isMinimized = true; // minimize() lands before the event is delivered
  win.isVisible = false;
  onUnmaximize(); // 'unmaximize' emitted by minimize()

  assert.equal(mod.getWasMaximizedBeforeHide(), true);
  assert.deepEqual(savedCalls, [{ key: 'windowWasMaximized', value: true }]);
});

test('a genuine un-maximize before hiding still clears the flag', () => {
  const mod = loadModule();
  const win = { isVisible: true, isMinimized: false };
  const onUnmaximize = () => {
    if (!mod.isUserUnmaximize(win)) return;
    mod.setWasMaximizedBeforeHide(false);
  };

  mod.setWasMaximizedBeforeHide(true);
  onUnmaximize(); // user double-clicks the title bar, window still on screen

  assert.equal(mod.getWasMaximizedBeforeHide(), false);
  assert.deepEqual(savedCalls, [
    { key: 'windowWasMaximized', value: true },
    { key: 'windowWasMaximized', value: false },
  ]);
});
