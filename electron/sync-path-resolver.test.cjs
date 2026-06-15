const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { promises: fs } = require('node:fs');
const fsModule = require('node:fs');

require('ts-node/register/transpile-only');

const { resolveSyncPath } = require(path.resolve(__dirname, 'sync-path-resolver.ts'));

const mkSync = async () => fsModule.realpathSync.native(
  await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-')),
);
const mkOutside = async () => fsModule.realpathSync.native(
  await fs.mkdtemp(path.join(os.tmpdir(), 'sp-out-')),
);
const mkUserData = async () => fsModule.realpathSync.native(
  await fs.mkdtemp(path.join(os.tmpdir(), 'sp-userdata-')),
);

test('resolves a relative file path inside the sync root', async () => {
  const syncDir = await mkSync();
  const userData = await mkUserData();
  try {
    const r = resolveSyncPath(syncDir, 'main.json', userData);
    assert.equal(r.absolutePath, path.join(syncDir, 'main.json'));
    assert.equal(r.root, syncDir);
    assert.equal(r.isRoot, false);
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('resolves the root itself when relativePath is empty or "."', async () => {
  const syncDir = await mkSync();
  const userData = await mkUserData();
  try {
    for (const r of ['', '.']) {
      const result = resolveSyncPath(syncDir, r, userData);
      assert.equal(result.absolutePath, syncDir);
      assert.equal(result.isRoot, true);
    }
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('rejects absolute renderer-supplied paths', async () => {
  const syncDir = await mkSync();
  const userData = await mkUserData();
  try {
    assert.throws(
      () => resolveSyncPath(syncDir, '/etc/passwd', userData),
      /Path not allowed/,
    );
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('rejects .. traversal that escapes the sync root', async () => {
  const syncDir = await mkSync();
  const userData = await mkUserData();
  try {
    for (const r of ['../escape', 'a/../../b', '../..']) {
      assert.throws(
        () => resolveSyncPath(syncDir, r, userData),
        /Path not allowed/,
        `expected ${r} to be rejected`,
      );
    }
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('accepts a path that needs normalization but stays inside', async () => {
  const syncDir = await mkSync();
  const userData = await mkUserData();
  try {
    await fs.mkdir(path.join(syncDir, 'sub'));
    const r = resolveSyncPath(syncDir, 'sub/../main.json', userData);
    assert.equal(r.absolutePath, path.join(syncDir, 'main.json'));
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('rejects when syncFolderPath is missing or empty', async () => {
  const userData = await mkUserData();
  try {
    assert.throws(() => resolveSyncPath(undefined, 'main.json', userData), /Path not allowed/);
    assert.throws(() => resolveSyncPath('', 'main.json', userData), /Path not allowed/);
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('rejects when syncFolderPath does not exist on disk', async () => {
  const userData = await mkUserData();
  try {
    assert.throws(
      () => resolveSyncPath(path.join(userData, 'missing'), 'main.json', userData),
      /Path not allowed/,
    );
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('rejects when syncFolderPath equals or is inside userData', async () => {
  const userData = await mkUserData();
  try {
    assert.throws(
      () => resolveSyncPath(userData, 'main.json', userData),
      /Path not allowed/,
    );
    const insideUserData = path.join(userData, 'evil');
    await fs.mkdir(insideUserData);
    assert.throws(
      () => resolveSyncPath(insideUserData, 'main.json', userData),
      /Path not allowed/,
    );
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('rejects a leaf that is a symlink (even pointing inside the root)', async () => {
  const syncDir = await mkSync();
  const userData = await mkUserData();
  try {
    await fs.writeFile(path.join(syncDir, 'real.json'), '{}', 'utf8');
    await fs.symlink(
      path.join(syncDir, 'real.json'),
      path.join(syncDir, 'link.json'),
      'file',
    );
    assert.throws(
      () => resolveSyncPath(syncDir, 'link.json', userData),
      /Path not allowed/,
    );
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('rejects writing under a directory symlink that escapes the root', async () => {
  const syncDir = await mkSync();
  const outsideDir = await mkOutside();
  const userData = await mkUserData();
  try {
    await fs.symlink(outsideDir, path.join(syncDir, 'escape'), 'dir');
    assert.throws(
      () => resolveSyncPath(syncDir, 'escape/new.json', userData),
      /Path not allowed/,
    );
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('allows writing under a directory symlink that stays inside the root', async () => {
  const syncDir = await mkSync();
  const userData = await mkUserData();
  try {
    await fs.mkdir(path.join(syncDir, 'real-sub'));
    await fs.symlink(path.join(syncDir, 'real-sub'), path.join(syncDir, 'sub'), 'dir');
    const r = resolveSyncPath(syncDir, 'sub/new.json', userData);
    assert.equal(r.absolutePath, path.join(syncDir, 'sub', 'new.json'));
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('rejects when leaf lstat fails with non-ENOENT (EACCES etc. fail closed)', async () => {
  // Hard to portably trigger EACCES on lstat for a leaf — emulate by
  // monkey-patching lstatSync to throw EACCES once.
  const syncDir = await mkSync();
  const userData = await mkUserData();
  const realLstat = fsModule.lstatSync;
  try {
    fsModule.lstatSync = (p) => {
      if (typeof p === 'string' && p.endsWith('main.json')) {
        const err = new Error('emulated EACCES');
        err.code = 'EACCES';
        throw err;
      }
      return realLstat(p);
    };
    assert.throws(
      () => resolveSyncPath(syncDir, 'main.json', userData),
      /Path not allowed/,
    );
  } finally {
    fsModule.lstatSync = realLstat;
    await fs.rm(syncDir, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('rejects when an ancestor realpath fails with non-ENOENT (fail closed)', async () => {
  const syncDir = await mkSync();
  const userData = await mkUserData();
  const realRealpath = fsModule.realpathSync.native;
  try {
    let calls = 0;
    fsModule.realpathSync.native = (p) => {
      calls += 1;
      // First call is for canonicalRoot — must succeed.
      if (calls === 1) return realRealpath(p);
      // Subsequent calls (ancestor walk) fail with EACCES.
      const err = new Error('emulated EACCES');
      err.code = 'EACCES';
      throw err;
    };
    assert.throws(
      () => resolveSyncPath(syncDir, 'newdir/file.json', userData),
      /Path not allowed/,
    );
  } finally {
    fsModule.realpathSync.native = realRealpath;
    await fs.rm(syncDir, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('rejects non-string inputs (fail-closed)', async () => {
  const syncDir = await mkSync();
  const userData = await mkUserData();
  try {
    assert.throws(() => resolveSyncPath(syncDir, undefined, userData), /Path not allowed/);
    assert.throws(() => resolveSyncPath(syncDir, 42, userData), /Path not allowed/);
    assert.throws(() => resolveSyncPath(syncDir, ['main.json'], userData), /Path not allowed/);
    assert.throws(() => resolveSyncPath(syncDir, 'main.json', undefined), /Path not allowed/);
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('error never includes the offending path', async () => {
  const syncDir = await mkSync();
  const userData = await mkUserData();
  try {
    let captured;
    try {
      resolveSyncPath(syncDir, '/etc/passwd', userData);
    } catch (e) {
      captured = e;
    }
    assert.ok(captured);
    assert.ok(!String(captured.message).includes('/etc/passwd'));
    assert.equal(captured.name, 'PathNotAllowedError');
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});

test('canonicalizes the root each call (folder moved between launches)', async () => {
  // The function reads realpath every call rather than trusting a cached
  // canonicalization, so a moved/relinked folder is caught immediately.
  const userData = await mkUserData();
  const original = await mkSync();
  const replacement = await mkOutside();
  try {
    // Sanity: original works.
    const a = resolveSyncPath(original, 'a.json', userData);
    assert.equal(a.absolutePath, path.join(original, 'a.json'));

    // Swap original to be a symlink to replacement.
    await fs.rm(original, { recursive: true, force: true });
    await fs.symlink(replacement, original, 'dir');

    const b = resolveSyncPath(original, 'a.json', userData);
    assert.equal(b.root, replacement); // canonical now points elsewhere
    assert.equal(b.absolutePath, path.join(replacement, 'a.json'));
  } finally {
    await fs.rm(original, { recursive: true, force: true }).catch(() => {});
    await fs.rm(replacement, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});
