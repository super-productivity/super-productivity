const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const execModulePath = path.resolve(__dirname, 'exec.ts');

let ipcHandlers;
let dialogResult;
let dialogOptions;
let execCalls;
let store;
let savedKeys;

const resetModule = () => {
  delete require.cache[execModulePath];
};

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        ipcMain: {
          on: (eventName, handler) => {
            ipcHandlers.set(eventName, handler);
          },
        },
        dialog: {
          showMessageBox: async (_win, options) => {
            dialogOptions = options;
            return dialogResult;
          },
        },
      };
    }

    if (request === 'child_process') {
      return {
        exec: (command, cb) => {
          execCalls.push(command);
          if (cb) {
            cb(null);
          }
        },
      };
    }

    if (request === 'electron-log/main') {
      return { log: () => {} };
    }

    if (request === '../simple-store') {
      return {
        loadSimpleStoreAll: async () => ({ ...store }),
        saveSimpleStore: async (key, value) => {
          savedKeys.push(key);
          store[key] = value;
        },
      };
    }

    if (request === '../main-window') {
      return { getWin: () => ({}) };
    }

    if (request === '../error-handler-with-frontend-inform') {
      return { errorHandlerWithFrontendInform: () => {} };
    }

    if (request === '../shared-with-frontend/ipc-events.const') {
      return { IPC: { EXEC: 'EXEC' } };
    }

    if (request === '../shared-with-frontend/simple-store.const') {
      return { SimpleStoreKey: { ALLOWED_COMMANDS: 'allowedCommands' } };
    }

    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const loadExecModule = () => {
  resetModule();
  return require(execModulePath);
};

const getHandler = () => {
  const mod = loadExecModule();
  mod.initExecIpc();
  return ipcHandlers.get('EXEC');
};

test.beforeEach(() => {
  ipcHandlers = new Map();
  dialogResult = { response: 0, checkboxChecked: false };
  dialogOptions = undefined;
  execCalls = [];
  store = {};
  savedKeys = [];
  installMocks();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
});

test('confirmation dialog fails safe: Cancel is default + cancel, remember is opt-in', async () => {
  const handler = getHandler();
  await handler({}, 'echo hi');

  // Security regression guard for GHSA-256q-p9ff-jv8q: an accidental
  // Enter/Escape must land on Cancel, and persisting to the silent
  // allow-list must be an explicit opt-in (unchecked by default).
  assert.equal(dialogOptions.defaultId, 0);
  assert.equal(dialogOptions.cancelId, 0);
  assert.equal(dialogOptions.checkboxChecked, false);
});

test('cancelling the dialog does not execute or persist the command', async () => {
  dialogResult = { response: 0, checkboxChecked: true };
  const handler = getHandler();
  await handler({}, 'rm -rf /');

  assert.deepEqual(execCalls, []);
  assert.deepEqual(savedKeys, []);
});

test('confirming with remember unchecked executes but does not persist', async () => {
  dialogResult = { response: 1, checkboxChecked: false };
  const handler = getHandler();
  await handler({}, 'echo hi');

  assert.deepEqual(execCalls, ['echo hi']);
  assert.deepEqual(savedKeys, []);
  assert.equal(store.allowedCommands, undefined);
});

test('confirming with remember checked executes and persists the command', async () => {
  dialogResult = { response: 1, checkboxChecked: true };
  const handler = getHandler();
  await handler({}, 'echo hi');

  assert.deepEqual(execCalls, ['echo hi']);
  assert.deepEqual(store.allowedCommands, ['echo hi']);
});

test('already-whitelisted command executes silently without a dialog', async () => {
  store = { allowedCommands: ['echo hi'] };
  const handler = getHandler();
  await handler({}, 'echo hi');

  assert.equal(dialogOptions, undefined);
  assert.deepEqual(execCalls, ['echo hi']);
});

test('throws on a corrupt (non-array) allow-list', async () => {
  store = { allowedCommands: 'not-an-array' };
  const handler = getHandler();

  await assert.rejects(() => handler({}, 'echo hi'), /must be an array/);
});
