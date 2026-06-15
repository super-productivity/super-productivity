const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

const modulePath = path.resolve(__dirname, 'ipc-handlers/global-shortcut-layout.ts');

const loadModule = () => {
  delete require.cache[modulePath];
  return require(modulePath);
};

test('maps macOS QWERTZ layout Y shortcut to the QWERTY physical accelerator', () => {
  const { normalizeGlobalShortcutForKeyboardLayout } = loadModule();

  assert.equal(
    normalizeGlobalShortcutForKeyboardLayout('Meta+Y', [['KeyZ', 'y']], true),
    'Meta+Z',
  );
});

test('maps macOS QWERTZ layout Z shortcut to the QWERTY physical accelerator', () => {
  const { normalizeGlobalShortcutForKeyboardLayout } = loadModule();

  assert.equal(
    normalizeGlobalShortcutForKeyboardLayout('Meta+Z', [['KeyY', 'z']], true),
    'Meta+Y',
  );
});

test('keeps shortcuts unchanged without macOS or a keyboard layout snapshot', () => {
  const { normalizeGlobalShortcutForKeyboardLayout } = loadModule();

  assert.equal(
    normalizeGlobalShortcutForKeyboardLayout('Meta+Y', [['KeyZ', 'y']], false),
    'Meta+Y',
  );
  assert.equal(normalizeGlobalShortcutForKeyboardLayout('Meta+Y', [], true), 'Meta+Y');
  assert.equal(
    normalizeGlobalShortcutForKeyboardLayout('Meta+Y', undefined, true),
    'Meta+Y',
  );
});

test('preserves plus-key accelerator parsing', () => {
  const { normalizeGlobalShortcutForKeyboardLayout } = loadModule();

  assert.equal(
    normalizeGlobalShortcutForKeyboardLayout('Ctrl++', [['BracketRight', '+']], true),
    'Ctrl++',
  );
});
