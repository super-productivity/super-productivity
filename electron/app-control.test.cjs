const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const appControlModulePath = path.resolve(__dirname, 'ipc-handlers/app-control.ts');

let ipcHandlers;
let nextIsLocked;
let sharedState;
let refreshIndicatorCalls;
let localRestApiConfig;

const resetModule = () => {
  delete require.cache[appControlModulePath];
};

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          exit: () => {},
          relaunch: () => {},
        },
        ipcMain: {
          on: (eventName, handler) => {
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
        showOrFocus: () => {},
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

  installMocks();
});

test.afterEach(() => {
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
    },
  };

  await updateSettings({}, cfg);

  assert.equal(sharedState.isMinimizeToTray, true);
  assert.equal(sharedState.isTrayShowCurrentTask, false);
  assert.equal(sharedState.isTrayShowCurrentCountdown, false);
  assert.equal(refreshIndicatorCalls, 1);
  assert.equal(localRestApiConfig, cfg);
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
