const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

// loginctl's IdleSinceHint is the time of the last IdleHint *transition*, so it
// stays set while the session is active. Reading it without IdleHint made active
// users look idle for as long as they had been working.

const handlerModulePath = path.resolve(__dirname, 'idle-time-handler.ts');
const originalModuleLoad = Module._load;
const noop = () => {};

let loginctlStdout = '';

const exec = (command, options, callback) => {
  if (command.startsWith('loginctl')) {
    callback(null, { stdout: loginctlStdout, stderr: '' });
    return;
  }
  callback(Object.assign(new Error(`${command} ENOENT`), { code: 'ENOENT' }));
};

// Pin an X11, non-snap session so constructor-time method detection behaves the
// same on any host running the tests.
const ENV_KEYS = [
  'XDG_SESSION_TYPE',
  'XDG_CURRENT_DESKTOP',
  'WAYLAND_DISPLAY',
  'GNOME_SHELL_SESSION_MODE',
  'SNAP',
  'SNAP_NAME',
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
test.beforeEach(() => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.XDG_SESSION_TYPE = 'x11';
});
test.afterEach(() => {
  ENV_KEYS.forEach((key) =>
    savedEnv[key] === undefined
      ? delete process.env[key]
      : (process.env[key] = savedEnv[key]),
  );
});

const loadHandler = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent?.filename === handlerModulePath) {
      if (request === 'child_process') {
        return {
          exec,
          execFile: () => assert.fail('execFile is not expected'),
          spawn: () => assert.fail('spawn is not expected'),
        };
      }
      if (request === 'electron') {
        return {
          app: { isPackaged: true },
          powerMonitor: { on: noop, off: noop, getSystemIdleTime: () => 0 },
        };
      }
      if (request === 'electron-log/main') {
        const log = { debug: noop, info: noop, warn: noop, error: noop, log: noop };
        return { scope: () => log };
      }
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
  delete require.cache[handlerModulePath];
  const { IdleTimeHandler } = require(handlerModulePath);
  Module._load = originalModuleLoad;
  return new IdleTimeHandler();
};

const toMicros = (ms) => String(ms * 1000);

test('loginctl reports 0 while the session is active, despite an old IdleSinceHint', async () => {
  const handler = loadHandler();
  loginctlStdout = `IdleHint=no\nIdleSinceHint=${toMicros(Date.now() - 600_000)}\n`;

  assert.equal(await handler._getLoginctlIdleTime(), 0);
});

test('loginctl reports the elapsed idle time when IdleHint=yes', async () => {
  const handler = loadHandler();
  loginctlStdout = `IdleHint=yes\nIdleSinceHint=${toMicros(Date.now() - 600_000)}\n`;

  const idleMs = await handler._getLoginctlIdleTime();
  assert.ok(idleMs >= 600_000 && idleMs < 610_000, `got ${idleMs}`);
});

test('loginctl output without IdleHint is treated as unavailable', async () => {
  const handler = loadHandler();
  loginctlStdout = `IdleSinceHint=${toMicros(Date.now() - 600_000)}\n`;

  assert.equal(await handler._getLoginctlIdleTime(), null);
});

test('loginctl IdleHint=yes without IdleSinceHint is treated as unavailable', async () => {
  const handler = loadHandler();
  loginctlStdout = 'IdleHint=yes\n';

  assert.equal(await handler._getLoginctlIdleTime(), null);
});
