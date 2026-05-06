const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

const indicatorModulePath = path.resolve(__dirname, 'indicator.ts');

let createdTrayArgs;
let createdFromPath = [];
let traySetImageCalls = [];
let ipcHandlers = new Map();
let nextNativeImageIsEmpty = false;
let beforeQuitHandler = () => {};

const resetModule = () => {
  delete require.cache[indicatorModulePath];
};

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      class FakeTray {
        constructor(image, guid) {
          createdTrayArgs.push([image, guid]);
        }

        setContextMenu() {}

        on(eventName, handler) {
          if (eventName === 'click') {
            this._clickHandler = handler;
          }
        }

        setImage(image) {
          traySetImageCalls.push(image);
        }

        setTitle() {}

        setToolTip() {}

        destroy() {}
      }

      return {
        Tray: FakeTray,
        Menu: {
          buildFromTemplate: (template) => ({ template }),
        },
        ipcMain: {
          on: (eventName, handler) => {
            ipcHandlers.set(eventName, handler);
          },
        },
        nativeTheme: {
          shouldUseDarkColors: false,
        },
        nativeImage: {
          createFromPath: (iconPath) => {
            createdFromPath.push(iconPath);
            return {
              iconPath,
              kind: 'native-image',
              isEmpty: () => nextNativeImageIsEmpty,
            };
          },
        },
      };
    }

    if (request === 'electron-log/main') {
      return {
        log: () => {},
      };
    }

    if (request === './shared-with-frontend/ipc-events.const') {
      return {
        IPC: {
          UPDATE_SETTINGS: 'UPDATE_SETTINGS',
          SET_PROGRESS_BAR: 'SET_PROGRESS_BAR',
          CURRENT_TASK_UPDATED: 'CURRENT_TASK_UPDATED',
          TODAY_TASKS_UPDATED: 'TODAY_TASKS_UPDATED',
          TASK_TOGGLE_START: 'TASK_TOGGLE_START',
          SWITCH_TASK: 'SWITCH_TASK',
        },
      };
    }

    if (request === './shared-state') {
      return {
        getIsTrayShowCurrentTask: () => false,
        getIsTrayShowCurrentCountdown: () => false,
      };
    }

    if (request === './task-widget/task-widget') {
      return {
        updateTaskWidgetAlwaysShow: () => {},
        updateTaskWidgetEnabled: () => {},
        updateTaskWidgetOpacity: () => {},
        updateTaskWidgetTask: () => {},
        initTaskWidgetSettingsListener: () => {},
      };
    }

    if (request === './main-window') {
      return {
        getWin: () => undefined,
      };
    }

    if (
      request === '../src/app/features/tasks/task.model' ||
      request === '../src/app/features/config/global-config.model'
    ) {
      return {};
    }

    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const loadIndicatorModule = () => {
  resetModule();
  return require(indicatorModulePath);
};

test.beforeEach(() => {
  createdTrayArgs = [];
  createdFromPath = [];
  traySetImageCalls = [];
  ipcHandlers = new Map();
  nextNativeImageIsEmpty = false;
  beforeQuitHandler = () => {};

  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: 'linux',
  });

  installMocks();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  resetModule();
});

test('initIndicator uses NativeImage for Linux tray creation and updates', () => {
  const { initIndicator } = loadIndicatorModule();

  initIndicator({
    showApp: () => {},
    quitApp: () => {},
    ICONS_FOLDER: '/icons/',
    forceDarkTray: false,
    app: {
      on: (eventName, handler) => {
        if (eventName === 'before-quit') {
          beforeQuitHandler = handler;
        }
      },
    },
  });

  assert.equal(createdTrayArgs.length, 1);
  assert.equal(createdTrayArgs[0][0].kind, 'native-image');
  assert.match(createdTrayArgs[0][0].iconPath, /\/icons\/indicator\/stopped-d\.png$/);
  assert.match(createdFromPath[0], /\/icons\/indicator\/stopped-d\.png$/);

  const currentTaskUpdated = ipcHandlers.get('CURRENT_TASK_UPDATED');
  assert.equal(typeof currentTaskUpdated, 'function');

  currentTaskUpdated(
    {},
    { id: 'T1', title: 'Task', timeSpent: 5 * 60000, timeEstimate: 25 * 60000 },
    false,
    0,
    false,
    0,
    undefined,
  );

  assert.equal(traySetImageCalls.at(-1).kind, 'native-image');
  assert.match(
    traySetImageCalls.at(-1).iconPath,
    /\/icons\/indicator\/running-anim-d\/3\.png$/,
  );

  beforeQuitHandler();
});

test('initIndicator falls back to icon path if NativeImage creation is empty', () => {
  nextNativeImageIsEmpty = true;
  const { initIndicator } = loadIndicatorModule();

  initIndicator({
    showApp: () => {},
    quitApp: () => {},
    ICONS_FOLDER: '/icons/',
    forceDarkTray: false,
    app: {
      on: () => {},
    },
  });

  assert.equal(createdTrayArgs.length, 1);
  assert.equal(typeof createdTrayArgs[0][0], 'string');
  assert.match(createdTrayArgs[0][0], /\/icons\/indicator\/stopped-d\.png$/);
});
