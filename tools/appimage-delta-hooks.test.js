'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const appimageHook = require('./appimage-artifact-built');
const afterAll = require('./afterAllArtifactBuild');
const {
  findUpdateSection,
  readEmbeddedBlockmap,
  writeUpdateInfo,
} = require('./appimage-update-info');

const NAME = 'superProductivity-x86_64.AppImage';
const UPDATE_INFO = `gh-releases-zsync|super-productivity|super-productivity|latest|${NAME}.zsync`;
const RELEASE = { GITHUB_REF: 'refs/tags/v19.3.1' };

function appendFakeBlockmap(file) {
  const compressed = zlib.deflateRawSync(
    JSON.stringify({ files: [{ name: 'fake-appimage' }] }),
  );
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE(compressed.length);
  fs.appendFileSync(file, Buffer.concat([compressed, footer]));
  return { blockMapSize: compressed.length };
}

function fixture(t, { missingSection = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-delta-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, NAME);
  const bytes = Buffer.alloc(4096);

  // Minimal ELF64 x86_64 with section headers and a 1024-byte .upd_info section.
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  bytes.writeUInt16LE(62, 18);
  bytes.writeBigUInt64LE(128n, 40); // section header table
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(3, 60);
  bytes.writeUInt16LE(1, 62); // section-name string table

  const names = Buffer.from('\0.shstrtab\0.upd_info\0');
  names.copy(bytes, 512);
  const namesHeader = 128 + 64;
  bytes.writeUInt32LE(1, namesHeader);
  bytes.writeUInt32LE(3, namesHeader + 4);
  bytes.writeBigUInt64LE(512n, namesHeader + 24);
  bytes.writeBigUInt64LE(BigInt(names.length), namesHeader + 32);
  const updateHeader = namesHeader + 64;
  bytes.writeUInt32LE(missingSection ? 1 : 11, updateHeader);
  bytes.writeUInt32LE(1, updateHeader + 4);
  bytes.writeBigUInt64LE(1024n, updateHeader + 24);
  bytes.writeBigUInt64LE(1024n, updateHeader + 32);
  bytes.write('SQUASHFS-PAYLOAD-UNCHANGED', 3072, 'ascii');
  fs.writeFileSync(file, bytes, { mode: 0o755 });
  appendFakeBlockmap(file);
  return {
    file,
    event: { file, target: { name: 'appImage' }, updateInfo: { foo: 'kept' } },
  };
}

function fakeZsyncmake(command, args) {
  assert.equal(command, 'zsyncmake');
  const image = args.at(-1);
  const output = args[args.indexOf('-o') + 1];
  const digest = crypto.createHash('sha1').update(fs.readFileSync(image)).digest('hex');
  fs.writeFileSync(
    output,
    [
      'zsync: 0.6.2',
      `Filename: ${NAME}`,
      `Length: ${fs.statSync(image).size}`,
      `URL: ${NAME}`,
      `SHA-1: ${digest}`,
      '',
      'test-blocks',
    ].join('\n'),
  );
}

function mockBuild(extra = {}) {
  return {
    available: () => true,
    appendBlockmap: appendFakeBlockmap,
    run: fakeZsyncmake,
    env: RELEASE,
    ...extra,
  };
}

test('selects stable and prerelease channels and only release builds', () => {
  assert.equal(appimageHook.resolveUpdateChannel(RELEASE), 'latest');
  assert.equal(
    appimageHook.resolveUpdateChannel({ GITHUB_REF: 'refs/tags/v19.3.1-RC1' }),
    'latest-pre',
  );
  assert.equal(
    appimageHook.resolveUpdateChannel({ GITHUB_REF: 'refs/tags/v19.3.1-beta.2' }),
    'latest-pre',
  );
  assert.equal(
    appimageHook.resolveUpdateChannel({ GITHUB_REF: 'refs/tags/v19.3.1-alpha.1' }),
    'latest-pre',
  );
  assert.equal(
    appimageHook.resolveUpdateChannel({ APPIMAGE_UPDATE_CHANNEL: 'latest-pre' }),
    'latest-pre',
  );
  assert.equal(appimageHook.isReleaseBuild(RELEASE), true);
  assert.equal(appimageHook.isReleaseBuild({ GITHUB_REF: 'refs/heads/master' }), false);
  assert.equal(appimageHook.isReleaseBuild({ GITHUB_REF: 'refs/tags/test' }), false);
  assert.equal(appimageHook.isReleaseBuild({ APPIMAGE_DELTA_TEST: '1' }), true);
});

test('updates only ELF .upd_info bytes with NUL padding', (t) => {
  const { file } = fixture(t);
  const original = fs.readFileSync(file);
  const end = readEmbeddedBlockmap(file).start;
  fs.truncateSync(file, end);
  assert.deepEqual(findUpdateSection(file), { offset: 1024, length: 1024 });
  writeUpdateInfo(file, UPDATE_INFO);
  const result = fs.readFileSync(file);
  assert.deepEqual(result.subarray(0, 1024), original.subarray(0, 1024));
  assert.equal(result.toString('ascii', 1024, 1024 + UPDATE_INFO.length), UPDATE_INFO);
  assert.ok(result.subarray(1024 + UPDATE_INFO.length, 2048).every((byte) => byte === 0));
  assert.deepEqual(result.subarray(2048), original.subarray(2048, end));
});

test('rejects invalid ELF runtimes and oversized update metadata', (t) => {
  const { file } = fixture(t, { missingSection: true });
  assert.throws(() => findUpdateSection(file), /no .upd_info/);
  const second = fixture(t);
  assert.throws(() => writeUpdateInfo(second.file, 'x'.repeat(1024)), /exceeds/);
  fs.writeFileSync(second.file, 'not an ELF');
  assert.throws(() => findUpdateSection(second.file), /Truncated/);
});

test('ignores non-AppImage artifacts and non-release branches', async (t) => {
  const { file, event } = fixture(t);
  const original = fs.readFileSync(file);
  event.target.name = 'deb';
  assert.equal(
    await appimageHook(event, {
      available: () => {
        throw Error('should not probe');
      },
    }),
    false,
  );
  event.target.name = 'appImage';
  assert.equal(
    await appimageHook(event, {
      env: { GITHUB_REF: 'refs/heads/master' },
      available: () => {
        throw Error('should not probe');
      },
    }),
    false,
  );
  assert.deepEqual(fs.readFileSync(file), original);
});

test('missing zsyncmake preserves the original and skips publishing', async (t) => {
  const { file, event } = fixture(t);
  const original = fs.readFileSync(file);
  assert.equal(
    await appimageHook(event, { env: RELEASE, available: () => false }),
    false,
  );
  assert.deepEqual(fs.readFileSync(file), original);
  assert.deepEqual(await afterAll({ artifactPaths: [file] }), []);
});

test('successful hook preserves payload and publishes only current zsync', async (t) => {
  const { file, event } = fixture(t);
  const original = fs.readFileSync(file);
  const originalEnd = readEmbeddedBlockmap(file).start;
  assert.equal(await appimageHook(event, mockBuild()), true);
  const final = fs.readFileSync(file);
  const finalEnd = readEmbeddedBlockmap(file).start;
  assert.equal(originalEnd, finalEnd);
  assert.deepEqual(final.subarray(0, 1024), original.subarray(0, 1024));
  assert.deepEqual(final.subarray(2048, finalEnd), original.subarray(2048, originalEnd));
  assert.equal(final.toString('ascii', 1024, 1024 + UPDATE_INFO.length), UPDATE_INFO);
  assert.equal(event.updateInfo.foo, 'kept');
  assert.equal(
    event.updateInfo.sha512,
    crypto.createHash('sha512').update(final).digest('base64'),
  );
  assert.equal(event.updateInfo.blockMapSize, readEmbeddedBlockmap(file).length);
  assert.ok(fs.existsSync(`${file}.zsync`));
  assert.deepEqual(await afterAll({ artifactPaths: [file] }), [`${file}.zsync`]);
  assert.deepEqual(await afterAll({ artifactPaths: [] }), []);
});

test('prerelease tag embeds prerelease update channel', async (t) => {
  const { file, event } = fixture(t);
  assert.equal(
    await appimageHook(
      event,
      mockBuild({ env: { GITHUB_REF: 'refs/tags/v19.3.1-RC1' } }),
    ),
    true,
  );
  assert.match(fs.readFileSync(file).toString('ascii', 1024, 1150), /\|latest-pre\|/);
});

test('invalid update section and failed zsync safely preserve original', async (t) => {
  for (const options of [{ missingSection: true }, {}]) {
    const { file, event } = fixture(t, options);
    const original = fs.readFileSync(file);
    const run = () => {
      throw new Error('zsync failed');
    };
    assert.equal(await appimageHook(event, mockBuild({ run })), false);
    assert.deepEqual(fs.readFileSync(file), original);
    assert.equal(event.updateInfo.sha512, undefined);
    assert.deepEqual(await afterAll({ artifactPaths: [file] }), []);
  }
});

test('invalid zsync header preserves original image', async (t) => {
  const { file, event } = fixture(t);
  const original = fs.readFileSync(file);
  assert.equal(
    await appimageHook(
      event,
      mockBuild({ run: (_bin, args) => fs.writeFileSync(args[3], 'invalid') }),
    ),
    false,
  );
  assert.deepEqual(fs.readFileSync(file), original);
});

test('sidecar installation failure restores original image and existing sidecar', async (t) => {
  const { file, event } = fixture(t);
  const original = fs.readFileSync(file);
  fs.writeFileSync(`${file}.zsync`, 'old-zsync');
  let renamed = 0;
  assert.equal(
    await appimageHook(
      event,
      mockBuild({
        rename: (source, destination) => {
          if (++renamed === 2) throw new Error('injected sidecar error');
          fs.renameSync(source, destination);
        },
      }),
    ),
    false,
  );
  assert.deepEqual(fs.readFileSync(file), original);
  assert.equal(fs.readFileSync(`${file}.zsync`, 'utf8'), 'old-zsync');
  assert.equal(event.updateInfo.sha512, undefined);
  assert.deepEqual(await afterAll({ artifactPaths: [file] }), []);
});

test(
  'optional real AppImage integration',
  {
    skip: !process.env.APPIMAGE_TEST_INPUT
      ? 'Set APPIMAGE_TEST_INPUT to run real packaging'
      : false,
  },
  async (t) => {
    const { file, event } = fixture(t);
    fs.copyFileSync(process.env.APPIMAGE_TEST_INPUT, file);
    fs.chmodSync(file, 0o755);
    const original = fs.readFileSync(file);
    const oldEnd = readEmbeddedBlockmap(file).start;
    assert.equal(
      await appimageHook(
        event,
        mockBuild({
          available: (command) => command === 'zsyncmake',
          run: require('node:child_process').execFileSync,
          appendBlockmap: async (image) => {
            const {
              appendBlockmap,
            } = require('app-builder-lib/out/targets/differentialUpdateInfoBuilder');
            return appendBlockmap(image);
          },
        }),
      ),
      true,
    );
    const updated = fs.readFileSync(file);
    const newEnd = readEmbeddedBlockmap(file).start;
    assert.equal(newEnd, oldEnd);
    const section = findUpdateSection(file);
    assert.deepEqual(
      updated.subarray(0, section.offset),
      original.subarray(0, section.offset),
    );
    assert.deepEqual(
      updated.subarray(section.offset + section.length, newEnd),
      original.subarray(section.offset + section.length, oldEnd),
    );
    const runtime = require('node:child_process').spawnSync(
      file,
      ['--appimage-updateinformation'],
      {
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    assert.equal(runtime.status, 0, runtime.error?.message || runtime.stderr);
    assert.equal(runtime.stdout.trim(), UPDATE_INFO);
  },
);
