'use strict';

// Couples the Linux window identity to the desktop entry and to the packaged
// binary names. Nothing coupled them before, which is how #9674 drifted: the app
// reported a WM_CLASS no `StartupWMClass` matched for seven releases, so shells
// showed a second, generic launcher entry.
//
// How the identity is derived, on the Electron this repo pins (43.x):
// `native_window_views.cc` sets both WM_CLASS fields and the Wayland `app_id`
// from `GetXdgAppId().value_or(Browser::GetName())` — i.e. `CHROME_DESKTOP`
// minus `.desktop`, falling back to the app name only when unset. Electron's own
// bootstrap always sets it, to a slug of the app name, so the fallback is dead
// and `app.setName()` cannot reach the window identity. `electron/start-app.ts`
// pins the value explicitly instead of trusting that slug.
//
// Measured against a real Electron 43.4.0 binary on X11 (2026-08): with this
// repo's `name: superProductivity` and no `productName`, WM_CLASS comes out as
// "superproductivity", "superproductivity" whether or not `app.setName()` runs.
// Adding a `productName` without the pin moves it to "super-productivity".
//
// Blind spot: this asserts the inputs, not a packaged binary's actual WM_CLASS.
// Electron 42 changed this derivation (through 41 it came from `app.getName()`),
// so re-measure on an Electron major bump rather than trusting this file.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { BIN_NAME, RENAMED } = require('./afterPack');

const ROOT = join(__dirname, '..');
const readRoot = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const BUILDER_YAML = readRoot('electron-builder.yaml');

/**
 * Reads a scalar from the flat `key: value` lines of electron-builder.yaml. Not
 * YAML-aware — it takes the first match anywhere in the file and cannot read a
 * quoted or space-containing value. Both keys used here are unique and bare; no
 * YAML parser is declared as a dependency, and the project forbids adding one.
 */
const builderValue = (key) => {
  const match = BUILDER_YAML.match(new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`, 'm'));
  assert.ok(match, `${key} not found as a bare scalar in electron-builder.yaml`);
  return match[1];
};

test('the pinned desktop name matches the desktop entry StartupWMClass', () => {
  const startApp = readRoot('electron', 'start-app.ts');
  const pinned = startApp.match(/const LINUX_DESKTOP_NAME = '([^']+)'/);
  assert.ok(pinned, 'LINUX_DESKTOP_NAME not found in electron/start-app.ts');
  // Keep the `.desktop` suffix: Electron hands this value verbatim to
  // `g_desktop_app_info_new()` when registering the protocol handler, which
  // needs a desktop-file id, and strips the suffix itself for the window id.
  assert.match(pinned[1], /\.desktop$/, 'the pinned name must be a .desktop id');
  assert.equal(
    pinned[1].replace(/\.desktop$/, ''),
    builderValue('StartupWMClass'),
    'app.setDesktopName() sets the X11 WM_CLASS and the Wayland app_id; it must match StartupWMClass (#9674)',
  );
});

test('the desktop entry filename matches StartupWMClass', () => {
  // electron-builder installs the entry as `${executableName}.desktop`, and the
  // pinned desktop name is that filename — so the two have to agree.
  assert.equal(builderValue('StartupWMClass'), builderValue('executableName'));
});

test('the packaged wrapper is installed under the name the desktop entry execs', () => {
  assert.equal(BIN_NAME, builderValue('executableName'));
});

test('the argv wrapper execs the binary afterPack actually renames', () => {
  // Drift here ships a launcher that execs a nonexistent path — the app simply
  // does not start.
  const wrapper = readRoot('build', 'linux', 'snap-wrapper.sh');
  assert.match(wrapper, new RegExp(`/${RENAMED}"`));
});

test('the Windows Store config is loaded after repository config checks', () => {
  const workflow = readRoot(
    '.github',
    'workflows',
    'build-create-windows-store-on-release.yml',
  );
  const buildStep = workflow.indexOf('- name: Build Frontend & Electron');
  const loadStoreConfigStep = workflow.indexOf(
    '- name: Load Electron Builder Windows Store Config',
  );
  const packageStep = workflow.indexOf('- name: Build/Release Electron app');

  assert.notEqual(buildStep, -1, 'Windows Store frontend build step not found');
  assert.notEqual(loadStoreConfigStep, -1, 'Windows Store config-loading step not found');
  assert.notEqual(packageStep, -1, 'Windows Store packaging step not found');
  assert.ok(
    loadStoreConfigStep > buildStep,
    'the Store-only config must not replace electron-builder.yaml before npm run build checks the repository config',
  );
  assert.ok(
    loadStoreConfigStep < packageStep,
    'the Store-only config must replace electron-builder.yaml before electron-builder packages the app',
  );
});
