const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
let traySetContextMenuCalls = [];
let ipcHandlers = new Map();
let nextNativeImageIsEmpty = false;
let templateImages = [];
let beforeQuitHandler = () => {};
let mockIsTrayShowCurrentTask = false;
let mockIsTrayShowCurrentCountdown = false;
let taskMenuMessages = [];

const resetModule = () => {
  delete require.cache[indicatorModulePath];
};

// Width/height from the PNG IHDR chunk so tests see the real asset sizes;
// paths that don't exist on disk (the '/icons/' fixtures) fall back to 16px.
const readPngSize = (iconPath) => {
  if (!fs.existsSync(iconPath)) {
    return { width: 16, height: 16 };
  }
  const header = Buffer.alloc(24);
  const fd = fs.openSync(iconPath, 'r');
  fs.readSync(fd, header, 0, 24, 0);
  fs.closeSync(fd);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
};

const createFakeNativeImage = (iconPath, size) => {
  const image = {
    iconPath,
    kind: 'native-image',
    isTemplate: false,
    isEmpty: () => nextNativeImageIsEmpty,
    getSize: () => size,
    resize: ({ width, height }) => createFakeNativeImage(iconPath, { width, height }),
    setTemplateImage: (value) => {
      image.isTemplate = value;
      templateImages.push(image);
    },
  };
  return image;
};

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      class FakeTray {
        constructor(image, guid) {
          createdTrayArgs.push([image, guid]);
        }

        setContextMenu(menu) {
          traySetContextMenuCalls.push(menu);
        }

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
            return createFakeNativeImage(iconPath, readPngSize(iconPath));
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
        getWin: () => ({
          webContents: { send: (...args) => taskMenuMessages.push(args) },
        }),
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
  traySetContextMenuCalls = [];
  ipcHandlers = new Map();
  nextNativeImageIsEmpty = false;
  templateImages = [];
  beforeQuitHandler = () => {};
  mockIsTrayShowCurrentTask = false;
  mockIsTrayShowCurrentCountdown = false;
  taskMenuMessages = [];

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

// Windows binds a tray-icon GUID to the executable's path unless the exe is
// signed. Only our installer/portable wrappers are signed; the installed app
// exe is not, so a GUID can go stale and leave the icon silently invisible
// (#7282 on Store/portable, #10831 on NSIS). Every channel builds the tray
// without a GUID.
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

test('Windows NSIS build creates the tray without a GUID', () => {
  // Neither windowsStore nor PORTABLE_EXECUTABLE_DIR set -> win-nsis.
  initIndicatorOnWindows();

  assert.equal(createdTrayArgs.length, 1);
  assert.equal(createdTrayArgs[0][1], undefined);
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
  assert.match(traySetImageCalls.at(-1).iconPath, /\/icons\/indicator\/running-d\.png$/);

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

// The static stopped/running icons are rendered at 24px so GNOME doesn't
// upscale them (#8484), but the progress-animation frames are 16px. macOS draws
// a template image at its native point size, so without normalizing the menu
// bar icon shrinks (and the title text jumps) the moment tracking starts.
test('macOS hands the tray 16pt template images regardless of source asset size', () => {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: 'darwin',
  });
  const { initIndicator } = loadIndicatorModule();

  initIndicator({
    showApp: () => {},
    quitApp: () => {},
    ICONS_FOLDER: path.resolve(__dirname, 'assets/icons') + '/',
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

  const trayImages = [createdTrayArgs[0][0], ...traySetImageCalls];
  // Sanity check: the fixture really covers both source sizes.
  const sourceSizes = new Set(createdFromPath.map((p) => readPngSize(p).width));
  assert.deepEqual(
    [...sourceSizes].sort((a, b) => a - b),
    [16, 24],
  );

  for (const image of trayImages) {
    assert.equal(image.kind, 'native-image', image.iconPath);
    assert.deepEqual(image.getSize(), { width: 16, height: 16 }, image.iconPath);
    assert.equal(image.isTemplate, true, `not a template image: ${image.iconPath}`);
  }
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

// Both writers fire every second while a focus session runs with the overlay
// hidden: CURRENT_TASK_UPDATED carries task progress, SET_PROGRESS_BAR carries
// the session's. When both reached the icon it flipped between the two frames
// twice a second — the blink reported in #9944. Values differ on purpose here:
// identical ones would be swallowed by setTrayIcon's path dedupe and the test
// would pass even with two writers.
test('tray icon has a single writer per tick while the focus overlay is hidden', () => {
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
  const setProgressBar = ipcHandlers.get('SET_PROGRESS_BAR');
  const task = {
    id: 'T1',
    title: 'Task',
    timeSpent: 30 * 60000,
    timeEstimate: 60 * 60000,
  };

  traySetImageCalls = [];
  for (let i = 0; i < 3; i++) {
    task.timeSpent += 1000;
    // task-electron.effects: isFocusModeEnabled === isOverlayShown === false
    currentTaskUpdated({}, { ...task }, false, 0, false, 0, 'Pomodoro');
    // focus-mode.effects: session progress, unrelated to the task estimate
    setProgressBar({}, { progress: 0.2, progressBarMode: 'normal' });
  }

  const iconPaths = traySetImageCalls.map((image) => image.iconPath);
  assert.deepEqual(iconPaths, ['/icons/indicator/running-anim-l/8.png']);
});

// The mirror case: with the overlay shown CURRENT_TASK_UPDATED stands down, so
// the icon has to follow SET_PROGRESS_BAR. During a Flowtime session that
// message carries the *task* progress (the session owns no progress of its
// own), which is what keeps the ring rendering instead of the plain icon.
test('tray icon follows SET_PROGRESS_BAR while the focus overlay is shown', () => {
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
  const setProgressBar = ipcHandlers.get('SET_PROGRESS_BAR');

  // isFocusModeEnabled === isOverlayShown === true
  currentTaskUpdated(
    {},
    { id: 'T1', title: 'Task', timeSpent: 30 * 60000, timeEstimate: 60 * 60000 },
    false,
    0,
    true,
    0,
    'Flowtime',
  );
  traySetImageCalls = [];
  setProgressBar({}, { progress: 0.5, progressBarMode: 'normal' });

  assert.equal(traySetImageCalls.length, 1);
  assert.match(
    traySetImageCalls.at(-1).iconPath,
    /\/icons\/indicator\/running-anim-l\/8\.png$/,
  );
});

const initIndicatorForMenu = (platform = 'linux') => {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
  const { initIndicator } = loadIndicatorModule();
  initIndicator({
    showApp: () => {},
    quitApp: () => {},
    ICONS_FOLDER: '/icons/',
    forceDarkTray: false,
    app: { on: () => {} },
  });
};

const makeTodayTasks = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `T${i}`,
    title: `Task ${i}`,
    timeEstimate: 0,
    timeSpent: 0,
  }));

const menuTaskLabels = (menu) =>
  menu.template.filter((item) => item.type === 'radio').map((item) => item.label);

// The menu is rebuilt each minute while tracking and every item costs native
// work, so a long Today list must not end up in it whole.
test('tray menu lists the first Today tasks and keeps the running one', () => {
  initIndicatorForMenu();
  const todayTasks = makeTodayTasks(50);

  ipcHandlers.get('TODAY_TASKS_UPDATED')({}, todayTasks);
  const listMenu = traySetContextMenuCalls.at(-1);
  assert.deepEqual(
    menuTaskLabels(listMenu),
    todayTasks.slice(0, 20).map((t) => t.title),
  );
  assert.ok(listMenu.template.some((item) => item.label === '…' && !item.enabled));

  ipcHandlers.get('CURRENT_TASK_UPDATED')({}, todayTasks[42], false, 0, false, 0);
  const trackingMenu = traySetContextMenuCalls.at(-1);
  const radios = trackingMenu.template.filter((item) => item.type === 'radio');
  assert.equal(radios.length, 21);
  assert.equal(radios.at(-1).label, 'Task 42');
  assert.equal(radios.at(-1).checked, true);
  radios[7].click();
  radios.at(-1).click();
  assert.deepEqual(taskMenuMessages, [['SWITCH_TASK', 'T7'], ['TASK_TOGGLE_START']]);
});

test('tray menu rebuilds on a received title change, not an identical list', () => {
  initIndicatorForMenu();
  const todayTasks = makeTodayTasks(3);

  ipcHandlers.get('TODAY_TASKS_UPDATED')({}, todayTasks);
  ipcHandlers.get('CURRENT_TASK_UPDATED')({}, todayTasks[0], false, 0, false, 0);
  const rebuilds = traySetContextMenuCalls.length;

  ipcHandlers.get('TODAY_TASKS_UPDATED')({}, makeTodayTasks(3));
  ipcHandlers.get('CURRENT_TASK_UPDATED')({}, todayTasks[0], false, 0, false, 0);
  assert.equal(traySetContextMenuCalls.length, rebuilds);

  const renamed = makeTodayTasks(3);
  renamed[1].title = 'Renamed';
  ipcHandlers.get('TODAY_TASKS_UPDATED')({}, renamed);
  assert.equal(traySetContextMenuCalls.length, rebuilds + 1);
  assert.deepEqual(menuTaskLabels(traySetContextMenuCalls.at(-1)), [
    'Task 0',
    'Renamed',
    'Task 2',
  ]);
  assert.equal(
    traySetContextMenuCalls.at(-1).template.some((item) => item.label === '…'),
    false,
  );
});

test('tray cap follows list order, removals, and the running-task boundary', () => {
  initIndicatorForMenu();
  const todayTasks = makeTodayTasks(21);
  const updateList = ipcHandlers.get('TODAY_TASKS_UPDATED');
  const updateCurrent = ipcHandlers.get('CURRENT_TASK_UPDATED');
  const menu = () => traySetContextMenuCalls.at(-1);
  const radios = () => menu().template.filter((item) => item.type === 'radio');
  const hasEllipsis = () => menu().template.some((item) => item.label === '…');

  updateList({}, todayTasks.slice(0, 20));
  assert.equal(radios().length, 20);
  assert.equal(hasEllipsis(), false);
  updateList({}, todayTasks);
  assert.equal(radios().length, 20);
  assert.equal(hasEllipsis(), true);
  updateCurrent({}, todayTasks[19], false, 0, false, 0);
  assert.equal(radios().length, 20);
  assert.equal(radios()[19].checked, true);
  updateCurrent({}, todayTasks[20], false, 0, false, 0);
  assert.equal(radios().length, 21);
  assert.equal(hasEllipsis(), false); // The appended task leaves none hidden.

  updateCurrent({}, null, false, 0, false, 0);
  assert.equal(radios().length, 20);
  assert.ok(radios().every((item) => !item.checked));
  assert.equal(hasEllipsis(), true);

  // The renderer omits completed tasks; the receiver uses the supplied order.
  const remaining = todayTasks.slice(1).reverse();
  updateList({}, remaining);
  assert.deepEqual(
    menuTaskLabels(menu()),
    remaining.map((task) => task.title),
  );
  assert.equal(hasEllipsis(), false);
  radios()[0].click();
  assert.deepEqual(taskMenuMessages, [['SWITCH_TASK', 'T20']]);
  updateList({}, []);
  assert.equal(radios().length, 0);
  assert.equal(hasEllipsis(), false);
  assert.deepEqual(
    menu().template.map((item) => item.label),
    ['Show App', 'Quit'],
  );
});

for (const platform of ['linux', 'win32', 'darwin']) {
  test(`${platform}: tray menu rebuilds at minute changes and keeps the current title`, () => {
    mockIsTrayShowCurrentTask = true;
    initIndicatorForMenu(platform);
    const todayTasks = makeTodayTasks(50);
    const updateCurrent = ipcHandlers.get('CURRENT_TASK_UPDATED');
    const updateProgress = ipcHandlers.get('SET_PROGRESS_BAR');
    ipcHandlers.get('TODAY_TASKS_UPDATED')({}, todayTasks);
    const tick = (seconds) => {
      updateCurrent(
        {},
        { ...todayTasks[42], timeSpent: seconds * 1000 },
        false,
        0,
        false,
        0,
      );
      updateProgress({}, { progress: seconds / 120 });
    };
    tick(1);
    const rebuilds = traySetContextMenuCalls.length;
    for (let seconds = 2; seconds < 60; seconds++) tick(seconds);
    assert.equal(traySetContextMenuCalls.length, rebuilds);
    tick(60);
    assert.equal(traySetContextMenuCalls.length, rebuilds + 1);
    const menu = traySetContextMenuCalls.at(-1);
    assert.equal(menu.template[0].label, '1m');
    assert.equal(menuTaskLabels(menu).length, 21);
    const ellipsisIndex = menu.template.findIndex((item) => item.label === '…');
    assert.equal(menu.template[ellipsisIndex].enabled, false);
    assert.equal(menu.template[ellipsisIndex + 1].type, 'separator');
    assert.equal(traySetTitleCalls.at(-1), 'Task 42');
    if (platform === 'darwin') assert.deepEqual(traySetToolTipCalls, []);

    // A current-task rename can change the macOS title without rebuilding the menu.
    updateCurrent(
      {},
      { ...todayTasks[42], title: 'Renamed', timeSpent: 60000 },
      false,
      0,
      false,
      0,
    );
    assert.equal(traySetTitleCalls.at(-1), 'Renamed');
    assert.equal(traySetContextMenuCalls.length, rebuilds + 1);
    const renamed = todayTasks.map((task) =>
      task.id === 'T42' ? { ...task, title: 'Renamed' } : task,
    );
    ipcHandlers.get('TODAY_TASKS_UPDATED')({}, renamed);
    assert.equal(menuTaskLabels(traySetContextMenuCalls.at(-1)).at(-1), 'Renamed');
  });
}
