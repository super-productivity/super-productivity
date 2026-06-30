const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const protocolHandlerPath = path.resolve(__dirname, 'protocol-handler.ts');

const originalModuleLoad = Module._load;

let showOrFocusCalls = [];
let toggleVisibilityCalls = [];

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      // Only used for types in protocol-handler; provide harmless stubs.
      return { App: class {}, BrowserWindow: class {} };
    }
    if (request === 'electron-log/main') {
      return { log: () => {} };
    }
    if (request === './various-shared') {
      return {
        showOrFocus: (win) => showOrFocusCalls.push(win),
        toggleWindowVisibility: (win) => toggleVisibilityCalls.push(win),
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const restoreMocks = () => {
  Module._load = originalModuleLoad;
};

const loadModule = () => {
  delete require.cache[protocolHandlerPath];
  installMocks();
  try {
    return require(protocolHandlerPath);
  } finally {
    restoreMocks();
  }
};

const makeWin = () => {
  const sent = [];
  return {
    sent,
    webContents: {
      send: (channel, payload) => sent.push({ channel, payload }),
    },
  };
};

test.beforeEach(() => {
  showOrFocusCalls = [];
  toggleVisibilityCalls = [];
});

test('new-task shows the window and opens the add-task bar', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  processProtocolUrl('superproductivity://new-task', win);

  assert.equal(showOrFocusCalls.length, 1);
  assert.deepEqual(win.sent, [{ channel: 'SHOW_ADD_TASK_BAR', payload: undefined }]);
});

test('new-note shows the window and triggers add-note', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  processProtocolUrl('superproductivity://new-note', win);

  assert.equal(showOrFocusCalls.length, 1);
  assert.deepEqual(win.sent, [{ channel: 'ADD_NOTE', payload: undefined }]);
});

test('toggle-visibility delegates to the shared toggle helper without sending IPC', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  processProtocolUrl('superproductivity://toggle-visibility', win);

  assert.equal(toggleVisibilityCalls.length, 1);
  assert.equal(toggleVisibilityCalls[0], win);
  assert.deepEqual(win.sent, []);
});

test('create-task forwards the decoded title', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  processProtocolUrl('superproductivity://create-task/Buy%20milk', win);

  assert.deepEqual(win.sent, [
    { channel: 'ADD_TASK_FROM_APP_URI', payload: { title: 'Buy milk' } },
  ]);
});

test('unknown actions are ignored and do not send IPC or throw', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  assert.doesNotThrow(() =>
    processProtocolUrl('superproductivity://does-not-exist', win),
  );
  assert.deepEqual(win.sent, []);
  assert.equal(showOrFocusCalls.length, 0);
  assert.equal(toggleVisibilityCalls.length, 0);
});
