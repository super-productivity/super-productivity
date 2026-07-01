const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const execModulePath = path.resolve(__dirname, 'ipc-handlers', 'exec.ts');

let ipcHandlers;
let dialogResult;
let dialogOptions;
let execCalls;
let execError;
let store;
let savedKeys;
let errorHandlerCalls;

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
            cb(execError);
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
      return {
        errorHandlerWithFrontendInform: (err) => {
          errorHandlerCalls.push(err);
        },
      };
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
  execError = null;
  store = {};
  savedKeys = [];
  errorHandlerCalls = [];
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

test('corrupt (non-array) allow-list fails closed: informs the error, runs nothing', async () => {
  store = { allowedCommands: 'not-an-array' };
  const handler = getHandler();

  // The handler is fire-and-forget (ipcMain.on), so a corrupt store must be
  // routed to the frontend error handler rather than thrown as an unhandled
  // rejection — and critically must never fall through to executing.
  await handler({}, 'echo hi');

  assert.equal(errorHandlerCalls.length, 1);
  assert.match(errorHandlerCalls[0].message, /must be an array/);
  assert.deepEqual(execCalls, []);
  assert.deepEqual(savedKeys, []);
});

test('exec error on a whitelisted command is routed to the frontend error handler', async () => {
  store = { allowedCommands: ['echo hi'] };
  execError = new Error('boom');
  const handler = getHandler();
  await handler({}, 'echo hi');

  assert.deepEqual(execCalls, ['echo hi']);
  assert.equal(errorHandlerCalls.length, 1);
  assert.equal(errorHandlerCalls[0], execError);
});

test('confirming with remember appends to an existing allow-list (no overwrite)', async () => {
  store = { allowedCommands: ['pre-existing'] };
  dialogResult = { response: 1, checkboxChecked: true };
  const handler = getHandler();
  await handler({}, 'echo hi');

  // The new command was not whitelisted, so it must still prompt...
  assert.notEqual(dialogOptions, undefined);
  // ...and remembering it must preserve prior entries, not replace them.
  assert.deepEqual(store.allowedCommands, ['pre-existing', 'echo hi']);
  assert.deepEqual(execCalls, ['echo hi']);
});
