const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const protocolHandlerModulePath = path.resolve(__dirname, 'protocol-handler.ts');

let sentMessages;
let showOrFocusCalls;
let showQuickAddCalls;
let loadedMod;
let processArgv;

const mainWin = {
  webContents: {
    send: (channel, payload) => sentMessages.push({ channel, payload }),
  },
};

const createAppMock = () => {
  const listeners = new Map();
  return {
    listeners,
    setAsDefaultProtocolClient: () => {},
    on: (eventName, listener) => listeners.set(eventName, listener),
    whenReady: () => Promise.resolve(),
  };
};

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron-log/main') {
      return { log: () => {} };
    }
    if (request.endsWith('various-shared')) {
      return { showOrFocus: (win) => showOrFocusCalls.push(win) };
    }
    if (request.endsWith('quick-add-window')) {
      return { showQuickAddWindow: () => showQuickAddCalls++ };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const loadModule = () => {
  delete require.cache[require.resolve(protocolHandlerModulePath)];
  Object.keys(require.cache)
    .filter((cachePath) => cachePath.endsWith('/electron/protocol-handler.ts'))
    .forEach((cachePath) => delete require.cache[cachePath]);
  loadedMod = require(protocolHandlerModulePath);
  return loadedMod;
};

test.beforeEach(() => {
  sentMessages = [];
  showOrFocusCalls = [];
  showQuickAddCalls = 0;
  loadedMod = undefined;
  processArgv = process.argv;
  process.argv = ['electron', '.'];
  installMocks();
});

test.afterEach(() => {
  process.argv = processArgv;
  Module._load = originalModuleLoad;
});

test('quick-add protocol action opens the Quick Add HUD', () => {
  const mod = loadModule();

  mod.processProtocolUrl('superproductivity://quick-add', mainWin);

  assert.equal(showQuickAddCalls, 1);
  assert.deepEqual(showOrFocusCalls, []);
  assert.deepEqual(sentMessages, []);
});

test('quick-add second instance does not focus the main window', () => {
  const mod = loadModule();
  const app = createAppMock();
  mod.initializeProtocolHandling(true, app, () => mainWin);

  app.listeners.get('second-instance')({}, [
    'electron',
    '.',
    'superproductivity://quick-add',
  ]);

  assert.equal(showQuickAddCalls, 1);
  assert.deepEqual(showOrFocusCalls, []);
});

test('non-quick-add second instance still focuses the main window', () => {
  const mod = loadModule();
  const app = createAppMock();
  mod.initializeProtocolHandling(true, app, () => mainWin);

  app.listeners.get('second-instance')({}, ['electron', '.']);

  assert.deepEqual(showOrFocusCalls, [mainWin]);
});
