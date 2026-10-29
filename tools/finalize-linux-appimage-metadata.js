#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const yaml = require('js-yaml');

function getBlockMapSize(imagePath) {
  const size = fs.statSync(imagePath).size;
  const fd = fs.openSync(imagePath, 'r');

  try {
    const footer = Buffer.alloc(4);
    assert.equal(fs.readSync(fd, footer, 0, 4, size - 4), 4);

    const length = footer.readUInt32BE(0);

    assert.ok(
      length > 0 && length < Math.min(size - 4, 10_000_000),
      'Missing or invalid embedded blockmap',
    );

    const compressed = Buffer.alloc(length);
    assert.equal(fs.readSync(fd, compressed, 0, length, size - length - 4), length);

    const blockmap = JSON.parse(zlib.inflateRawSync(compressed).toString('utf8'));

    assert.ok(
      Array.isArray(blockmap.files) && blockmap.files.length > 0,
      'Invalid blockmap contents',
    );

    return length;
  } finally {
    fs.closeSync(fd);
  }
}

function finalize(imagePath, metadataPath) {
  const filename = path.basename(imagePath);

  assert.equal(
    filename,
    'superProductivity-x86_64.AppImage',
    'Unexpected AppImage filename',
  );

  let data;

  if (fs.existsSync(metadataPath)) {
    data = yaml.load(fs.readFileSync(metadataPath, 'utf8'));
  } else {
    // A build using --publish never may not create latest-linux.yml.
    const directory = path.dirname(imagePath);
    const packageNames = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith('.deb') || name.endsWith('.rpm'))
      .sort();

    for (const extension of ['.deb', '.rpm']) {
      assert.equal(
        packageNames.filter((name) => name.endsWith(extension)).length,
        1,
        `Expected exactly one ${extension} package`,
      );
    }

    const files = [filename, ...packageNames].map((name) => {
      const bytes = fs.readFileSync(path.join(directory, name));
      return {
        url: name,
        sha512: crypto.createHash('sha512').update(bytes).digest('base64'),
        size: bytes.length,
      };
    });

    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
    );

    const notesPath = path.join(__dirname, '..', 'build', 'release-notes.md');

    data = {
      version: pkg.version,
      files,
      path: filename,
      sha512: files[0].sha512,
      ...(fs.existsSync(notesPath)
        ? { releaseNotes: fs.readFileSync(notesPath, 'utf8') }
        : {}),
      releaseDate: new Date().toISOString(),
    };
  }

  assert.ok(data && Array.isArray(data.files), 'Missing Linux update file entries');

  const matches = data.files.filter((entry) => entry.url === filename);
  assert.equal(matches.length, 1, 'Expected exactly one AppImage entry');

  const image = fs.readFileSync(imagePath);
  const sha512 = crypto.createHash('sha512').update(image).digest('base64');

  const entry = matches[0];
  entry.sha512 = sha512;
  entry.size = image.length;
  entry.blockMapSize = getBlockMapSize(imagePath);

  if (data.path === filename) {
    data.sha512 = sha512;
  }

  fs.writeFileSync(metadataPath, yaml.dump(data, { lineWidth: -1 }));

  console.log('PASS: Linux AppImage metadata updated');
  console.log('AppImage size:', entry.size);
  console.log('Blockmap size:', entry.blockMapSize);
}

if (require.main === module) {
  try {
    assert.equal(
      process.argv.length,
      4,
      'Usage: node finalize-linux-appimage-metadata.js APPIMAGE LATEST_LINUX_YML',
    );
    finalize(process.argv[2], process.argv[3]);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = { finalize, getBlockMapSize };
