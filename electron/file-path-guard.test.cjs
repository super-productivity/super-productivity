const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

// Resolve the module via a computed path rather than a literal relative
// require of the .ts file. The .ts source is excluded from the packaged
// app.asar, and tools/verify-electron-requires.js flags literal relative
// requires that cannot resolve in the package (it scans raw text). A computed
// require is skipped by that static check and matches the pattern the other
// electron *.test.cjs files use. The test still runs from source via ts-node.
const { isPathInsideDir } = require(path.resolve(__dirname, 'file-path-guard.ts'));

const DIR = path.resolve('/home/user/.config/superProductivity/backups');

test('accepts a file directly inside the directory', () => {
  assert.equal(isPathInsideDir(DIR, path.join(DIR, '2026-01-01.json')), true);
});

test('accepts a file in a nested subdirectory', () => {
  assert.equal(isPathInsideDir(DIR, path.join(DIR, 'sub', 'a.json')), true);
});

test('collapses traversal that escapes the directory', () => {
  assert.equal(isPathInsideDir(DIR, path.join(DIR, '..', '..', 'secret.txt')), false);
});

test('rejects an absolute path outside the directory', () => {
  assert.equal(isPathInsideDir(DIR, '/etc/passwd'), false);
});

test('rejects a sibling directory that shares a name prefix', () => {
  // `backups-evil` must not be treated as inside `backups`.
  assert.equal(isPathInsideDir(DIR, DIR + '-evil/x.json'), false);
});

test('rejects the directory itself (no file to read)', () => {
  assert.equal(isPathInsideDir(DIR, DIR), false);
});

test('rejects empty / non-string input', () => {
  assert.equal(isPathInsideDir(DIR, ''), false);
  assert.equal(isPathInsideDir(DIR, undefined), false);
  assert.equal(isPathInsideDir(DIR, null), false);
});

test('accepts a path that needs normalization but stays inside', () => {
  assert.equal(isPathInsideDir(DIR, path.join(DIR, 'sub', '..', 'a.json')), true);
});
