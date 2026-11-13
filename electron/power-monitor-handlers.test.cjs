const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const handlersPath = path.resolve(__dirname, 'power-monitor-handlers.ts');
const originalModuleLoad = Module._load;

let lockedStates = [];

const loadModule = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {};
    }
    if (request === 'electron-log/main') {
      return { log: () => {} };
    }
    if (request === './shared-state') {
      return { setIsLocked: (value) => lockedStates.push(value) };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
  delete require.cache[handlersPath];
  try {
    return require(handlersPath);
  } finally {
    Module._load = originalModuleLoad;
  }
};

const createPowerMonitor = () => {
  const listeners = new Map();
  return {
    on: (event, cb) => listeners.set(event, cb),
    emit: (event) => listeners.get(event)(),
  };
};

// Any call that raises, focuses or flashes the window counts as an attention
// request; only webContents.send is expected.
const createWin = () => {
  const attentionCalls = [];
  const sent = [];
  const record = (name) => () => attentionCalls.push(name);
  return {
    attentionCalls,
    sent,
    webContents: { send: (channel, ...args) => sent.push([channel, ...args]) },
    show: record('show'),
    showInactive: record('showInactive'),
    focus: record('focus'),
    restore: record('restore'),
    moveTop: record('moveTop'),
    flashFrame: record('flashFrame'),
    setAlwaysOnTop: record('setAlwaysOnTop'),
  };
};

for (const [sleepEvent, wakeEvent] of [
  ['suspend', 'resume'],
  ['lock-screen', 'unlock-screen'],
]) {
  test(`${wakeEvent} after ${sleepEvent} does not request attention (#9560)`, () => {
    const { initPowerMonitorHandlers } = loadModule();
    const powerMonitor = createPowerMonitor();
    const win = createWin();
    const idleTimes = [];
    lockedStates = [];
    initPowerMonitorHandlers(
      powerMonitor,
      () => win,
      (idleTime) => idleTimes.push(idleTime),
    );

    powerMonitor.emit(sleepEvent);
    powerMonitor.emit(wakeEvent);

    assert.deepEqual(win.attentionCalls, []);
    assert.deepEqual(
      win.sent.map(([channel]) => channel),
      ['SUSPEND', 'RESUME'],
    );
    assert.equal(idleTimes.length, 1);
    assert.ok(idleTimes[0] >= 0);
    assert.deepEqual(lockedStates, [true, false]);
  });
}

// start-app registers the handlers on `ready` while createMainWin() is still
// awaiting createWindow(), so the window must be read when the event fires.
test('sends to a window created after the handlers are registered (#11430)', () => {
  const { initPowerMonitorHandlers } = loadModule();
  const powerMonitor = createPowerMonitor();
  let win;
  lockedStates = [];
  initPowerMonitorHandlers(
    powerMonitor,
    () => win,
    () => {},
  );
  win = createWin();

  powerMonitor.emit('lock-screen');
  powerMonitor.emit('unlock-screen');

  assert.deepEqual(
    win.sent.map(([channel]) => channel),
    ['SUSPEND', 'RESUME'],
  );
});

test('does not throw when no window exists yet (#11430)', () => {
  const { initPowerMonitorHandlers } = loadModule();
  const powerMonitor = createPowerMonitor();
  lockedStates = [];
  initPowerMonitorHandlers(
    powerMonitor,
    () => undefined,
    () => {},
  );

  assert.doesNotThrow(() => powerMonitor.emit('suspend'));
  assert.doesNotThrow(() => powerMonitor.emit('resume'));
  assert.deepEqual(lockedStates, [true, false]);
});
