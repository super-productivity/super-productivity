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
// Controls the mocked `getIsAppReady()`. Default true so the existing tests
// exercise the ready path; the deferral test flips it to false.
let isAppReady = true;

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      // Only used for types in protocol-handler; provide harmless stubs.
      return { App: class {}, BrowserWindow: class {} };
    }
    if (request === 'electron-log/main') {
      return { log: (...args) => logCalls.push(args) };
    }
    if (request === './main-window') {
      return { getIsAppReady: () => isAppReady };
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
  isAppReady = true;
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

test('create-task forwards the decoded title from the path segment and shows the window', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  processProtocolUrl('superproductivity://create-task/Buy%20milk', win);

  assert.deepEqual(win.sent, [
    {
      channel: 'ADD_TASK_FROM_APP_URI',
      payload: { title: 'Buy milk', notes: undefined, projectId: undefined },
    },
  ]);
  assert.equal(
    showOrFocusCalls.length,
    1,
    'the success/error snack must actually be visible to the user',
  );
});

test('create-task forwards title, notes, and projectId from query params', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  processProtocolUrl(
    'superproductivity://create-task?title=Buy%20milk&notes=2%25%20fat&projectId=proj-1',
    win,
  );

  assert.deepEqual(win.sent, [
    {
      channel: 'ADD_TASK_FROM_APP_URI',
      payload: { title: 'Buy milk', notes: '2% fat', projectId: 'proj-1' },
    },
  ]);
});

test('create-task action name is case-insensitive', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  processProtocolUrl('superproductivity://Create-Task?title=Buy%20milk', win);

  assert.deepEqual(win.sent, [
    {
      channel: 'ADD_TASK_FROM_APP_URI',
      payload: { title: 'Buy milk', notes: undefined, projectId: undefined },
    },
  ]);
});

test('create-task with neither a path segment nor a title query param sends nothing', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  processProtocolUrl('superproductivity://create-task', win);

  assert.deepEqual(win.sent, []);
});

test('create-task with a present-but-empty title forwards it (renderer shows the error)', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  // `?title=` is present but empty. It must reach the renderer (which surfaces
  // the empty-title error snack), not be silently dropped like a missing param.
  processProtocolUrl('superproductivity://create-task?title=', win);

  assert.deepEqual(win.sent, [
    {
      channel: 'ADD_TASK_FROM_APP_URI',
      payload: { title: '', notes: undefined, projectId: undefined },
    },
  ]);
});

test('complete-task forwards the title query param and shows the window', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  processProtocolUrl('superproductivity://complete-task?title=Buy%20milk', win);

  assert.deepEqual(win.sent, [
    { channel: 'COMPLETE_TASK_FROM_APP_URI', payload: { title: 'Buy milk' } },
  ]);
  assert.equal(
    showOrFocusCalls.length,
    1,
    'the success/error snack must actually be visible to the user',
  );
});

test('complete-task without a title query param sends nothing', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  processProtocolUrl('superproductivity://complete-task', win);

  assert.deepEqual(win.sent, []);
});

test('defers until the app is ready, then delivers the queued URL on drain', () => {
  // A freshly created BrowserWindow has webContents before Angular boots and
  // registers its IPC listeners; sending now would be dropped. The URL must be
  // queued and then delivered once the app signals ready.
  const { processProtocolUrl, processPendingProtocolUrls } = loadModule();
  const win = makeWin();
  isAppReady = false;

  processProtocolUrl('superproductivity://create-task?title=Buy%20milk', win);

  assert.deepEqual(win.sent, [], 'nothing is sent to a not-yet-listening renderer');
  assert.equal(showOrFocusCalls.length, 0);
  assert.ok(
    JSON.stringify(logCalls).includes('deferring'),
    'the URL should be logged as deferred',
  );

  // The APP_READY drain (start-app.ts) fires once the renderer has booted.
  isAppReady = true;
  processPendingProtocolUrls(win);

  assert.deepEqual(
    win.sent,
    [
      {
        channel: 'ADD_TASK_FROM_APP_URI',
        payload: { title: 'Buy milk', notes: undefined, projectId: undefined },
      },
    ],
    'the queued URL is delivered once the app is ready',
  );
});

test('does not log user content (the task title) to the exportable log', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  processProtocolUrl('superproductivity://create-task/My%20Secret%20Title', win);

  // The task itself is still dispatched with the real title...
  assert.deepEqual(win.sent, [
    {
      channel: 'ADD_TASK_FROM_APP_URI',
      payload: { title: 'My Secret Title', notes: undefined, projectId: undefined },
    },
  ]);
  // ...but the title must never reach the (exportable) log.
  assert.ok(
    !JSON.stringify(logCalls).includes('Secret'),
    'task title must not appear in any log line',
  );
});

test('a malformed URL is caught and its content never reaches the log', () => {
  const { processProtocolUrl } = loadModule();
  const win = makeWin();

  // A space in the authority makes `new URL()` throw ERR_INVALID_URL, whose
  // enumerable `input` property holds the full raw URL. The catch must log only
  // a non-identifying code, never the error object.
  processProtocolUrl('superproductivity://ho st/x?title=SECRET&notes=PRIVATE', win);

  assert.deepEqual(win.sent, [], 'a malformed URL sends nothing');
  const logged = JSON.stringify(logCalls);
  assert.ok(
    !logged.includes('SECRET') && !logged.includes('PRIVATE'),
    'the raw URL (title/notes) must never reach the exportable log',
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
  // Non-special-scheme hosts aren't auto-lowercased by URL, so a mixed-case
  // action must be normalized here to match the switch and the #7114 guards.
  assert.equal(
    getProtocolAction('superproductivity://Toggle-Visibility'),
    'toggle-visibility',
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
