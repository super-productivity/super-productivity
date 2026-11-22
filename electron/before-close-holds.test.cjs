const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

require('ts-node/register/transpile-only');

const log = test.mock.method(require('electron-log/main'), 'log', () => {});
test.after(() => log.mock.restore());

const { registerBeforeCloseHandlers } = require('./before-close-holds.ts');
const { IPC } = require('./shared-with-frontend/ipc-events.const.ts');

const finishDay = 'FINISH_DAY_BEFORE_CLOSE_EFFECT';
const save = 'SYNC_BEFORE_CLOSE_ID';

const setup = ({ crashed = false } = {}) => {
  const ipc = new EventEmitter();
  const win = new EventEmitter();
  const notifications = [];
  const close = test.mock.fn();
  const prepareClose = test.mock.fn();
  const quitImmediately = test.mock.fn();
  win.close = close;
  win.isDestroyed = () => false;
  win.webContents = {
    isCrashed: () => crashed,
    send: (channel, ids) => notifications.push([channel, [...ids]]),
  };
  registerBeforeCloseHandlers(ipc, win, () => true, quitImmediately, prepareClose);

  ipc.emit(IPC.REGISTER_BEFORE_CLOSE, null, { id: save });
  ipc.emit(IPC.REGISTER_BEFORE_CLOSE, null, { id: finishDay });

  return {
    notifications,
    close,
    prepareClose,
    quitImmediately,
    requestQuit: () => {
      const preventDefault = test.mock.fn();
      win.emit('close', { preventDefault });
      assert.equal(preventDefault.mock.callCount(), 1);
    },
    done: (id) => ipc.emit(IPC.BEFORE_CLOSE_DONE, null, { id }),
    unregister: (id) => ipc.emit(IPC.UNREGISTER_BEFORE_CLOSE, null, { id }),
  };
};

const notification = (...ids) => [IPC.NOTIFY_ON_CLOSE, ids];

test('re-notifies save after confirmation and quits after save completes', () => {
  const { notifications, close, prepareClose, requestQuit, done } = setup();

  requestQuit();
  assert.deepEqual(notifications, [notification(save, finishDay)]);
  assert.equal(close.mock.callCount(), 0);

  done(finishDay);
  assert.deepEqual(notifications, [notification(save, finishDay), notification(save)]);
  assert.equal(close.mock.callCount(), 0);

  done(save);
  assert.equal(prepareClose.mock.callCount(), 1);
  assert.equal(close.mock.callCount(), 1);
});

test('keeps save pending when Finish Day or Cancel leaves the hold registered', () => {
  const { notifications, close, requestQuit, done } = setup();

  requestQuit();
  requestQuit();
  assert.deepEqual(notifications, [
    notification(save, finishDay),
    notification(save, finishDay),
  ]);
  assert.equal(close.mock.callCount(), 0);

  done(finishDay);
  done(save);
  assert.deepEqual(notifications.at(-1), notification(save));
  assert.equal(close.mock.callCount(), 1);
});

test('unregistering a disabled prompt after Cancel leaves save for the next Quit', () => {
  const { notifications, close, requestQuit, unregister, done } = setup();

  requestQuit();
  unregister(finishDay);
  assert.deepEqual(notifications, [notification(save, finishDay)]);
  assert.equal(close.mock.callCount(), 0);

  requestQuit();
  assert.deepEqual(notifications, [notification(save, finishDay), notification(save)]);
  done(save);
  assert.equal(close.mock.callCount(), 1);
});

test('unregistering a disabled prompt then confirming resumes the same Quit', () => {
  const { notifications, close, requestQuit, unregister, done } = setup();

  requestQuit();
  unregister(finishDay);
  assert.deepEqual(notifications, [notification(save, finishDay)]);

  done(finishDay);
  assert.deepEqual(notifications, [notification(save, finishDay), notification(save)]);
  assert.equal(close.mock.callCount(), 0);

  done(save);
  assert.equal(close.mock.callCount(), 1);
});

test('quits immediately when the renderer cannot answer', () => {
  const { notifications, close, quitImmediately, requestQuit } = setup({ crashed: true });

  requestQuit();

  assert.deepEqual(notifications, []);
  assert.equal(close.mock.callCount(), 0);
  assert.equal(quitImmediately.mock.callCount(), 1);
});
