const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
require('ts-node/register/transpile-only');
const originalLoad = Module._load;
const modulePath = path.resolve(__dirname, 'task-list-widget/task-list-widget.ts');
let windows, handlers, store, saved, mod;
const main = {
  webContents: { send: (...args) => main.sent.push(args) },
  sent: [],
  restore() {},
  show() {},
  focus() {},
};
class Window {
  constructor(options) {
    this.options = options;
    this.bounds = {
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
    };
    this.handlers = {};
    this.webContents = {
      mainFrame: {},
      handlers: {},
      sent: [],
      on: (name, fn) => {
        this.webContents.handlers[name] = fn;
      },
      send: (...args) => this.webContents.sent.push(args),
      setWindowOpenHandler() {},
    };
    windows.push(this);
  }
  on(name, fn) {
    this.handlers[name] = fn;
  }
  once(name, fn) {
    this.on(name, fn);
  }
  loadFile() {
    return Promise.resolve();
  }
  setVisibleOnAllWorkspaces() {}
  setOpacity(value) {
    this.opacity = value;
  }
  setMinimumSize() {}
  setResizable(value) {
    this.resizable = value;
  }
  getBounds() {
    return this.bounds;
  }
  setBounds(bounds) {
    this.bounds = bounds;
  }
  showInactive() {
    this.shown = true;
  }
  isDestroyed() {
    return !!this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const settings = (value) =>
  handlers.UPDATE_TASK_WIDGET_SETTINGS({ sender: main.webContents }, value);
const content = { tasks: [], labels: {}, isDark: true };
test.beforeEach(() => {
  windows = [];
  handlers = {};
  saved = [];
  main.sent = [];
  store = async () => ({});
  Module._load = function (request, parent, isMain) {
    if (request === 'electron')
      return {
        BrowserWindow: Window,
        ipcMain: {
          on: (name, fn) => {
            handlers[name] = fn;
          },
        },
        screen: {
          getPrimaryDisplay: () => ({
            workArea: { x: 1920, y: -1080, width: 1920, height: 1080 },
          }),
          getDisplayMatching: () => ({
            workArea: { x: 1920, y: -1080, width: 1920, height: 1080 },
          }),
        },
      };
    if (request === 'electron-log/main') return { error() {} };
    if (request.endsWith('/main-window')) return { getWin: () => main };
    if (request.endsWith('/simple-store'))
      return {
        loadSimpleStoreAll: () => store(),
        saveSimpleStore: async (key, value) => {
          saved.push([key, value]);
        },
      };
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[modulePath];
  mod = require(modulePath);
  mod.initTaskListWidget();
});
test.afterEach(() => {
  mod.destroyTaskListWidget();
  Module._load = originalLoad;
});

test('list is off by default and can be enabled independently of the timer', async () => {
  settings({ isEnabled: true });
  await flush();
  assert.equal(windows.length, 0);
  settings({ isEnabled: false, isTaskListEnabled: true });
  await flush();
  assert.equal(windows.length, 1);
  assert.equal(windows[0].options.alwaysOnTop, true);
  assert.equal(windows[0].options.title, 'Super Productivity');
  windows[0].handlers['ready-to-show']();
  assert.equal(windows[0].shown, true);
});
test('disabling during async startup does not create a stray widget', async () => {
  let finish;
  store = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  settings({ isTaskListEnabled: true });
  settings({ isTaskListEnabled: false });
  finish({});
  await flush();
  assert.equal(windows.length, 0);
});
test('collapse keeps the widget on top and restores its expanded height', async () => {
  settings({ isTaskListEnabled: true });
  await flush();
  const win = windows[0];
  win.bounds.height = 620;
  settings({ isTaskListEnabled: true, isTaskListCollapsed: true });
  assert.equal(win.bounds.height, 48);
  assert.equal(win.resizable, false);
  assert.equal(win.options.alwaysOnTop, true);
  settings({ isTaskListEnabled: true, isTaskListCollapsed: false });
  assert.equal(win.bounds.height, 620);
  assert.equal(win.resizable, true);
});
test('restores a collapsed window without losing its saved expanded size', async () => {
  store = async () => ({
    taskListWidgetBounds: { x: 2000, y: -900, width: 380, height: 550 },
  });
  settings({ isTaskListEnabled: true, isTaskListCollapsed: true });
  await flush();
  assert.equal(windows[0].bounds.height, 48);
  settings({ isTaskListEnabled: true });
  assert.equal(windows[0].bounds.height, 550);
});
test('uses the actual monitor origin and recovers off-screen bounds', async () => {
  store = async () => ({
    taskListWidgetBounds: { x: -9999, y: -9999, width: 370, height: 480 },
  });
  settings({ isTaskListEnabled: true });
  await flush();
  assert.equal(windows[0].bounds.x, 1920);
  assert.equal(windows[0].bounds.y, -1080);
});
test('replays cached content after load and rejects other senders', async () => {
  settings({ isTaskListEnabled: true });
  handlers.UPDATE_TASK_LIST_WIDGET({ sender: main.webContents }, content);
  await flush();
  const win = windows[0];
  handlers.UPDATE_TASK_LIST_WIDGET({ sender: {} }, { ...content, tasks: ['untrusted'] });
  win.webContents.handlers['did-finish-load']();
  assert.deepEqual(win.webContents.sent.at(-1)[1].tasks, []);
});
test('widget controls update per-device settings and validate the frame', async () => {
  settings({ isTaskListEnabled: true });
  await flush();
  const win = windows[0];
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  handlers['task-list-widget-collapse']({ sender: {}, senderFrame: {} });
  handlers['task-list-widget-filter'](event, 'invalid');
  assert.equal(main.sent.length, 0);
  handlers['task-list-widget-collapse'](event);
  assert.deepEqual(main.sent.at(-1)[1], { isTaskListCollapsed: true });
  handlers['task-list-widget-filter'](event, 'today');
  assert.deepEqual(main.sent.at(-1)[1], { taskListFilter: 'today' });
  handlers['task-list-widget-hide'](event);
  assert.deepEqual(main.sent.at(-1)[1], { isTaskListEnabled: false });
  assert.equal(win.destroyed, true);
});
test('re-enabling after hide creates a fresh window and clamps opacity', async () => {
  settings({ isTaskListEnabled: true });
  await flush();
  settings({ isTaskListEnabled: false });
  assert.equal(windows[0].destroyed, true);
  settings({ isTaskListEnabled: true, opacity: 1 });
  await flush();
  assert.equal(windows.length, 2);
  assert.equal(windows[1].opacity, 0.1);
});
