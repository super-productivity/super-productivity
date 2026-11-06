'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const appimageHook = require('./appimage-artifact-built');
const afterAll = require('./afterAllArtifactBuild');

const NAME = 'superProductivity-x86_64.AppImage';

test('selects stable and prerelease update channels', () => {
  const select = appimageHook.resolveUpdateChannel;

  assert.equal(select({}), 'latest');
  assert.equal(select({ GITHUB_REF: 'refs/tags/v19.3.1' }), 'latest');
  assert.equal(select({ GITHUB_REF: 'refs/tags/v19.3.1-RC1' }), 'latest-pre');
  assert.equal(select({ GITHUB_REF: 'refs/tags/v19.3.1-beta.2' }), 'latest-pre');
  assert.equal(select({ GITHUB_REF: 'refs/tags/v19.3.1-alpha.1' }), 'latest-pre');
  assert.equal(select({ GITHUB_REF: 'refs/heads/feature/rc' }), 'latest');
  assert.equal(
    select({
      GITHUB_REF: 'refs/tags/v19.3.1-RC1',
      APPIMAGE_UPDATE_CHANNEL: 'latest',
    }),
    'latest',
  );
});
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-hooks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, NAME);
  fs.writeFileSync(file, 'original-artifact');
  return {
    dir,
    file,
    event: { file, target: { name: 'appImage' }, updateInfo: { foo: 'kept' } },
  };
}
function preparedFakeArtifact(argv) {
  const outDir = argv[2];
  const body = Buffer.from('repacked-image-bytes');
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE(5);
  fs.writeFileSync(
    path.join(outDir, NAME),
    Buffer.concat([body, Buffer.alloc(5, 0), footer]),
  );
  fs.writeFileSync(path.join(outDir, `${NAME}.zsync`), 'matching-zsync');
}

test('ignores non-AppImage artifacts without changing them', async (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(f.file);
  f.event.target.name = 'deb';
  assert.equal(
    await appimageHook(f.event, {
      available: () => {
        throw Error('should not probe');
      },
    }),
    false,
  );
  assert.deepEqual(fs.readFileSync(f.file), before);
});

test('missing zsyncmake skips cleanly and preserves the original', async (t) => {
  const f = fixture(t);
  assert.equal(
    await appimageHook(f.event, { available: (cmd) => cmd !== 'zsyncmake' }),
    false,
  );
  assert.equal(fs.readFileSync(f.file, 'utf8'), 'original-artifact');
  assert.equal(fs.existsSync(`${f.file}.zsync`), false);
  assert.deepEqual(await afterAll({ artifactPaths: [f.file] }), []);
});

test('missing appimagetool skips cleanly and preserves the original', async (t) => {
  const f = fixture(t);
  assert.equal(
    await appimageHook(f.event, {
      available: (cmd) => cmd === 'zsyncmake',
      prepare: () => null,
    }),
    false,
  );
  assert.equal(fs.readFileSync(f.file, 'utf8'), 'original-artifact');
  assert.deepEqual(await afterAll({ artifactPaths: [f.file] }), []);
});

test('failure before replacement does not overwrite original artifact', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    appimageHook(f.event, {
      available: () => true,
      run: () => {
        throw new Error('repacking failed');
      },
    }),
    /repacking failed/,
  );
  assert.equal(fs.readFileSync(f.file, 'utf8'), 'original-artifact');
});

test('successful hook updates artifact hash and publishes only generated zsync', async (t) => {
  const f = fixture(t);
  assert.equal(
    await appimageHook(f.event, {
      available: () => true,
      run: (bin, args) => {
        assert.equal(bin, 'bash');
        assert.equal(args[1], f.file);
        preparedFakeArtifact(args);
      },
    }),
    true,
  );
  const bytes = fs.readFileSync(f.file);
  assert.notEqual(bytes.toString(), 'original-artifact');
  assert.equal(f.event.updateInfo.blockMapSize, 5);
  assert.equal(f.event.updateInfo.foo, 'kept');
  assert.equal(
    f.event.updateInfo.sha512,
    crypto.createHash('sha512').update(bytes).digest('base64'),
  );
  assert.equal(fs.readFileSync(`${f.file}.zsync`, 'utf8'), 'matching-zsync');
  assert.deepEqual(await afterAll({ artifactPaths: [f.file] }), [`${f.file}.zsync`]);
  assert.deepEqual(await afterAll({ artifactPaths: [] }), []);
});

test('sidecar install failure restores the original AppImage', async (t) => {
  const f = fixture(t);
  const oldImage = fs.readFileSync(f.file);
  fs.writeFileSync(`${f.file}.zsync`, 'old-zsync');
  let count = 0;
  await assert.rejects(
    appimageHook(f.event, {
      available: () => true,
      run: (_bin, args) => preparedFakeArtifact(args),
      rename: (source, destination) => {
        if (++count === 2) throw new Error('injected zsync replacement failure');
        fs.renameSync(source, destination);
      },
    }),
    /injected zsync replacement failure/,
  );
  assert.deepEqual(fs.readFileSync(f.file), oldImage);
  assert.equal(fs.readFileSync(`${f.file}.zsync`, 'utf8'), 'old-zsync');
  assert.equal(f.event.updateInfo.sha512, undefined);
  assert.deepEqual(await afterAll({ artifactPaths: [f.file] }), []);
});

test('missing local appimagetool can use a pinned CI fallback', async (t) => {
  const f = fixture(t);
  const fallback = '/tmp/test-pinned-appimagetool';
  const calls = [];
  assert.equal(
    await appimageHook(f.event, {
      available: (command) => command === 'zsyncmake' || command === fallback,
      prepare: () => {
        calls.push('prepare');
        return fallback;
      },
      run: (bin, args, options) => {
        assert.equal(bin, 'bash');
        assert.equal(options.env.APPIMAGETOOL, fallback);
        preparedFakeArtifact(args);
      },
    }),
    true,
  );
  assert.deepEqual(calls, ['prepare']);
  assert.ok(fs.existsSync(`${f.file}.zsync`));
});

test('pinned tool fallback unavailable preserves the original AppImage', async (t) => {
  const f = fixture(t);
  assert.equal(
    await appimageHook(f.event, {
      available: (command) => command === 'zsyncmake',
      prepare: () => null,
    }),
    false,
  );
  assert.equal(fs.readFileSync(f.file, 'utf8'), 'original-artifact');
  assert.equal(fs.existsSync(`${f.file}.zsync`), false);
});
