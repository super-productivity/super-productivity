const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const appControlModulePath = path.resolve(__dirname, 'ipc-handlers/app-control.ts');

let ipcHandlers;
let nextIsLocked;
let sharedState;
let refreshIndicatorCalls;
let localRestApiConfig;
let focusCalls;
let loginItemCalls;
let osOpenAtLogin;
let isOsRefusingLoginItem;
let nextDistChannel;
let tempHome;
let savedEnv;
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalExecPath = Object.getOwnPropertyDescriptor(process, 'execPath');

const resetModule = () => {
  delete require.cache[appControlModulePath];
};

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          getPath: () => tempHome,
          exit: () => {},
          relaunch: () => {},
          getLoginItemSettings: () => ({ openAtLogin: osOpenAtLogin }),
          setLoginItemSettings: (settings) => {
            loginItemCalls.push(settings);
            if (!isOsRefusingLoginItem) {
              osOpenAtLogin = settings.openAtLogin;
            }
          },
        },
        ipcMain: {
          on: (eventName, handler) => {
            ipcHandlers.set(eventName, handler);
          },
          handle: (eventName, handler) => {
            ipcHandlers.set(eventName, handler);
          },
        },
      };
    }

    if (request === '../shared-with-frontend/ipc-events.const') {
      return {
        IPC: {
          SHUTDOWN_NOW: 'SHUTDOWN_NOW',
          EXIT: 'EXIT',
          RELAUNCH: 'RELAUNCH',
          OPEN_DEV_TOOLS: 'OPEN_DEV_TOOLS',
          RELOAD_MAIN_WIN: 'RELOAD_MAIN_WIN',
          TRANSFER_SETTINGS_TO_ELECTRON: 'TRANSFER_SETTINGS_TO_ELECTRON',
          UPDATE_SETTINGS: 'UPDATE_SETTINGS',
          SHOW_OR_FOCUS: 'SHOW_OR_FOCUS',
          LOCK_SCREEN: 'LOCK_SCREEN',
          SET_PROGRESS_BAR: 'SET_PROGRESS_BAR',
          FLASH_FRAME: 'FLASH_FRAME',
          GET_OPEN_AT_LOGIN: 'GET_OPEN_AT_LOGIN',
          SET_OPEN_AT_LOGIN: 'SET_OPEN_AT_LOGIN',
        },
      };
    }

    if (request === '../main-window') {
      return {
        getWin: () => ({
          webContents: {
            openDevTools: () => {},
          },
          reload: () => {},
          setProgressBar: () => {},
          flashFrame: () => {},
          once: () => {},
        }),
      };
    }

    if (request === '../various-shared') {
      return {
        quitApp: () => {},
        showOrFocus: () => {
          focusCalls.push('showOrFocus');
        },
        raiseForReminder: () => {
          focusCalls.push('raiseForReminder');
        },
      };
    }

    if (request === '../shared-state') {
      return {
        getIsLocked: () => nextIsLocked,
        setIsMinimizeToTray: (value) => {
          sharedState.isMinimizeToTray = value;
        },
        setIsTrayShowCurrentTask: (value) => {
          sharedState.isTrayShowCurrentTask = value;
        },
        setIsTrayShowCurrentCountdown: (value) => {
          sharedState.isTrayShowCurrentCountdown = value;
        },
      };
    }

    if (request === '../indicator') {
      return {
        refreshIndicator: () => {
          refreshIndicatorCalls += 1;
        },
      };
    }

    if (request === '../lockscreen') {
      return {
        lockscreen: () => {},
      };
    }

    if (request === '../error-handler-with-frontend-inform') {
      return {
        errorHandlerWithFrontendInform: () => {},
      };
    }

    if (request === '../../src/app/features/config/global-config.model') {
      return {};
    }

    if (request === '../simple-store') {
      return {
        saveSimpleStore: async () => {},
      };
    }

    if (request === '../shared-with-frontend/simple-store.const') {
      return {
        SimpleStoreKey: {
          IS_USE_CUSTOM_WINDOW_TITLE_BAR: 'isUseCustomWindowTitleBar',
        },
      };
    }

    if (request === '../shared-with-frontend/get-dist-channel') {
      return {
        ...originalModuleLoad.call(this, request, parent, isMain),
        getDistChannel: () => nextDistChannel,
      };
    }

    if (request === '../local-rest-api') {
      return {
        updateLocalRestApiConfig: (cfg) => {
          localRestApiConfig = cfg;
        },
      };
    }

    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const loadAppControlModule = () => {
  resetModule();
  return require(appControlModulePath);
};

test.beforeEach(() => {
  ipcHandlers = new Map();
  nextIsLocked = false;
  sharedState = {
    isMinimizeToTray: undefined,
    isTrayShowCurrentTask: undefined,
    isTrayShowCurrentCountdown: undefined,
  };
  refreshIndicatorCalls = 0;
  localRestApiConfig = undefined;
  focusCalls = [];
  loginItemCalls = [];
  osOpenAtLogin = false;
  isOsRefusingLoginItem = false;
  nextDistChannel = 'mac-dmg';

  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-login-item-'));
  savedEnv = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    APPIMAGE: process.env.APPIMAGE,
  };
  process.env.XDG_CONFIG_HOME = path.join(tempHome, 'xdg');
  delete process.env.APPIMAGE;
  installMocks();
});

test.afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  Object.defineProperty(process, 'platform', originalPlatform);
  Object.defineProperty(process, 'execPath', originalExecPath);
  fs.rmSync(tempHome, { recursive: true, force: true });
  Module._load = originalModuleLoad;
  resetModule();
});

test('settings update reads current task tray setting from tasks config', async () => {
  const { initAppControlIpc } = loadAppControlModule();
  initAppControlIpc();

  const updateSettings = ipcHandlers.get('TRANSFER_SETTINGS_TO_ELECTRON');
  assert.equal(typeof updateSettings, 'function');

  const cfg = {
    tasks: {
      isTrayShowCurrent: false,
    },
    misc: {
      isMinimizeToTray: true,
      isTrayShowCurrentTask: true,
      isTrayShowCurrentCountdown: false,
      // Synced from another device: must not reach the REST API listener, whose
      // switch is device-local now.
      isLocalRestApiEnabled: true,
    },
  };

  await updateSettings({}, cfg);

  assert.equal(sharedState.isMinimizeToTray, true);
  assert.equal(sharedState.isTrayShowCurrentTask, false);
  assert.equal(sharedState.isTrayShowCurrentCountdown, false);
  assert.equal(refreshIndicatorCalls, 1);
  assert.equal(localRestApiConfig, undefined);
});

test('settings update falls back to legacy misc tray task setting', async () => {
  const { initAppControlIpc } = loadAppControlModule();
  initAppControlIpc();

  const updateSettings = ipcHandlers.get('UPDATE_SETTINGS');
  assert.equal(typeof updateSettings, 'function');

  await updateSettings(
    {},
    {
      misc: {
        isMinimizeToTray: false,
        isTrayShowCurrentTask: true,
        isTrayShowCurrentCountdown: true,
      },
    },
  );

  assert.equal(sharedState.isTrayShowCurrentTask, true);
  assert.equal(sharedState.isTrayShowCurrentCountdown, true);
  assert.equal(refreshIndicatorCalls, 1);
});

test('the login item is read and written directly on supported builds (#5572)', async () => {
  const { initAppControlIpc } = loadAppControlModule();
  initAppControlIpc();
  const getOpenAtLogin = ipcHandlers.get('GET_OPEN_AT_LOGIN');
  const setOpenAtLogin = ipcHandlers.get('SET_OPEN_AT_LOGIN');

  assert.equal(await getOpenAtLogin({}), false);
  assert.equal(await setOpenAtLogin({}, true), true);
  assert.equal(await getOpenAtLogin({}), true);
  nextDistChannel = 'win-nsis';
  assert.equal(await setOpenAtLogin({}, false), false);

  assert.deepEqual(loginItemCalls, [{ openAtLogin: true }, { openAtLogin: false }]);
});

test('setting the login item reports what the OS accepted (#5572)', async () => {
  const { initAppControlIpc } = loadAppControlModule();
  initAppControlIpc();
  isOsRefusingLoginItem = true;

  assert.equal(await ipcHandlers.get('SET_OPEN_AT_LOGIN')({}, true), false);
});

test('the login item is left alone on unsupported builds (#5572)', async () => {
  const { initAppControlIpc } = loadAppControlModule();
  initAppControlIpc();
  osOpenAtLogin = true;

  for (const channel of [
    'linux-snap',
    'linux-flatpak',
    'win-portable',
    'win-store',
    'mac-store',
    null,
  ]) {
    nextDistChannel = channel;
    assert.equal(await ipcHandlers.get('GET_OPEN_AT_LOGIN')({}), false);
    assert.equal(await ipcHandlers.get('SET_OPEN_AT_LOGIN')({}, false), false);
  }

  assert.deepEqual(loginItemCalls, []);
  assert.deepEqual(fs.readdirSync(tempHome), []);
});

test('synced settings never change the login item (#5572)', async () => {
  const { initAppControlIpc } = loadAppControlModule();
  initAppControlIpc();

  await ipcHandlers.get('UPDATE_SETTINGS')(
    {},
    { misc: { isAutoStartOnSystemStartup: false } },
  );
  await ipcHandlers.get('TRANSFER_SETTINGS_TO_ELECTRON')(
    {},
    { misc: { isAutoStartOnSystemStartup: true } },
  );

  assert.deepEqual(loginItemCalls, []);
});

test('Linux native autostart uses XDG config and the packaged launcher (#5572)', async () => {
  nextDistChannel = 'linux-native';
  Object.defineProperty(process, 'platform', { value: 'linux' });
  const binDir = path.join(tempHome, 'Super Productivity');
  fs.mkdirSync(binDir);
  Object.defineProperty(process, 'execPath', {
    value: path.join(binDir, 'superproductivity-bin'),
  });
  const wrapper = path.join(binDir, 'superproductivity');
  fs.writeFileSync(wrapper, '');
  const entryPath = path.join(
    process.env.XDG_CONFIG_HOME,
    'autostart',
    'superproductivity.desktop',
  );
  const { initAppControlIpc } = loadAppControlModule();
  initAppControlIpc();
  const get = ipcHandlers.get('GET_OPEN_AT_LOGIN');
  const set = ipcHandlers.get('SET_OPEN_AT_LOGIN');

  assert.equal(await get({}), false);
  assert.equal(await set({}, true), true);
  assert.equal(
    fs.readFileSync(entryPath, 'utf8'),
    `[Desktop Entry]\nType=Application\nName=Super Productivity\nExec="${wrapper}"\nTerminal=false\n`,
  );
  for (const disabled of [
    'Hidden=true',
    ' Hidden = true ',
    'X-GNOME-Autostart-enabled = false',
  ]) {
    fs.writeFileSync(entryPath, `[Desktop Entry]\n${disabled}\n`);
    assert.equal(await get({}), false);
  }
  assert.equal(await set({}, false), false);
  assert.equal(fs.existsSync(entryPath), false);
  assert.deepEqual(loginItemCalls, []);
});

test('AppImage autostart uses the persistent image and falls back to ~/.config (#5572)', async () => {
  nextDistChannel = 'linux-appimage';
  process.env.XDG_CONFIG_HOME = 'relative-path-is-invalid';
  process.env.APPIMAGE = '/home/user/My "App" $HOME `test` 50% \\\n\r\t image.AppImage';
  const { initAppControlIpc } = loadAppControlModule();
  initAppControlIpc();
  const set = ipcHandlers.get('SET_OPEN_AT_LOGIN');
  const entryPath = path.join(
    tempHome,
    '.config',
    'autostart',
    'superproductivity.desktop',
  );

  assert.equal(await set({}, true), true);
  assert.equal(
    fs.readFileSync(entryPath, 'utf8').split('\n')[3],
    'Exec="/home/user/My \\\\"App\\\\" \\\\$HOME \\\\`test\\\\` 50%% \\\\\\\\\\n\\r\\t image.AppImage"',
  );
  assert.equal(await set({}, false), false);
  delete process.env.XDG_CONFIG_HOME;
  assert.equal(await set({}, true), true);
  assert.equal(fs.existsSync(entryPath), true);
  assert.deepEqual(loginItemCalls, []);
});

test('Linux autostart propagates write failures without registering a login item (#5572)', async () => {
  nextDistChannel = 'linux-native';
  fs.writeFileSync(process.env.XDG_CONFIG_HOME, 'not a directory');
  const { initAppControlIpc } = loadAppControlModule();
  initAppControlIpc();

  await assert.rejects(async () => ipcHandlers.get('SET_OPEN_AT_LOGIN')({}, true), {
    code: 'ENOTDIR',
  });
  assert.deepEqual(loginItemCalls, []);
});

test('SHOW_OR_FOCUS routes reminder requests to the raise-only path (#10410)', () => {
  const { initAppControlIpc } = loadAppControlModule();
  initAppControlIpc();
  const showOrFocusHandler = ipcHandlers.get('SHOW_OR_FOCUS');

  showOrFocusHandler({});
  showOrFocusHandler({}, { isReminder: true });

  assert.deepEqual(focusCalls, ['showOrFocus', 'raiseForReminder']);
});
