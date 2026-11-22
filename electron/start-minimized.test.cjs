const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { getStartMinimizedMode, START_MINIMIZED_ARG } = require(
  path.resolve(__dirname, 'start-minimized.ts'),
);

test('the flag is --start-minimized', () => {
  assert.equal(START_MINIMIZED_ARG, '--start-minimized');
});

test('hides the window when there is a tray to bring it back', () => {
  assert.equal(getStartMinimizedMode({ hasTray: true, isMac: false }), 'hide');
});

test('hides the window on macOS even without a tray (the Dock icon remains)', () => {
  assert.equal(getStartMinimizedMode({ hasTray: false, isMac: true }), 'hide');
});

test('minimizes instead of hiding without a tray on Windows/Linux (#7282)', () => {
  assert.equal(getStartMinimizedMode({ hasTray: false, isMac: false }), 'minimize');
});

test('keeps the taskbar entry when explicitly requested', () => {
  assert.equal(
    getStartMinimizedMode({
      hasTray: true,
      isMac: false,
      keepTaskbarIcon: true,
    }),
    'minimize',
  );
});

test('preserves the default tray behavior when disabled', () => {
  assert.equal(
    getStartMinimizedMode({
      hasTray: true,
      isMac: false,
      keepTaskbarIcon: false,
    }),
    'hide',
  );
});

test('keeps the window minimized on macOS when requested', () => {
  assert.equal(
    getStartMinimizedMode({
      hasTray: false,
      isMac: true,
      keepTaskbarIcon: true,
    }),
    'minimize',
  );
});

test('keeps the window reachable without a tray', () => {
  assert.equal(
    getStartMinimizedMode({
      hasTray: false,
      isMac: false,
      keepTaskbarIcon: true,
    }),
    'minimize',
  );
});
