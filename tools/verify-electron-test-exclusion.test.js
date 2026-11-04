'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { FileMatcher } = require('app-builder-lib/out/fileMatcher');

const root = path.resolve(__dirname, '..');
const fileStat = { isDirectory: () => false };

for (const config of [
  'electron-builder.yaml',
  'build/electron-builder.mas.yaml',
  'build/electron-builder.mas-dev.yaml',
]) {
  test(`${config} excludes Electron tests but preserves runtime modules`, () => {
    const { files } = yaml.load(readFileSync(path.join(root, config), 'utf8'));
    const filter = new FileMatcher(root, root, (value) => value, files).createFilter();
    const includes = (file) => filter(path.join(root, file), fileStat);

    assert.equal(includes('electron/due-task-badge.test.cjs'), false);
    assert.equal(includes('electron/ipc-handlers/app-control.test.cjs'), false);
    assert.equal(includes('electron/due-task-badge.ts'), false);
    assert.equal(includes('electron/due-task-badge.js'), true);
    assert.equal(includes('electron/ipc-handlers/app-control.js'), true);
    assert.equal(includes('electron/preload.js'), true);
    assert.equal(includes('.tmp/angular-dist/index.html'), true);
  });
}
