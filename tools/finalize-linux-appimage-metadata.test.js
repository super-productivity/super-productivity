'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const yaml = require('js-yaml');

const { finalize, getBlockMapSize } = require('./finalize-linux-appimage-metadata');

const NAME = 'superProductivity-x86_64.AppImage';

function makeFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-linux-metadata-'));

  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Small synthetic fixture with an embedded electron-builder-style blockmap.
  const blockmap = {
    version: '2',
    files: [{ name: 'file', offset: 0, checksums: [], sizes: [] }],
  };

  const compressed = zlib.deflateRawSync(Buffer.from(JSON.stringify(blockmap)));

  const footer = Buffer.alloc(4);
  footer.writeUInt32BE(compressed.length);

  const imagePath = path.join(dir, NAME);

  fs.writeFileSync(
    imagePath,
    Buffer.concat([Buffer.from('test-image'), compressed, footer]),
  );

  return {
    dir,
    imagePath,
    manifestPath: path.join(dir, 'latest-linux.yml'),
    blockMapSize: compressed.length,
  };
}

function sha512(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

test('preserves other packages and release notes', (t) => {
  const fixture = makeFixture(t);

  const original = {
    version: '19.3.1',
    files: [
      { url: NAME, sha512: 'old-hash', size: 123 },
      { url: 'superProductivity-amd64.deb', sha512: 'deb-hash', size: 100 },
      { url: 'superProductivity-x86_64.rpm', sha512: 'rpm-hash', size: 200 },
    ],
    path: NAME,
    sha512: 'old-hash',
    releaseNotes: 'Keep these release notes',
    releaseDate: '2026-10-25T11:59:50.990Z',
  };

  fs.writeFileSync(fixture.manifestPath, yaml.dump(original));

  finalize(fixture.imagePath, fixture.manifestPath);

  const result = yaml.load(fs.readFileSync(fixture.manifestPath, 'utf8'));

  assert.equal(result.files[0].sha512, sha512(fixture.imagePath));
  assert.equal(result.files[0].size, fs.statSync(fixture.imagePath).size);
  assert.equal(result.files[0].blockMapSize, fixture.blockMapSize);
  assert.equal(result.sha512, result.files[0].sha512);

  assert.deepEqual(result.files.slice(1), original.files.slice(1));
  assert.equal(result.releaseNotes, original.releaseNotes);
  assert.equal(result.releaseDate, original.releaseDate);
});

test('generates valid metadata when the manifest is absent', (t) => {
  const fixture = makeFixture(t);

  fs.writeFileSync(path.join(fixture.dir, 'superProductivity-amd64.deb'), 'deb');
  fs.writeFileSync(path.join(fixture.dir, 'superProductivity-x86_64.rpm'), 'rpm');

  finalize(fixture.imagePath, fixture.manifestPath);

  const result = yaml.load(fs.readFileSync(fixture.manifestPath, 'utf8'));

  assert.equal(result.files.length, 3);
  assert.equal(result.path, NAME);

  for (const entry of result.files) {
    const file = path.join(fixture.dir, entry.url);
    assert.equal(entry.size, fs.statSync(file).size);
    assert.equal(entry.sha512, sha512(file));
  }

  assert.equal(result.sha512, sha512(fixture.imagePath));
  assert.equal(result.files[0].blockMapSize, getBlockMapSize(fixture.imagePath));
});

test('rejects ambiguous Linux package sets', (t) => {
  const fixture = makeFixture(t);

  fs.writeFileSync(path.join(fixture.dir, 'one.deb'), 'deb1');
  fs.writeFileSync(path.join(fixture.dir, 'two.deb'), 'deb2');
  fs.writeFileSync(path.join(fixture.dir, 'one.rpm'), 'rpm');

  assert.throws(
    () => finalize(fixture.imagePath, fixture.manifestPath),
    /Expected exactly one .deb package/,
  );

  assert.equal(fs.existsSync(fixture.manifestPath), false);
});
