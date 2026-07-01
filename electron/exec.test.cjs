const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

require('ts-node/register/transpile-only');

// Regression guard for GHSA-256q: window.ea.exec exposed child_process.exec
// (arbitrary shell) to the whole renderer, bypassing the per-plugin nodeExecution
// consent gate. It was removed root-and-branch. These tests fail if any part of the
// primitive is reintroduced. They intentionally target the *bare* exec surface only,
// not the sanctioned PLUGIN_EXEC_NODE_SCRIPT / executeScript nodeExecution path.

const electronDir = __dirname;
const read = (...segments) =>
  fs.readFileSync(path.resolve(electronDir, ...segments), 'utf8');

test('IPC enum no longer defines a bare EXEC event', () => {
  const { IPC } = require(
    path.resolve(electronDir, 'shared-with-frontend', 'ipc-events.const.ts'),
  );
  // sanity: the enum loaded and still has the sanctioned nodeExecution members
  assert.equal(IPC.PLUGIN_EXEC_NODE_SCRIPT, 'PLUGIN_EXEC_NODE_SCRIPT');
  // the removed shell primitive must be gone
  assert.equal(IPC.EXEC, undefined);
  assert.ok(!Object.values(IPC).includes('EXEC'));
});

test('the exec IPC handler module was deleted', () => {
  assert.equal(
    fs.existsSync(path.resolve(electronDir, 'ipc-handlers', 'exec.ts')),
    false,
  );
});

test('preload no longer bridges a bare exec / EXEC send', () => {
  const preload = read('preload.ts');
  // sanity: this is the real bridge file
  assert.match(preload, /_send\(/);
  // no channel that forwards to the removed EXEC handler
  assert.doesNotMatch(preload, /_send\(\s*['"]EXEC['"]/);
  // no `exec:` method on the exposed `ea` object (executeScript: stays allowed)
  assert.doesNotMatch(preload, /\bexec\s*:/);
});

test('ElectronAPI type no longer declares exec()', () => {
  const dts = read('electronAPI.d.ts');
  assert.doesNotMatch(dts, /\bexec\s*\(\s*command/);
});

test('IPC wiring no longer registers the exec handler', () => {
  const handler = read('ipc-handler.ts');
  const index = read('ipc-handlers', 'index.ts');
  assert.doesNotMatch(handler, /initExecIpc/);
  assert.doesNotMatch(index, /initExecIpc/);
});
