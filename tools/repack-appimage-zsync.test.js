const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, 'repack-appimage-zsync.sh');
const filename = 'superProductivity-x86_64.AppImage';
const updateChannel = process.env.APPIMAGE_UPDATE_CHANNEL || 'latest';
const expectedInfo = `gh-releases-zsync|super-productivity|super-productivity|${updateChannel}|${filename}.zsync`;

function run(args) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

test('requires input and output arguments', () => {
  const result = run([]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});

test('rejects unexpected AppImage filenames', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-appimage-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const input = path.join(dir, 'wrong.AppImage');
  fs.writeFileSync(input, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const result = run([input, path.join(dir, 'output')]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unexpected AppImage filename/);
});

test(
  'generates matching AppImage, blockmap and zsync artifacts',
  {
    skip: !process.env.APPIMAGE_TEST_INPUT
      ? 'Set APPIMAGE_TEST_INPUT to run the integration test'
      : false,
  },
  (t) => {
    const input = path.resolve(process.env.APPIMAGE_TEST_INPUT);
    assert.ok(fs.existsSync(input), 'Input fixture must exist');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-appimage-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const result = run([input, dir]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const image = path.join(dir, filename);
    const zsync = `${image}.zsync`;

    assert.ok(fs.statSync(image).size > 0);
    assert.ok(fs.statSync(zsync).size > 0);

    const info = spawnSync(image, ['--appimage-updateinformation'], {
      encoding: 'utf8',
    });
    assert.equal(info.status, 0);
    assert.equal(info.stdout.trim(), expectedInfo);

    // Verify electron-builder's embedded differential-update blockmap.
    const imageSize = fs.statSync(image).size;
    const fd = fs.openSync(image, 'r');
    let blockmap;

    try {
      const tail = Buffer.alloc(4);
      assert.equal(fs.readSync(fd, tail, 0, 4, imageSize - 4), 4);

      const length = tail.readUInt32BE(0);
      assert.ok(length > 0 && length < 10_000_000, 'Missing embedded blockmap');

      const compressed = Buffer.alloc(length);
      assert.equal(
        fs.readSync(fd, compressed, 0, length, imageSize - 4 - length),
        length,
      );

      blockmap = JSON.parse(zlib.inflateRawSync(compressed).toString('utf8'));
    } finally {
      fs.closeSync(fd);
    }

    assert.ok(
      Array.isArray(blockmap.files) && blockmap.files.length > 0,
      'Invalid electron-builder blockmap',
    );

    const header = fs.readFileSync(zsync).subarray(0, 16384).toString().split('\n\n')[0];

    const fields = Object.fromEntries(
      header
        .split('\n')
        .filter((line) => line.includes(': '))
        .map((line) => line.split(/: (.*)/s).slice(0, 2)),
    );

    const hash = crypto.createHash('sha1').update(fs.readFileSync(image)).digest('hex');

    assert.equal(Number(fields.Length), fs.statSync(image).size);
    assert.equal(fields['SHA-1'], hash);
    assert.equal(fields.Filename, filename);
    assert.equal(fields.URL, filename);
  },
);
