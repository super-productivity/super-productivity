const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node/register/transpile-only');

const { isPathInsideDir } = require('./file-path-guard.ts');

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
