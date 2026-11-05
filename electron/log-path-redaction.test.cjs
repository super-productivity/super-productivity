const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

// Computed path: a literal relative require of a .ts file is flagged by
// tools/verify-electron-requires.js (the .ts is not packaged in app.asar).
const { redactLogPaths, redactLogDatum, REDACTED_HOME_DIR } = require(
  path.resolve(__dirname, 'log-path-redaction.ts'),
);

test('redacts a Windows user profile path', () => {
  const text =
    'C:\\Users\\alice\\AppData\\Local\\Temp\\3LBW\\resources\\app.asar\\electron\\x.js';

  assert.equal(
    redactLogPaths(text),
    REDACTED_HOME_DIR +
      '\\AppData\\Local\\Temp\\3LBW\\resources\\app.asar\\electron\\x.js',
  );
});

test('redacts a Windows user profile path with forward slashes', () => {
  assert.equal(
    redactLogPaths('C:/Users/alice/AppData/app.asar'),
    REDACTED_HOME_DIR + '/AppData/app.asar',
  );
});

test('redacts a Linux home directory inside a stack trace', () => {
  const stack =
    'at registerShowAppShortCuts (/home/asic/Planflow/SuperProductivity/resources/app.asar/electron/ipc-handlers/global-shortcuts.js:24:14)';

  const result = redactLogPaths(stack);

  assert.ok(!result.includes('asic'));
  assert.ok(result.includes(REDACTED_HOME_DIR + '/Planflow/SuperProductivity'));
});

test('redacts a macOS home directory', () => {
  assert.equal(
    redactLogPaths('/Users/bob/Library/Application Support/x'),
    REDACTED_HOME_DIR + '/Library/Application Support/x',
  );
});

test('leaves paths without a home prefix alone', () => {
  const text = 'restore failed: /var/lib/app/data.json and D:\\backup\\dump.json';

  assert.equal(redactLogPaths(text), text);
});

test('does not touch messages without a path separator', () => {
  assert.equal(
    redactLogPaths('task selected: 42 users: 3'),
    'task selected: 42 users: 3',
  );
});

test('redacts strings and Error objects from the electron-log hook', () => {
  const error = new Error('boom at /home/asic/app.js');
  error.stack = 'Error: boom\n    at /home/asic/app.js:1:1';

  assert.equal(redactLogDatum('/home/asic/x'), REDACTED_HOME_DIR + '/x');
  assert.equal(redactLogDatum(42), 42);

  const redacted = redactLogDatum(error);
  assert.ok(redacted instanceof Error);
  assert.ok(!String(redacted.stack).includes('asic'));
  assert.ok(!redacted.message.includes('asic'));
});
