const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const modulePath = path.resolve(__dirname, 'launcher-shortcuts.ts');
const originalModuleLoad = Module._load;
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

let openedUrls;

const loadModule = (platform) => {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
  openedUrls = [];
  delete require.cache[modulePath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return { Menu: { buildFromTemplate: (template) => ({ template }) } };
    }
    if (request === './protocol-handler') {
      return {
        PROTOCOL_PREFIX: 'superproductivity://',
        processProtocolUrl: (url, win) => openedUrls.push({ url, win }),
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalModuleLoad;
  }
};

const makeApp = (isPackaged = true) => {
  const app = { isPackaged, dockMenu: null, userTasks: null };
  app.dock = { setMenu: (menu) => (app.dockMenu = menu) };
  app.setUserTasks = (tasks) => (app.userTasks = tasks);
  return app;
};

test.afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  delete process.windowsStore;
  delete process.env.PORTABLE_EXECUTABLE_DIR;
});

test('macOS dock menu opens New task, Today and Inbox through the protocol handler', () => {
  const { initLauncherShortcuts } = loadModule('darwin');
  const app = makeApp();
  const win = {};

  initLauncherShortcuts(app, () => win);
  app.dockMenu.template.forEach((item) => item.click());

  assert.deepEqual(
    app.dockMenu.template.map((item) => item.label),
    ['New task', 'Today', 'Inbox'],
  );
  assert.deepEqual(openedUrls, [
    { url: 'superproductivity://add-task', win },
    { url: 'superproductivity://today', win },
    { url: 'superproductivity://inbox', win },
  ]);
  assert.equal(app.userTasks, null);
});

test('Windows installer build relaunches the exe with each URL from the jump list', () => {
  const { initLauncherShortcuts } = loadModule('win32');
  const app = makeApp();

  initLauncherShortcuts(app, () => null);

  assert.deepEqual(
    app.userTasks.map((task) => [task.title, task.arguments]),
    [
      ['New task', 'superproductivity://add-task'],
      ['Today', 'superproductivity://today'],
      ['Inbox', 'superproductivity://inbox'],
    ],
  );
  assert.ok(
    app.userTasks.every(
      (task) => task.program === process.execPath && task.iconPath === process.execPath,
    ),
  );
});

test('no jump list for Store, portable or unpackaged Windows builds', () => {
  const { initLauncherShortcuts } = loadModule('win32');
  const unpackaged = makeApp(false);
  initLauncherShortcuts(unpackaged, () => null);

  process.windowsStore = true;
  const store = makeApp();
  initLauncherShortcuts(store, () => null);
  delete process.windowsStore;

  process.env.PORTABLE_EXECUTABLE_DIR = 'C:\\sp-portable';
  const portable = makeApp();
  initLauncherShortcuts(portable, () => null);

  assert.deepEqual(
    [unpackaged, store, portable].map((app) => app.userTasks),
    [null, null, null],
  );
});
