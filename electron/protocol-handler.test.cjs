const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const protocolHandlerPath = path.resolve(__dirname, 'protocol-handler.ts');

const originalModuleLoad = Module._load;

let showOrFocusCalls = [];
let toggleVisibilityCalls = [];
let logCalls = [];

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      // Only used for types in protocol-handler; provide harmless stubs.
      return { App: class {}, BrowserWindow: class {} };
    }
    if (request === 'electron-log/main') {
      return { log: (...args) => logCalls.push(args) };
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
  logCalls = [];
});

test('add-task shows the window and opens the add-task bar', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  processProtocolUrl('superproductivity://add-task', win);

  assert.equal(showOrFocusCalls.length, 1);
  assert.deepEqual(win.sent, [{ channel: 'SHOW_ADD_TASK_BAR', payload: undefined }]);
});

test('add-note shows the window and triggers add-note', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  processProtocolUrl('superproductivity://add-note', win);

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

test('does not log user content (the task title) to the exportable log', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  processProtocolUrl('superproductivity://create-task/My%20Secret%20Title', win);

  // The task itself is still dispatched with the real title...
  assert.deepEqual(win.sent, [
    { channel: 'ADD_TASK_FROM_APP_URI', payload: { title: 'My Secret Title' } },
  ]);
  // ...but the title must never reach the (exportable) log.
  assert.ok(
    !JSON.stringify(logCalls).includes('Secret'),
    'task title must not appear in any log line',
  );
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

test('getProtocolAction extracts the action host, null for missing/invalid', () => {
  const { getProtocolAction } = loadModule();

  assert.equal(
    getProtocolAction('superproductivity://toggle-visibility'),
    'toggle-visibility',
  );
  assert.equal(
    getProtocolAction('superproductivity://create-task/Buy%20milk'),
    'create-task',
  );
  assert.equal(getProtocolAction(undefined), null);
  assert.equal(getProtocolAction('::: not a url :::'), null);
});

// Build a minimal Electron `app` double that captures the event listeners
// `initializeProtocolHandling` registers so we can drive the real second-instance path.
const makeFakeApp = () => {
  const handlers = {};
  return {
    handlers,
    setAsDefaultProtocolClient: () => {},
    on: (evt, fn) => {
      handlers[evt] = fn;
    },
    whenReady: () => ({ then: () => {} }),
  };
};

test('second-instance does NOT pre-focus for toggle-visibility (reads pre-press state)', () => {
  const { initializeProtocolHandling } = loadModule();
  const win = makeWin();
  const app = makeFakeApp();

  initializeProtocolHandling(false, app, () => win);
  app.handlers['second-instance']({}, [
    '/path/to/app',
    'superproductivity://toggle-visibility',
  ]);

  // The generic pre-focus would show the window and make the toggle read "visible" and
  // hide it again (#7114) — so it must be skipped for this action.
  assert.equal(showOrFocusCalls.length, 0, 'must not pre-focus before toggling');
  assert.equal(toggleVisibilityCalls.length, 1, 'toggle still runs');
});

test('second-instance pre-focuses for a plain launch and for non-toggle actions', () => {
  const { initializeProtocolHandling } = loadModule();
  const win = makeWin();
  const app = makeFakeApp();

  initializeProtocolHandling(false, app, () => win);

  // a) plain second launch (no protocol URL) -> bring our window to front.
  app.handlers['second-instance']({}, ['/path/to/app']);
  assert.equal(showOrFocusCalls.length, 1);

  // b) add-task still focuses the window and opens the add-task bar.
  app.handlers['second-instance']({}, ['/path/to/app', 'superproductivity://add-task']);
  assert.ok(showOrFocusCalls.length >= 2, 'non-toggle action still focuses the window');
  assert.deepEqual(win.sent, [{ channel: 'SHOW_ADD_TASK_BAR', payload: undefined }]);
});

test('cold-start toggle-visibility shows the launched window instead of toggling it (#7114)', () => {
  const win = makeWin();
  const app = makeFakeApp();
  const originalArgv = process.argv;
  // Simulate the app being COLD-LAUNCHED by the URL: it appears in argv at startup.
  process.argv = ['/path/to/app', 'superproductivity://toggle-visibility'];
  let mod;
  try {
    mod = loadModule();
    mod.initializeProtocolHandling(false, app, () => win);
  } finally {
    process.argv = originalArgv;
  }

  // The window is created + shown by startup, then the ready-drain runs ~1s later.
  mod.processPendingProtocolUrls(win);

  // Cold start must SHOW the window, never route it through the toggle (which, on a freshly
  // shown+focused window, would immediately hide it again).
  assert.equal(toggleVisibilityCalls.length, 0, 'cold-start must not toggle');
  assert.equal(showOrFocusCalls.length, 1);
  assert.equal(showOrFocusCalls[0], win);
  assert.deepEqual(win.sent, []);
});
