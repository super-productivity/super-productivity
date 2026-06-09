const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

require('ts-node/register/transpile-only');

// Resolve the module via a computed path rather than a literal relative
// require of the .ts file. The .ts source is excluded from the packaged
// app.asar, and tools/verify-electron-requires.js flags literal relative
// requires that cannot resolve in the package (it scans raw text). A computed
// require is skipped by that static check and matches the pattern the other
// electron *.test.cjs files use. The test still runs from source via ts-node.
const { isPathInsideDir, assertPathOutside } = require(
  path.resolve(__dirname, 'file-path-guard.ts'),
);

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

test('assertPathOutside: throws for the dir itself and for a path inside it', () => {
  assert.throws(
    () => assertPathOutside(DIR, path.join(DIR, 'simpleSettings')),
    /protected directory/,
  );
  assert.throws(() => assertPathOutside(DIR, DIR), /protected directory/);
});

test('assertPathOutside: allows a path outside the protected dir', () => {
  assert.doesNotThrow(() => assertPathOutside(DIR, path.resolve('/data/sync/main.json')));
});

test('assertPathOutside: rejects a non-string candidate (fail-closed deny)', () => {
  assert.throws(() => assertPathOutside(DIR, undefined), /protected directory/);
  assert.throws(() => assertPathOutside(DIR, ['/etc/passwd']), /protected directory/);
});

test('canonicalizes: a symlink resolving INTO the protected dir is rejected', () => {
  // Deterministic stand-in for the macOS case-insensitivity bypass — both rely on
  // the same realpath canonicalization. Lexically `<outside>/sneaky/x` looks
  // outside, but the symlink resolves into the protected dir.
  const protectedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-prot-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-out-'));
  try {
    const link = path.join(outsideDir, 'sneaky');
    fs.symlinkSync(protectedDir, link);
    assert.throws(
      () => assertPathOutside(protectedDir, path.join(link, 'simpleSettings')),
      /protected directory/,
    );
    // isPathInsideDir agrees: the symlinked path is "inside" once canonicalized.
    assert.equal(isPathInsideDir(protectedDir, path.join(link, 'simpleSettings')), true);
    // A symlink resolving OUTSIDE is still allowed.
    const linkOut = path.join(protectedDir, 'out');
    fs.symlinkSync(outsideDir, linkOut);
    assert.doesNotThrow(() =>
      assertPathOutside(protectedDir, path.join(linkOut, 'main.json')),
    );
  } finally {
    fs.rmSync(protectedDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});
