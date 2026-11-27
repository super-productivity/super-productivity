const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { promisify } = require('node:util');

require('ts-node/register/transpile-only');

// The GNOME Wayland idle query runs every IDLE_PING_INTERVAL (30s) for the whole
// app lifetime, so each poll must stay a single direct process spawn: no shell,
// no `which gdbus` probe.

const originalModuleLoad = Module._load;
const handlerModulePath = path.resolve(__dirname, 'idle-time-handler.ts');
const ENV_KEYS = [
  'XDG_SESSION_TYPE',
  'XDG_CURRENT_DESKTOP',
  'WAYLAND_DISPLAY',
  'GNOME_SHELL_SESSION_MODE',
  'SNAP',
  'SNAP_NAME',
];
const GDBUS_OUTPUT = '(uint64 12345,)\n';
const DBUS_SEND_OUTPUT =
  'method return time=1792579235.407253 sender=:1.13 -> destination=:1.799 serial=9738 reply_serial=2\n   uint64 4321\n';

let savedEnv;
let shellCommands;
let spawnedFiles;
// file -> argv of its last spawn
let spawnedArgs;
// file -> stdout, or an Error to reject with
let binaries;

const enoent = (file) =>
  Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' });

const execFile = () => {
  throw new Error('callback execFile is not expected');
};
execFile[promisify.custom] = async (file, args) => {
  spawnedFiles.push(file);
  spawnedArgs[file] = args;
  const result = binaries[file] ?? enoent(file);
  if (result instanceof Error) {
    throw result;
  }
  return { stdout: result, stderr: '' };
};

const exec = (command, options, callback) => {
  shellCommands.push(command);
  callback(enoent(command.split(' ')[0]));
};

const noop = () => {};
const scopedLog = { debug: noop, info: noop, warn: noop, error: noop, log: noop };

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent?.filename === handlerModulePath) {
      if (request === 'child_process') {
        return { exec, execFile, spawn: () => assert.fail('spawn is not expected') };
      }
      if (request === 'electron') {
        return {
          app: { isPackaged: true },
          powerMonitor: { on: noop, off: noop, getSystemIdleTime: () => 0 },
        };
      }
      if (request === 'electron-log/main') {
        return { scope: () => scopedLog };
      }
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const createHandler = async ({ isSnap = false } = {}) => {
  process.env.XDG_SESSION_TYPE = 'wayland';
  process.env.XDG_CURRENT_DESKTOP = 'GNOME';
  if (isSnap) {
    process.env.SNAP = '/snap/superproductivity/current';
  }
  delete require.cache[handlerModulePath];
  const { IdleTimeHandler } = require(handlerModulePath);
  const handler = new IdleTimeHandler();
  // let method detection settle before counting per-poll spawns
  await handler._methodDetectionPromise;
  spawnedFiles = [];
  spawnedArgs = {};
  shellCommands = [];
  return handler;
};

test.beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  shellCommands = [];
  spawnedFiles = [];
  spawnedArgs = {};
  binaries = {};
  installMocks();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  delete require.cache[handlerModulePath];
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test('each GNOME Wayland poll spawns gdbus once, without a shell', async () => {
  binaries.gdbus = GDBUS_OUTPUT;
  const handler = await createHandler();
  assert.equal(handler.currentMethod, 'gnomeDBus');

  assert.equal(await handler.getIdleTime(), 12345);
  assert.equal(await handler.getIdleTime(), 12345);

  assert.deepEqual(spawnedFiles, ['gdbus', 'gdbus']);
  assert.deepEqual(spawnedArgs.gdbus, [
    'call',
    '--session',
    '--dest',
    'org.gnome.Mutter.IdleMonitor',
    '--object-path',
    '/org/gnome/Mutter/IdleMonitor/Core',
    '--method',
    'org.gnome.Mutter.IdleMonitor.GetIdletime',
  ]);
  assert.deepEqual(shellCommands, []);
});

test('a missing gdbus falls back to dbus-send without probing gdbus again', async () => {
  binaries['dbus-send'] = DBUS_SEND_OUTPUT;
  const handler = await createHandler();
  assert.equal(handler.currentMethod, 'gnomeDBus');

  assert.equal(await handler.getIdleTime(), 4321);
  assert.equal(await handler.getIdleTime(), 4321);

  assert.deepEqual(spawnedFiles, ['dbus-send', 'dbus-send']);
  assert.deepEqual(spawnedArgs['dbus-send'], [
    '--print-reply',
    '--dest=org.gnome.Mutter.IdleMonitor',
    '/org/gnome/Mutter/IdleMonitor/Core',
    'org.gnome.Mutter.IdleMonitor.GetIdletime',
  ]);
  assert.deepEqual(shellCommands, []);
});

test('a failing gdbus call reports 0 idle time and is retried on the next poll', async () => {
  binaries.gdbus = GDBUS_OUTPUT;
  const handler = await createHandler();
  binaries.gdbus = Object.assign(new Error('Command failed'), { code: 1 });

  assert.equal(await handler.getIdleTime(), 0);
  binaries.gdbus = GDBUS_OUTPUT;
  assert.equal(await handler.getIdleTime(), 12345);

  assert.deepEqual(spawnedFiles, ['gdbus', 'gdbus']);
});

test('inside a snap a missing gdbus never falls back to dbus-send', async () => {
  binaries['dbus-send'] = DBUS_SEND_OUTPUT;
  const handler = await createHandler({ isSnap: true });
  assert.notEqual(handler.currentMethod, 'gnomeDBus');

  assert.equal(await handler._getGnomeIdleTime(), null);
  assert.equal(await handler._getGnomeIdleTime(), null);

  assert.ok(!spawnedFiles.includes('dbus-send'));
});
