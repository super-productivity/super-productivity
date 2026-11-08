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
