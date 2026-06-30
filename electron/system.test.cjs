const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const systemModulePath = path.resolve(__dirname, 'ipc-handlers/system.ts');
const { IPC } = require(
  path.resolve(__dirname, 'shared-with-frontend/ipc-events.const.ts'),
);

let listeners;
let spawnCalls;
let spawnErrorListener;

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { isEmojiPanelSupported: () => false, showEmojiPanel: () => {} },
        dialog: { showSaveDialog: async () => ({ canceled: true }) },
        ipcMain: {
          on: (channel, listener) => listeners.set(channel, listener),
          handle: (channel, listener) => listeners.set(channel, listener),
        },
        shell: { openPath: () => {}, openExternal: () => {} },
      };
    }
    if (request === 'child_process') {
      return {
        spawn: (command, args, options) => {
          spawnCalls.push({ command, args, options });
          return {
            on: (eventName, listener) => {
              if (eventName === 'error') {
                spawnErrorListener = listener;
              }
              return this;
            },
            unref: () => {},
          };
        },
      };
    }
    if (request === 'electron-log/main') {
      return { error: () => {} };
    }
    if (request.endsWith('common.const')) {
      return { IS_GNOME_DESKTOP: true };
    }
    if (request.endsWith('main-window')) {
      return { getWin: () => null };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

test.beforeEach(() => {
  listeners = new Map();
  spawnCalls = [];
  spawnErrorListener = undefined;
  installMocks();
  delete require.cache[require.resolve(systemModulePath)];
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
});

test('open system keyboard settings launches GNOME keyboard settings', () => {
  const { initSystemIpc } = require(systemModulePath);
  initSystemIpc();

  listeners.get(IPC.OPEN_SYSTEM_KEYBOARD_SETTINGS)();

  assert.deepEqual(spawnCalls, [
    {
      command: 'gnome-control-center',
      args: ['keyboard'],
      options: { detached: true, stdio: 'ignore' },
    },
  ]);
  assert.equal(typeof spawnErrorListener, 'function');
});

test('open system keyboard settings handles GNOME launch errors', () => {
  const { initSystemIpc } = require(systemModulePath);
  initSystemIpc();

  listeners.get(IPC.OPEN_SYSTEM_KEYBOARD_SETTINGS)();

  assert.doesNotThrow(() => spawnErrorListener(new Error('missing binary')));
});
