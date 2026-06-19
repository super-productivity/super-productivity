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
let traySetTitleCalls = [];
let traySetToolTipCalls = [];
let ipcHandlers = new Map();
let nextNativeImageIsEmpty = false;
let beforeQuitHandler = () => {};
let mockIsTrayShowCurrentTask = false;
let mockIsTrayShowCurrentCountdown = false;

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

        setTitle(title) {
          traySetTitleCalls.push(title);
        }

        setToolTip(title) {
          traySetToolTipCalls.push(title);
        }

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
              setTemplateImage: () => {},
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
        getIsTrayShowCurrentTask: () => mockIsTrayShowCurrentTask,
        getIsTrayShowCurrentCountdown: () => mockIsTrayShowCurrentCountdown,
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
  traySetTitleCalls = [];
  traySetToolTipCalls = [];
  ipcHandlers = new Map();
  nextNativeImageIsEmpty = false;
  beforeQuitHandler = () => {};
  mockIsTrayShowCurrentTask = false;
  mockIsTrayShowCurrentCountdown = false;

  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: 'linux',
  });

  installMocks();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  // Windows distribution-channel signals read by getDistChannel(); clear so
  // they never leak into the next test.
  delete process.windowsStore;
  delete process.env.PORTABLE_EXECUTABLE_DIR;
  resetModule();
});

// Windows tray icon GUIDs are bound to the executable path. NSIS installs to a
// stable location, so it keeps its GUID; Store (MSIX) and portable/scoop run
// from versioned paths where a stale GUID makes the icon silently invisible
// (#7282), so those build the tray without a GUID.
const NSIS_TRAY_GUID = 'a2512177-8bee-4b70-a0a8-f3d18e0eab90';

const initIndicatorOnWindows = () => {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: 'win32',
  });
  const { initIndicator } = loadIndicatorModule();
  initIndicator({
    showApp: () => {},
    quitApp: () => {},
    ICONS_FOLDER: '/icons/',
    forceDarkTray: false,
    app: { on: () => {} },
  });
};

test('Windows NSIS build creates the tray with a stable GUID', () => {
  // Neither windowsStore nor PORTABLE_EXECUTABLE_DIR set -> win-nsis.
  initIndicatorOnWindows();

  assert.equal(createdTrayArgs.length, 1);
  assert.equal(createdTrayArgs[0][1], NSIS_TRAY_GUID);
});

test('Windows Store (MSIX) build creates the tray without a GUID', () => {
  process.windowsStore = true;
  initIndicatorOnWindows();

  assert.equal(createdTrayArgs.length, 1);
  assert.equal(createdTrayArgs[0][1], undefined);
});

test('Windows portable build creates the tray without a GUID', () => {
  process.env.PORTABLE_EXECUTABLE_DIR = 'C:\\Users\\test\\sp-portable';
  initIndicatorOnWindows();

  assert.equal(createdTrayArgs.length, 1);
  assert.equal(createdTrayArgs[0][1], undefined);
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

  // On Linux the running icon stays static (no progress-animation frames) to
  // avoid StatusNotifierItem flicker (#4905).
  assert.equal(traySetImageCalls.at(-1).kind, 'native-image');
  assert.match(
    traySetImageCalls.at(-1).iconPath,
    /\/icons\/indicator\/running-d\.png$/,
  );

  beforeQuitHandler();
});

test('non-Linux platforms keep the running progress animation', () => {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: 'darwin',
  });
  const { initIndicator } = loadIndicatorModule();

  initIndicator({
    showApp: () => {},
    quitApp: () => {},
    ICONS_FOLDER: '/icons/',
    forceDarkTray: false,
    app: { on: () => {} },
  });

  const currentTaskUpdated = ipcHandlers.get('CURRENT_TASK_UPDATED');
  currentTaskUpdated(
    {},
    { id: 'T1', title: 'Task', timeSpent: 5 * 60000, timeEstimate: 25 * 60000 },
    false,
    0,
    false,
    0,
    undefined,
  );

  // macOS uses the black (`-l`) template icon and still animates progress.
  assert.match(
    traySetImageCalls.at(-1).iconPath,
    /\/icons\/indicator\/running-anim-l\/3\.png$/,
  );
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

test('tray title shows the task title when countdown display is disabled', () => {
  mockIsTrayShowCurrentTask = true;
  mockIsTrayShowCurrentCountdown = false;
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

  const currentTaskUpdated = ipcHandlers.get('CURRENT_TASK_UPDATED');
  assert.equal(typeof currentTaskUpdated, 'function');

  currentTaskUpdated(
    {},
    {
      id: 'T1',
      title: 'Write release notes',
      timeSpent: 5 * 60000,
      timeEstimate: 25 * 60000,
    },
    false,
    0,
    false,
    0,
    undefined,
  );

  assert.equal(traySetTitleCalls.at(-1), 'Write release notes');
  assert.equal(traySetToolTipCalls.at(-1), 'Write release notes');
});
