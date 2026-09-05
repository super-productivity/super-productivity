'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  SERVICE_WORKER_FILES,
  stripServiceWorkerFiles,
} = require('./strip-service-worker-assets');

const withDir = (files, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-strip-'));
  try {
    for (const name of files) {
      fs.writeFileSync(path.join(dir, name), 'x');
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const runCli = (args) =>
  spawnSync(
    process.execPath,
    [path.join(__dirname, 'strip-service-worker-assets.js'), ...args],
    { encoding: 'utf8' },
  );

test('leaves every other asset alone', () => {
  // The whole web bundle lives in this directory; only the four are ours.
  withDir(['ngsw.json', 'index.html', 'main-ABC123.js', 'styles-DEF456.css'], (dir) => {
    assert.deepEqual(stripServiceWorkerFiles(dir).removed, ['ngsw.json']);
    assert.deepEqual(fs.readdirSync(dir).sort(), [
      'index.html',
      'main-ABC123.js',
      'styles-DEF456.css',
    ]);
  });
});

test('an unremovable file is reported, not thrown', () => {
  // A hard failure here would take down F-Droid's prebuild over a cleanup.
  // EISDIR stands in for the realistic cases: EPERM from a Windows file
  // watcher holding a file `cap copy` wrote milliseconds earlier, EACCES on a
  // differently-owned CI tree.
  withDir(['ngsw-worker.js'], (dir) => {
    fs.mkdirSync(path.join(dir, 'ngsw.json'));

    const { removed, failed } = stripServiceWorkerFiles(dir);

    assert.deepEqual(removed, ['ngsw-worker.js']);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].name, 'ngsw.json');
  });
});

test('CLI: an unremovable file does not fail the build', () => {
  // The exit path lives in the CLI, not the pure function — this is the layer
  // that must stay green, because it is the one F-Droid's prebuild runs.
  withDir(['ngsw-worker.js'], (dir) => {
    fs.mkdirSync(path.join(dir, 'ngsw.json'));

    const res = runCli([dir]);

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /could not remove ngsw\.json/);
  });
});

test('a missing target directory is not an error', () => {
  // `cap sync` creates the directory; if it did not run, that is its failure to
  // report, not ours to crash on.
  assert.deepEqual(
    stripServiceWorkerFiles(path.join(os.tmpdir(), 'no-such-assets-dir-here')).removed,
    [],
  );
});

test('CLI: strips every service-worker file and leaves the bundle', () => {
  withDir([...SERVICE_WORKER_FILES, 'index.html'], (target) => {
    const res = runCli([target]);

    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(fs.readdirSync(target), ['index.html']);
  });
});

test('CLI: no arguments is a usage error', () => {
  const res = runCli([]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Usage:/);
});
