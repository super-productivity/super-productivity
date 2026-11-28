const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const modulePath = path.resolve(__dirname, 'window-full-screen-state.ts');

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

test('the flag starts false and is not persisted until it changes', () => {
  const { getWasFullScreen } = loadModule();

  assert.equal(getWasFullScreen(), false);
  assert.deepEqual(savedCalls, []);
});

test('setting the flag persists it under the full-screen key', () => {
  const { setWasFullScreen, getWasFullScreen } = loadModule();

  setWasFullScreen(true);

  assert.equal(getWasFullScreen(), true);
  assert.deepEqual(savedCalls, [{ key: 'windowWasFullScreen', value: true }]);
});

test('setting the same value again does not write', () => {
  const { setWasFullScreen } = loadModule();

  setWasFullScreen(true);
  setWasFullScreen(true);

  assert.equal(savedCalls.length, 1);
});

test('seeding from the store on startup does not write it back', () => {
  const { initWasFullScreen, getWasFullScreen, setWasFullScreen } = loadModule();

  initWasFullScreen(true);
  assert.equal(getWasFullScreen(), true);
  assert.deepEqual(savedCalls, []);

  // A later real change is still persisted.
  setWasFullScreen(false);
  assert.deepEqual(savedCalls, [{ key: 'windowWasFullScreen', value: false }]);
});

test('a failed write is logged and the in-memory flag is kept', async () => {
  const { setWasFullScreen, getWasFullScreen } = loadModule();
  saveRejection = new Error('disk full');

  setWasFullScreen(true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(getWasFullScreen(), true);
  assert.equal(loggedErrors.length, 1);
});

test('a value adopted from the window-state library is saved when asked', () => {
  const { initWasFullScreen, getWasFullScreen } = loadModule();

  initWasFullScreen(true, { isPersist: true });

  assert.equal(getWasFullScreen(), true);
  assert.deepEqual(savedCalls, [{ key: 'windowWasFullScreen', value: true }]);
});
