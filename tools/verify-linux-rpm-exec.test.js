'use strict';

// Couples the .rpm desktop entry Exec to the %posttrans that keeps its target
// alive (#11136). xdg-open discards a handler whose Exec path contains a space,
// so the app-builder-lib patch points deb and rpm at /usr/bin/<executableName>.
// On rpm upgrades the old package's unconditional %postun removes that link
// after the new %post, so build/linux/rpm-posttrans.sh must re-create it.
//
// Blind spot: this asserts the inputs. CI checks the built .rpm payload with
// tools/assert-rpm-desktop-exec.sh; the upgrade itself needs a real rpm run.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const readRoot = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const BUILDER_YAML = readRoot('electron-builder.yaml');
const POSTTRANS_PATH = 'build/linux/rpm-posttrans.sh';

const yamlLine = (key) => {
  const match = BUILDER_YAML.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'm'));
  assert.ok(match, `${key} not found in electron-builder.yaml`);
  return match[1];
};

test('the app-builder-lib patch points the rpm desktop entry at /usr/bin', () => {
  const patch = readRoot('patches', 'app-builder-lib+26.16.1.patch');
  const execLine = patch.match(/^\+\s*const exec = (.+)$/m);
  assert.ok(execLine, 'no Exec override in the app-builder-lib patch');
  assert.match(execLine[1], /target === "rpm"/, 'rpm must use the spaceless Exec');
  assert.match(execLine[1], /target === "deb"/, 'deb must keep the spaceless Exec');
  assert.match(execLine[1], /`\/usr\/bin\/\$\{packager\.executableName\} %U`/);
});

test('the rpm ships a %posttrans that re-creates the /usr/bin link', () => {
  assert.ok(
    BUILDER_YAML.includes(`'--rpm-posttrans=${POSTTRANS_PATH}'`),
    'rpm.fpm must pass --rpm-posttrans; without it every upgrade deletes the Exec target',
  );
  assert.ok(statSync(join(ROOT, POSTTRANS_PATH)).isFile());

  const script = readRoot(POSTTRANS_PATH);
  const exe = yamlLine('executableName');
  // Must match the alternative electron-builder's after-install.tpl registers.
  const appBin = `/opt/${yamlLine('productName')}/${exe}`;
  assert.ok(script.includes(`APP_BIN='${appBin}'`), `posttrans must target ${appBin}`);
  assert.ok(
    script.includes(
      `update-alternatives --install '/usr/bin/${exe}' '${exe}' "$APP_BIN"`,
    ),
  );
});
